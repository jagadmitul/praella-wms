import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePurchaseOrderInput,
  Paginated,
  PurchaseOrderQuery,
  PurchaseOrderStatus,
  PurchaseOrderView,
  ReceivePurchaseOrderInput,
  UpdatePurchaseOrderInput,
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

const PO_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

/** Statuses from which a purchase order may still be received against. */
const RECEIVABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  'SUBMITTED',
  'PARTIALLY_RECEIVED',
];

/**
 * Inbound purchase orders.
 *
 * Stock is *not* touched when an order is raised — only when goods physically
 * arrive. Receiving is partial-capable, so a shipment that turns up in two
 * lorries produces two ledger entries and leaves the order correctly
 * `PARTIALLY_RECEIVED` in between.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly counters: DocumentCounterService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Lists purchase orders.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination and filter options.
   * @returns A page of purchase orders.
   */
  async list(
    orgContext: OrgContext,
    query: PurchaseOrderQuery,
  ): Promise<Paginated<PurchaseOrderView>> {
    const scope = warehouseScopeFilter(orgContext);

    if (query.warehouseId) {
      assertWarehouseAccess(orgContext, query.warehouseId);
    }

    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.warehouseId
        ? { warehouseId: query.warehouseId }
        : scope
          ? { warehouseId: scope }
          : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: { createdAt: query.sortDir },
        include: PO_INCLUDE,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return paginate(rows.map(PurchaseOrdersService.toView), totalItems, query);
  }

  /**
   * Loads a single purchase order.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Purchase order identifier.
   * @returns The purchase order.
   */
  async findOne(orgContext: OrgContext, id: string): Promise<PurchaseOrderView> {
    return PurchaseOrdersService.toView(await this.load(orgContext, id));
  }

  /**
   * Creates a purchase order in DRAFT.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User creating the order.
   * @param input - Validated purchase order payload.
   * @returns The created order.
   */
  async create(
    orgContext: OrgContext,
    actorId: string,
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderView> {
    assertWarehouseAccess(orgContext, input.warehouseId);
    await this.assertReferences(orgContext, input);

    const totalAmount = sumMoney(
      input.items.map((item) => multiplyMoney(item.unitCost, item.quantity)),
    );

    const order = await this.prisma.$transaction(async (tx) => {
      const code = await this.counters.next(tx, orgContext.organizationId, 'PO');

      return tx.purchaseOrder.create({
        data: {
          organizationId: orgContext.organizationId,
          code,
          status: 'DRAFT',
          supplierId: input.supplierId,
          warehouseId: input.warehouseId,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
          notes: input.notes ?? null,
          totalAmount,
          createdById: actorId,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost.toFixed(2),
            })),
          },
        },
        include: PO_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'purchase_order.created', order.id, {
      code: order.code,
      totalAmount,
    });

    return PurchaseOrdersService.toView(order);
  }

  /**
   * Updates the editable fields of a draft or submitted order.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the update.
   * @param id - Purchase order identifier.
   * @param input - Fields to change.
   * @returns The updated order.
   */
  async update(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    input: UpdatePurchaseOrderInput,
  ): Promise<PurchaseOrderView> {
    const order = await this.load(orgContext, id);
    PurchaseOrdersService.assertStatus(order.status as PurchaseOrderStatus, [
      'DRAFT',
      'SUBMITTED',
    ]);
    assertVersion('purchase order', order.version, input.expectedVersion);

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        ...(input.expectedAt === undefined
          ? {}
          : { expectedAt: new Date(input.expectedAt) }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        version: { increment: 1 },
      },
      include: PO_INCLUDE,
    });

    await this.afterMutation(orgContext, actorId, 'purchase_order.updated', id, {
      code: order.code,
    });

    return PurchaseOrdersService.toView(updated);
  }

  /**
   * Submits a draft order to the supplier.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User submitting the order.
   * @param id - Purchase order identifier.
   * @returns The submitted order.
   */
  async submit(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<PurchaseOrderView> {
    const order = await this.load(orgContext, id);
    PurchaseOrdersService.assertStatus(order.status as PurchaseOrderStatus, ['DRAFT']);

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'SUBMITTED', version: { increment: 1 } },
      include: PO_INCLUDE,
    });

    await this.afterMutation(orgContext, actorId, 'purchase_order.submitted', id, {
      code: order.code,
    });

    return PurchaseOrdersService.toView(updated);
  }

  /**
   * Receives goods against a purchase order, increasing stock at its warehouse.
   *
   * Omitting `items` receives every outstanding line in full. Over-receipt is
   * rejected rather than silently accepted, because a line that receives more
   * than was ordered is nearly always a keying error at the goods-in desk.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User recording the receipt.
   * @param id - Purchase order identifier.
   * @param input - Lines and quantities received.
   * @returns The order, now partially or fully received.
   */
  async receive(
    orgContext: OrgContext,
    actorId: string,
    id: string,
    input: ReceivePurchaseOrderInput,
  ): Promise<PurchaseOrderView> {
    const order = await this.load(orgContext, id);
    PurchaseOrdersService.assertStatus(
      order.status as PurchaseOrderStatus,
      RECEIVABLE_STATUSES,
    );
    assertWarehouseAccess(orgContext, order.warehouseId);

    const receipts = PurchaseOrdersService.resolveReceipts(order, input);

    if (receipts.length === 0) {
      throw new BadRequestException('Nothing left to receive on this order');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const receipt of receipts) {
        await this.ledger.applyMovement(tx, {
          organizationId: orgContext.organizationId,
          productId: receipt.productId,
          warehouseId: order.warehouseId,
          type: 'INBOUND',
          delta: receipt.quantity,
          actorId,
          referenceType: 'PURCHASE_ORDER',
          referenceId: order.id,
          referenceCode: order.code,
          unitCost: receipt.unitCost,
          note: input.note ?? 'Goods received against purchase order',
        });

        await tx.purchaseOrderItem.update({
          where: { id: receipt.itemId },
          data: { receivedQuantity: { increment: receipt.quantity } },
        });
      }

      const refreshed = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });

      const fullyReceived = refreshed.items.every(
        (item) => item.receivedQuantity >= item.quantity,
      );

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          receivedAt: fullyReceived ? new Date() : null,
          version: { increment: 1 },
        },
        include: PO_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'purchase_order.received', id, {
      code: order.code,
      lines: receipts.length,
      units: receipts.reduce((sum, receipt) => sum + receipt.quantity, 0),
      status: updated.status,
    });

    return PurchaseOrdersService.toView(updated);
  }

  /**
   * Cancels an order that has not yet received any goods.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User cancelling the order.
   * @param id - Purchase order identifier.
   * @returns The cancelled order.
   */
  async cancel(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<PurchaseOrderView> {
    const order = await this.load(orgContext, id);
    PurchaseOrdersService.assertStatus(order.status as PurchaseOrderStatus, [
      'DRAFT',
      'SUBMITTED',
    ]);

    if (order.items.some((item) => item.receivedQuantity > 0)) {
      throw new ConflictException(
        'This order has already received stock and cannot be cancelled. Raise a stock adjustment instead.',
      );
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', version: { increment: 1 } },
      include: PO_INCLUDE,
    });

    await this.afterMutation(orgContext, actorId, 'purchase_order.cancelled', id, {
      code: order.code,
    });

    return PurchaseOrdersService.toView(updated);
  }

  /**
   * Works out which lines to receive and how many units of each, validating the
   * request against what is actually outstanding.
   */
  private static resolveReceipts(
    order: PurchaseOrderRow,
    input: ReceivePurchaseOrderInput,
  ): Array<{ itemId: string; productId: string; quantity: number; unitCost: string }> {
    if (!input.items || input.items.length === 0) {
      return order.items
        .filter((item) => item.receivedQuantity < item.quantity)
        .map((item) => ({
          itemId: item.id,
          productId: item.productId,
          quantity: item.quantity - item.receivedQuantity,
          unitCost: toMoneyString(item.unitCost),
        }));
    }

    return input.items.map((requested) => {
      const item = order.items.find(
        (candidate) => candidate.id === requested.purchaseOrderItemId,
      );

      if (!item) {
        throw new BadRequestException(
          `Line ${requested.purchaseOrderItemId} does not belong to this purchase order`,
        );
      }

      const outstanding = item.quantity - item.receivedQuantity;
      if (requested.quantity > outstanding) {
        throw new ConflictException(
          `Cannot receive ${requested.quantity} units of ${item.productId}: only ${outstanding} outstanding`,
        );
      }

      return {
        itemId: item.id,
        productId: item.productId,
        quantity: requested.quantity,
        unitCost: toMoneyString(item.unitCost),
      };
    });
  }

  private async load(orgContext: OrgContext, id: string): Promise<PurchaseOrderRow> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      include: PO_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Purchase order not found');
    }

    return order;
  }

  private static assertStatus(
    current: PurchaseOrderStatus,
    allowed: readonly PurchaseOrderStatus[],
  ): void {
    if (!allowed.includes(current)) {
      throw new ConflictException(
        `This purchase order is ${current}; the action is only valid while it is ${allowed.join(' or ')}.`,
      );
    }
  }

  private async assertReferences(
    orgContext: OrgContext,
    input: CreatePurchaseOrderInput,
  ): Promise<void> {
    const [supplier, warehouse, productCount] = await Promise.all([
      this.prisma.supplier.findFirst({
        where: { id: input.supplierId, organizationId: orgContext.organizationId },
        select: { id: true },
      }),
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

    if (!supplier) {
      throw new BadRequestException('Supplier does not exist in this organisation');
    }
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
        entityType: 'PurchaseOrder',
        entityId,
        metadata: metadata as never,
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);
  }

  private static toView(order: PurchaseOrderRow): PurchaseOrderView {
    return {
      id: order.id,
      code: order.code,
      version: order.version,
      status: order.status as PurchaseOrderStatus,
      notes: order.notes,
      totalAmount: toMoneyString(order.totalAmount),
      expectedAt: order.expectedAt?.toISOString() ?? null,
      receivedAt: order.receivedAt?.toISOString() ?? null,
      supplier: order.supplier,
      warehouse: order.warehouse,
      items: order.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        receivedQuantity: item.receivedQuantity,
        outstandingQuantity: item.quantity - item.receivedQuantity,
        unitCost: toMoneyString(item.unitCost),
        lineTotal: multiplyMoney(item.unitCost, item.quantity),
        product: item.product,
      })),
      createdBy: order.createdBy,
      createdAt: order.createdAt.toISOString(),
    };
  }
}
