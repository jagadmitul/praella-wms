import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTransferInput,
  Paginated,
  StockTransferStatus,
  StockTransferView,
  TransferQuery,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../common/services/audit.service';
import { DocumentCounterService } from '../common/services/document-counter.service';
import { paginate, toPrismaPage } from '../common/utils/pagination.util';
import {
  assertWarehousesAccess,
  warehouseScopeFilter,
} from '../common/utils/warehouse-scope.util';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';
import { StockLedgerService } from '../stock/stock-ledger.service';

const TRANSFER_INCLUDE = {
  sourceWarehouse: { select: { id: true, name: true, code: true } },
  destinationWarehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.StockTransferInclude;

type TransferRow = Prisma.StockTransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

/**
 * Warehouse-to-warehouse transfers, modelled as a three-state machine:
 *
 *   DRAFT → IN_TRANSIT → COMPLETED
 *
 * Stock leaves the source on dispatch and arrives at the destination on
 * receipt, which means goods in transit are correctly absent from both sites
 * rather than being teleported. A single-step transfer would overstate the
 * destination's availability for however long the lorry is on the road.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly counters: DocumentCounterService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Lists transfers visible to the caller.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination and filter options.
   * @returns A page of transfers.
   */
  async list(
    orgContext: OrgContext,
    query: TransferQuery,
  ): Promise<Paginated<StockTransferView>> {
    const scope = warehouseScopeFilter(orgContext);

    const where: Prisma.StockTransferWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceWarehouseId ? { sourceWarehouseId: query.sourceWarehouseId } : {}),
      ...(query.destinationWarehouseId
        ? { destinationWarehouseId: query.destinationWarehouseId }
        : {}),
      ...(query.search ? { code: { contains: query.search, mode: 'insensitive' } } : {}),
      // A scoped member sees a transfer if either end is one of their sites.
      ...(scope
        ? {
            OR: [
              { sourceWarehouseId: scope },
              { destinationWarehouseId: scope },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: { createdAt: query.sortDir },
        include: TRANSFER_INCLUDE,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    return paginate(rows.map(TransfersService.toView), totalItems, query);
  }

  /**
   * Loads a single transfer.
   *
   * @param orgContext - Resolved organisation context.
   * @param id - Transfer identifier.
   * @returns The transfer.
   */
  async findOne(orgContext: OrgContext, id: string): Promise<StockTransferView> {
    return TransfersService.toView(await this.load(orgContext, id));
  }

  /**
   * Creates a draft transfer.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User creating the transfer.
   * @param input - Validated transfer payload.
   * @returns The created transfer.
   */
  async create(
    orgContext: OrgContext,
    actorId: string,
    input: CreateTransferInput,
  ): Promise<StockTransferView> {
    assertWarehousesAccess(orgContext, [
      input.sourceWarehouseId,
      input.destinationWarehouseId,
    ]);
    await this.assertWarehousesInOrg(orgContext, [
      input.sourceWarehouseId,
      input.destinationWarehouseId,
    ]);
    await this.assertProductsInOrg(
      orgContext,
      input.items.map((item) => item.productId),
    );

    const transfer = await this.prisma.$transaction(async (tx) => {
      const code = await this.counters.next(tx, orgContext.organizationId, 'TRF');

      return tx.stockTransfer.create({
        data: {
          organizationId: orgContext.organizationId,
          code,
          status: 'DRAFT',
          sourceWarehouseId: input.sourceWarehouseId,
          destinationWarehouseId: input.destinationWarehouseId,
          notes: input.notes ?? null,
          createdById: actorId,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
          },
        },
        include: TRANSFER_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'stock_transfer.created', transfer.id, {
      code: transfer.code,
      items: transfer.items.length,
    });

    return TransfersService.toView(transfer);
  }

  /**
   * Dispatches a draft transfer, removing stock from the source warehouse.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User dispatching the transfer.
   * @param id - Transfer identifier.
   * @returns The transfer, now in transit.
   */
  async dispatch(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<StockTransferView> {
    const transfer = await this.load(orgContext, id);
    TransfersService.assertStatus(transfer.status as StockTransferStatus, ['DRAFT']);
    assertWarehousesAccess(orgContext, [transfer.sourceWarehouseId]);

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        await this.ledger.applyMovement(tx, {
          organizationId: orgContext.organizationId,
          productId: item.productId,
          warehouseId: transfer.sourceWarehouseId,
          counterpartWarehouseId: transfer.destinationWarehouseId,
          type: 'TRANSFER_OUT',
          delta: -item.quantity,
          actorId,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          referenceCode: transfer.code,
          note: 'Transfer dispatched',
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data: { status: 'IN_TRANSIT' },
        include: TRANSFER_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'stock_transfer.dispatched', id, {
      code: transfer.code,
    });

    return TransfersService.toView(updated);
  }

  /**
   * Receives an in-transit transfer, adding stock to the destination warehouse.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User receiving the transfer.
   * @param id - Transfer identifier.
   * @returns The completed transfer.
   */
  async receive(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<StockTransferView> {
    const transfer = await this.load(orgContext, id);
    TransfersService.assertStatus(transfer.status as StockTransferStatus, ['IN_TRANSIT']);
    assertWarehousesAccess(orgContext, [transfer.destinationWarehouseId]);

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        await this.ledger.applyMovement(tx, {
          organizationId: orgContext.organizationId,
          productId: item.productId,
          warehouseId: transfer.destinationWarehouseId,
          counterpartWarehouseId: transfer.sourceWarehouseId,
          type: 'TRANSFER_IN',
          delta: item.quantity,
          actorId,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          referenceCode: transfer.code,
          note: 'Transfer received',
        });
      }

      return tx.stockTransfer.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
        include: TRANSFER_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'stock_transfer.completed', id, {
      code: transfer.code,
    });

    return TransfersService.toView(updated);
  }

  /**
   * Cancels a transfer. Stock already dispatched is returned to the source.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User cancelling the transfer.
   * @param id - Transfer identifier.
   * @returns The cancelled transfer.
   */
  async cancel(
    orgContext: OrgContext,
    actorId: string,
    id: string,
  ): Promise<StockTransferView> {
    const transfer = await this.load(orgContext, id);
    TransfersService.assertStatus(transfer.status as StockTransferStatus, [
      'DRAFT',
      'IN_TRANSIT',
    ]);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (transfer.status === 'IN_TRANSIT') {
        // The goods never arrived, so they go back where they came from.
        for (const item of transfer.items) {
          await this.ledger.applyMovement(tx, {
            organizationId: orgContext.organizationId,
            productId: item.productId,
            warehouseId: transfer.sourceWarehouseId,
            counterpartWarehouseId: transfer.destinationWarehouseId,
            type: 'TRANSFER_IN',
            delta: item.quantity,
            actorId,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            referenceCode: transfer.code,
            note: 'Transfer cancelled — stock returned to source',
          });
        }
      }

      return tx.stockTransfer.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: TRANSFER_INCLUDE,
      });
    });

    await this.afterMutation(orgContext, actorId, 'stock_transfer.cancelled', id, {
      code: transfer.code,
      returnedToSource: transfer.status === 'IN_TRANSIT',
    });

    return TransfersService.toView(updated);
  }

  private async load(orgContext: OrgContext, id: string): Promise<TransferRow> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId: orgContext.organizationId },
      include: TRANSFER_INCLUDE,
    });

    if (!transfer) {
      throw new NotFoundException('Stock transfer not found');
    }

    return transfer;
  }

  private static assertStatus(
    current: StockTransferStatus,
    allowed: readonly StockTransferStatus[],
  ): void {
    if (!allowed.includes(current)) {
      throw new ConflictException(
        `This transfer is ${current}; the action is only valid while it is ${allowed.join(' or ')}.`,
      );
    }
  }

  private async assertWarehousesInOrg(
    orgContext: OrgContext,
    warehouseIds: string[],
  ): Promise<void> {
    const found = await this.prisma.warehouse.count({
      where: { id: { in: warehouseIds }, organizationId: orgContext.organizationId },
    });

    if (found !== new Set(warehouseIds).size) {
      throw new BadRequestException('One or more warehouses do not exist in this organisation');
    }
  }

  private async assertProductsInOrg(
    orgContext: OrgContext,
    productIds: string[],
  ): Promise<void> {
    const found = await this.prisma.product.count({
      where: { id: { in: productIds }, organizationId: orgContext.organizationId },
    });

    if (found !== new Set(productIds).size) {
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
        entityType: 'StockTransfer',
        entityId,
        metadata: metadata as never,
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);
  }

  private static toView(transfer: TransferRow): StockTransferView {
    return {
      id: transfer.id,
      code: transfer.code,
      status: transfer.status as StockTransferStatus,
      notes: transfer.notes,
      sourceWarehouse: transfer.sourceWarehouse,
      destinationWarehouse: transfer.destinationWarehouse,
      items: transfer.items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        product: item.product,
      })),
      createdBy: transfer.createdBy,
      createdAt: transfer.createdAt.toISOString(),
      completedAt: transfer.completedAt?.toISOString() ?? null,
    };
  }
}
