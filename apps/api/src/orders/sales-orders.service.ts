import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateSalesOrderInput,
  FulfillSalesOrderInput,
  Paginated,
  ReplaceSalesOrderLinesInput,
  SalesOrderQuery,
  SalesOrderStatus,
  SalesOrderView,
  UpdateSalesOrderInput,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../common/services/audit.service';
import { DocumentCounterService } from '../common/services/document-counter.service';
import { paginate, toPrismaPage } from '../common/utils/pagination.util';
import { assertVersion } from '../common/utils/concurrency.util';
import { multiplyMoney, sumMoney, toMoneyString } from '../common/utils/decimal.util';
import {
  assertWarehouseAccess,
  warehouseScopeFilter,
} from '../common/utils/warehouse-scope.util';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';
import { StockLedgerService } from '../stock/stock-ledger.service';

const SO_INCLUDE = {
  warehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.SalesOrderInclude;

type SalesOrderRow = Prisma.SalesOrderGetPayload<{ include: typeof SO_INCLUDE }>;

const FULFILLABLE_STATUSES: readonly SalesOrderStatus[] = [
  'ALLOCATED',
  'PARTIALLY_FULFILLED',
];

/**
 * Outbound sales / dispatch orders.
 *
 * The lifecycle separates *allocating* stock from *shipping* it:
 *
 *   DRAFT → ALLOCATED → PARTIALLY_FULFILLED → FULFILLED
 *
 * Allocation reserves units without moving them, so two orders cannot both
 * promise the last item on the shelf. Fulfilment then converts the reservation
 * into a real outbound movement. This is the difference between "on hand" and
 * "available", and it is why `StockLevel` tracks both.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly counters: DocumentCounterService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Lists sales orders.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination and filter options.
   * @returns A page of sales orders.
   */
  async list(
    orgContext: OrgContext,
    query: SalesOrderQuery,
  ): Promise<Paginated<SalesOrderView>> {
    const scope = warehouseScopeFilter(orgContext);

    if (query.warehouseId) {
      assertWarehouseAccess(orgContext, query.warehouseId);
    }

    const where: Prisma.SalesOrderWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.warehouseId
        ? { warehouseId: query.warehouseId }
        : scope
          ? { warehouseId: scope }
          : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { customerName: { contains: query.search, mode: 'insensitive' } },
              { customerEmail: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: { createdAt: query.sortDir },
        include: SO_INCLUDE,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    return paginate(rows.map(SalesOrdersService.toView), totalItems, query);
  }

  /**
   * Loads a single sales order.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Sales order identifier.
   * @returns The sales order.
   */
  async findOne(orgContext: OrgContext, id: string): Promise<SalesOrderView> {
    return SalesOrdersService.toView(await this.load(orgContext, id));
  }

  /**
   * Creates a sales order in DRAFT. No stock is reserved until it is allocated.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User creating the order.
   * @param input - Validated sales order payload.
   * @returns The created order.
   */
  async create(
    orgContext: OrgContext,
    actorId: string,
    input: CreateSalesOrderInput,
  ): Promise<SalesOrderView> {
    assertWarehouseAccess(orgContext, input.warehouseId);
    await this.assertReferences(orgContext, input);

    const totalAmount = sumMoney(
      input.items.map((item) => multiplyMoney(item.unitPrice, item.quantity)),
    );

    const order = await this.prisma.$transaction(async (tx) => {
      const code = await this.counters.next(tx, orgContext.organizationId, 'SO');

      return tx.salesOrder.create({
        data: {
          organizationId: orgContext.organizationId,
          code,
          status: 'DRAFT',
          warehouseId: input.warehouseId,
          customerName: input.customerName,
          customerEmail: input.customerEmail ?? null,
          notes: input.notes ?? null,
          totalAmount,
          createdById: actorId,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toFixed(2),
            })),
          },
        },
        include: SO_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'sales_order.created', order.id, {
      code: order.code,
      totalAmount,
    });

    return SalesOrdersService.toView(order);
  }

  /**
   * Updates the editable fields of a draft or allocated order.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the update.
   * @param id - Sales order identifier.
   * @param input - Fields to change.
   * @returns The updated order.
   */
  async update(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    input: UpdateSalesOrderInput,
  ): Promise<SalesOrderView> {
    const order = await this.load(orgContext, id);
    SalesOrdersService.assertStatus(order.status as SalesOrderStatus, [
      'DRAFT',
      'ALLOCATED',
    ]);
    assertVersion('sales order', order.version, input.expectedVersion);

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        ...(input.customerName === undefined ? {} : { customerName: input.customerName }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        version: { increment: 1 },
      },
      include: SO_INCLUDE,
    });

    await this.afterMutation(orgContext, actorId, 'sales_order.updated', id, {
      code: order.code,
    });

    return SalesOrdersService.toView(updated);
  }

  /**
   * Replaces every line on a draft order.
   *
   * Restricted to DRAFT because an ALLOCATED order holds stock reservations
   * that are keyed to its current lines; rewriting them underneath would leave
   * reserved quantity stranded.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the edit.
   * @param id - Sales order identifier.
   * @param input - The complete new set of lines.
   * @returns The updated order.
   */
  async replaceLines(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    input: ReplaceSalesOrderLinesInput,
  ): Promise<SalesOrderView> {
    const order = await this.load(orgContext, id);
    SalesOrdersService.assertStatus(order.status as SalesOrderStatus, ['DRAFT']);
    assertVersion('sales order', order.version, input.expectedVersion);

    const productCount = await this.prisma.product.count({
      where: {
        id: { in: input.items.map((item) => item.productId) },
        organizationId: orgContext.organizationId,
      },
    });

    if (productCount !== input.items.length) {
      throw new BadRequestException('One or more products do not exist in this organisation');
    }

    const totalAmount = sumMoney(
      input.items.map((item) => multiplyMoney(item.unitPrice, item.quantity)),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });

      return tx.salesOrder.update({
        where: { id },
        data: {
          totalAmount,
          version: { increment: 1 },
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toFixed(2),
            })),
          },
        },
        include: SO_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'sales_order.lines_replaced', id, {
      code: order.code,
      lines: input.items.length,
      totalAmount,
    });

    return SalesOrdersService.toView(updated);
  }

  /**
   * Allocates stock to a draft order, reserving units without moving them.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User allocating the order.
   * @param id - Sales order identifier.
   * @returns The allocated order.
   * @throws ConflictException when any line cannot be covered by available stock.
   */
  async allocate(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<SalesOrderView> {
    const order = await this.load(orgContext, id);
    SalesOrdersService.assertStatus(order.status as SalesOrderStatus, ['DRAFT']);
    assertWarehouseAccess(orgContext, order.warehouseId);

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await this.ledger.adjustReservation(tx, {
          organizationId: orgContext.organizationId,
          productId: item.productId,
          warehouseId: order.warehouseId,
          reservedDelta: item.quantity - item.fulfilledQuantity,
        });
      }

      return tx.salesOrder.update({
        where: { id },
        data: { status: 'ALLOCATED', version: { increment: 1 } },
        include: SO_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'sales_order.allocated', id, {
      code: order.code,
    });

    return SalesOrdersService.toView(updated);
  }

  /**
   * Ships lines from an allocated order, converting reservations into outbound
   * stock movements.
   *
   * Omitting `items` ships every outstanding line in full.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User recording the dispatch.
   * @param id - Sales order identifier.
   * @param input - Lines and quantities shipped.
   * @returns The order, now partially or fully fulfilled.
   */
  async fulfill(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    input: FulfillSalesOrderInput,
  ): Promise<SalesOrderView> {
    const order = await this.load(orgContext, id);
    SalesOrdersService.assertStatus(
      order.status as SalesOrderStatus,
      FULFILLABLE_STATUSES,
    );
    assertWarehouseAccess(orgContext, order.warehouseId);

    const shipments = SalesOrdersService.resolveShipments(order, input);

    if (shipments.length === 0) {
      throw new BadRequestException('Nothing left to fulfil on this order');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const shipment of shipments) {
        await this.ledger.applyMovement(tx, {
          organizationId: orgContext.organizationId,
          productId: shipment.productId,
          warehouseId: order.warehouseId,
          type: 'OUTBOUND',
          delta: -shipment.quantity,
          // The units being shipped are the ones this order already reserved,
          // so they are released in the same statement that removes them.
          reservedDelta: -shipment.quantity,
          respectReservations: false,
          actorId,
          referenceType: 'SALES_ORDER',
          referenceId: order.id,
          referenceCode: order.code,
          note: input.note ?? 'Dispatched against sales order',
        });

        await tx.salesOrderItem.update({
          where: { id: shipment.itemId },
          data: { fulfilledQuantity: { increment: shipment.quantity } },
        });
      }

      const refreshed = await tx.salesOrder.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });

      const fullyFulfilled = refreshed.items.every(
        (item) => item.fulfilledQuantity >= item.quantity,
      );

      return tx.salesOrder.update({
        where: { id },
        data: {
          status: fullyFulfilled ? 'FULFILLED' : 'PARTIALLY_FULFILLED',
          fulfilledAt: fullyFulfilled ? new Date() : null,
          version: { increment: 1 },
        },
        include: SO_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'sales_order.fulfilled', id, {
      code: order.code,
      lines: shipments.length,
      units: shipments.reduce((sum, shipment) => sum + shipment.quantity, 0),
      status: updated.status,
    });

    return SalesOrdersService.toView(updated);
  }

  /**
   * Cancels an order, releasing any stock it still has reserved.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User cancelling the order.
   * @param id - Sales order identifier.
   * @returns The cancelled order.
   */
  async cancel(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<SalesOrderView> {
    const order = await this.load(orgContext, id);
    SalesOrdersService.assertStatus(order.status as SalesOrderStatus, [
      'DRAFT',
      'ALLOCATED',
      'PARTIALLY_FULFILLED',
    ]);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (order.status !== 'DRAFT') {
        // Units already shipped stay shipped; only the unshipped remainder is
        // still reserved and needs releasing.
        for (const item of order.items) {
          const outstanding = item.quantity - item.fulfilledQuantity;
          if (outstanding <= 0) continue;

          await this.ledger.adjustReservation(tx, {
            organizationId: orgContext.organizationId,
            productId: item.productId,
            warehouseId: order.warehouseId,
            reservedDelta: -outstanding,
          });
        }
      }

      return tx.salesOrder.update({
        where: { id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
        include: SO_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'sales_order.cancelled', id, {
      code: order.code,
    });

    return SalesOrdersService.toView(updated);
  }

  private static resolveShipments(
    order: SalesOrderRow,
    input: FulfillSalesOrderInput,
  ): Array<{ itemId: string; productId: string; quantity: number }> {
    if (!input.items || input.items.length === 0) {
      return order.items
        .filter((item) => item.fulfilledQuantity < item.quantity)
        .map((item) => ({
          itemId: item.id,
          productId: item.productId,
          quantity: item.quantity - item.fulfilledQuantity,
        }));
    }

    return input.items.map((requested) => {
      const item = order.items.find(
        (candidate) => candidate.id === requested.salesOrderItemId,
      );

      if (!item) {
        throw new BadRequestException(
          `Line ${requested.salesOrderItemId} does not belong to this sales order`,
        );
      }

      const outstanding = item.quantity - item.fulfilledQuantity;
      if (requested.quantity > outstanding) {
        throw new ConflictException(
          `Cannot fulfil ${requested.quantity} units: only ${outstanding} outstanding on this line`,
        );
      }

      return {
        itemId: item.id,
        productId: item.productId,
        quantity: requested.quantity,
      };
    });
  }

  private async load(orgContext: OrgContext, id: string): Promise<SalesOrderRow> {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      include: SO_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Sales order not found');
    }

    return order;
  }

  private static assertStatus(
    current: SalesOrderStatus,
    allowed: readonly SalesOrderStatus[],
  ): void {
    if (!allowed.includes(current)) {
      throw new ConflictException(
        `This sales order is ${current}; the action is only valid while it is ${allowed.join(' or ')}.`,
      );
    }
  }

  private async assertReferences(
    orgContext: OrgContext,
    input: CreateSalesOrderInput,
  ): Promise<void> {
    const [warehouse, productCount] = await Promise.all([
      this.prisma.warehouse.findFirst({
        where: { id: input.warehouseId, organizationId: orgContext.organizationId },
        select: { id: true },
      }),
      this.prisma.product.count({
        where: {
          id: { in: input.items.map((item) => item.productId) },
          organizationId: orgContext.organizationId,
        },
      }),
    ]);

    if (!warehouse) {
      throw new BadRequestException('Warehouse does not exist in this organisation');
    }
    if (productCount !== new Set(input.items.map((item) => item.productId)).size) {
      throw new BadRequestException('One or more products do not exist in this organisation');
    }
  }

  private async afterMutation(
    orgContext: OrgContext,
    actorId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await Promise.all([
      this.auditService.record({
        organizationId: orgContext.organizationId,
        actorId,
        action,
        entityType: 'SalesOrder',
        entityId,
        metadata: metadata as never,
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);
  }

  private static toView(order: SalesOrderRow): SalesOrderView {
    return {
      id: order.id,
      code: order.code,
      version: order.version,
      status: order.status as SalesOrderStatus,
      notes: order.notes,
      totalAmount: toMoneyString(order.totalAmount),
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
      warehouse: order.warehouse,
      items: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        fulfilledQuantity: item.fulfilledQuantity,
        outstandingQuantity: item.quantity - item.fulfilledQuantity,
        unitPrice: toMoneyString(item.unitPrice),
        lineTotal: multiplyMoney(item.unitPrice, item.quantity),
        product: item.product,
      })),
      createdBy: order.createdBy,
      createdAt: order.createdAt.toISOString(),
    };
  }
}
