import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdjustStockInput,
  LowStockItemView,
  MovementQuery,
  Paginated,
  RecordMovementInput,
  SetReplenishmentRuleInput,
  StockLevelQuery,
  StockLevelView,
  StockMovementView,
} from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../common/services/audit.service';
import { buildOrderBy, paginate, toPrismaPage } from '../common/utils/pagination.util';
import {
  assertWarehouseAccess,
  warehouseScopeFilter,
} from '../common/utils/warehouse-scope.util';
import type { OrgContext } from '../common/types/request-context';
import type { Prisma } from '../generated/prisma/client';
import { StockLedgerService } from './stock-ledger.service';
import {
  MOVEMENT_INCLUDE,
  STOCK_LEVEL_INCLUDE,
  toMovementView,
  toStockLevelView,
} from './stock.mapper';

const LEVEL_SORTABLE_FIELDS = ['quantity', 'updatedAt', 'reorderPoint'] as const;

/**
 * Filter matching stock levels at or below their replenishment threshold.
 *
 * `quantity <= reorderPoint` compares two columns, which Prisma expresses with
 * a field reference — so the whole predicate runs in Postgres and the endpoint
 * paginates correctly. Doing the comparison in JavaScript, as an earlier
 * version did, silently broke `totalItems` because rows were dropped *after*
 * the page had already been taken.
 *
 * `reorderPoint > 0` is kept as a separate, indexable predicate: a threshold of
 * zero means "not tracked", not "always low".
 *
 * @param prisma - Client instance, needed to reach `fields` for the reference.
 * @returns A Prisma `where` fragment to spread into a stock-level query.
 */
export function belowThresholdFilter(
  prisma: PrismaService,
): Prisma.StockLevelWhereInput {
  return {
    reorderPoint: { gt: 0 },
    quantity: { lte: prisma.stockLevel.fields.reorderPoint },
  };
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly cacheService: CacheService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Lists stock levels across products and warehouses.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination and filter options.
   * @returns A page of stock levels.
   */
  async listLevels(
    orgContext: OrgContext,
    query: StockLevelQuery,
  ): Promise<Paginated<StockLevelView>> {
    const where = this.buildLevelWhere(orgContext, query);

    const [rows, totalItems] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: buildOrderBy(
          query.sortBy,
          query.sortDir,
          LEVEL_SORTABLE_FIELDS,
          'updatedAt',
        ),
        include: STOCK_LEVEL_INCLUDE,
      }),
      this.prisma.stockLevel.count({ where }),
    ]);

    return paginate(rows.map(toStockLevelView), totalItems, query);
  }

  /**
   * Lists ledger entries, newest first, for stock movement history.
   *
   * @param orgContext - Resolved organisation context.
   * @param query - Pagination, filter and date-range options.
   * @returns A page of movements.
   */
  async listMovements(
    orgContext: OrgContext,
    query: MovementQuery,
  ): Promise<Paginated<StockMovementView>> {
    const scope = warehouseScopeFilter(orgContext);

    const where: Prisma.StockMovementWhereInput = {
      organizationId: orgContext.organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : scope ? { warehouseId: scope } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { product: { name: { contains: query.search, mode: 'insensitive' } } },
              { product: { sku: { contains: query.search, mode: 'insensitive' } } },
              { referenceCode: { contains: query.search, mode: 'insensitive' } },
              { note: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (query.warehouseId) {
      assertWarehouseAccess(orgContext, query.warehouseId);
    }

    const [rows, totalItems] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        ...toPrismaPage(query),
        orderBy: { createdAt: query.sortDir },
        include: MOVEMENT_INCLUDE,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return paginate(rows.map(toMovementView), totalItems, query);
  }

  /**
   * Applies a manual stock adjustment, e.g. after a physical count.
   *
   * Requires `stock:adjust`, which STAFF do not hold.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User performing the adjustment.
   * @param input - Validated adjustment payload.
   * @returns The stock level after the adjustment.
   */
  async adjust(
    orgContext: OrgContext,
    actorId: string,
    input: AdjustStockInput,
  ): Promise<StockLevelView> {
    assertWarehouseAccess(orgContext, input.warehouseId);
    await this.assertWarehouseInOrg(orgContext, input.warehouseId);

    const level = await this.prisma.$transaction(async (tx) => {
      const updated = await this.ledger.applyMovement(tx, {
        organizationId: orgContext.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: 'ADJUSTMENT',
        delta: input.delta,
        actorId,
        referenceType: 'MANUAL_ADJUSTMENT',
        note: input.reason,
        respectReservations: input.delta < 0,
      });

      await this.auditService.recordWithin(tx, {
        organizationId: orgContext.organizationId,
        actorId,
        action: 'stock.adjusted',
        entityType: 'StockLevel',
        entityId: updated.id,
        metadata: {
          productId: input.productId,
          warehouseId: input.warehouseId,
          delta: input.delta,
          reason: input.reason,
          balanceAfter: updated.quantity,
        },
      });

      return updated;
    });

    await this.cacheService.invalidateOrganization(orgContext.organizationId);
    return this.loadLevelView(level.id);
  }

  /**
   * Records a physical inbound or outbound movement. This is the one stock
   * write STAFF are permitted to make.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User recording the movement.
   * @param input - Validated movement payload.
   * @returns The stock level after the movement.
   */
  async recordMovement(
    orgContext: OrgContext,
    actorId: string,
    input: RecordMovementInput,
  ): Promise<StockLevelView> {
    assertWarehouseAccess(orgContext, input.warehouseId);
    await this.assertWarehouseInOrg(orgContext, input.warehouseId);

    const level = await this.prisma.$transaction(async (tx) =>
      this.ledger.applyMovement(tx, {
        organizationId: orgContext.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: input.type,
        delta: input.type === 'INBOUND' ? input.quantity : -input.quantity,
        actorId,
        referenceType: 'MANUAL_ADJUSTMENT',
        unitCost: input.unitCost?.toFixed(2) ?? null,
        note: input.note ?? null,
      }),
    );

    await this.cacheService.invalidateOrganization(orgContext.organizationId);
    return this.loadLevelView(level.id);
  }

  /**
   * Sets the minimum stock threshold and reorder quantity for one product in
   * one warehouse.
   *
   * @param orgContext - Resolved organisation context.
   * @param actorId - User setting the rule.
   * @param input - Validated replenishment rule.
   * @returns The stock level carrying the new rule.
   */
  async setReplenishmentRule(
    orgContext: OrgContext,
    actorId: string,
    input: SetReplenishmentRuleInput,
  ): Promise<StockLevelView> {
    assertWarehouseAccess(orgContext, input.warehouseId);
    await this.assertWarehouseInOrg(orgContext, input.warehouseId);

    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, organizationId: orgContext.organizationId },
      select: { id: true },
    });

    if (!product) {
      throw new BadRequestException('Product does not exist in this organisation');
    }

    const level = await this.prisma.stockLevel.upsert({
      where: {
        productId_warehouseId: {
          productId: input.productId,
          warehouseId: input.warehouseId,
        },
      },
      create: {
        organizationId: orgContext.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: 0,
        reorderPoint: input.reorderPoint,
        reorderQuantity: input.reorderQuantity,
      },
      update: {
        reorderPoint: input.reorderPoint,
        reorderQuantity: input.reorderQuantity,
      },
      include: STOCK_LEVEL_INCLUDE,
    });

    await Promise.all([
      this.auditService.record({
        organizationId: orgContext.organizationId,
        actorId,
        action: 'replenishment_rule.set',
        entityType: 'StockLevel',
        entityId: level.id,
        metadata: {
          reorderPoint: input.reorderPoint,
          reorderQuantity: input.reorderQuantity,
        },
      }),
      this.cacheService.invalidateOrganization(orgContext.organizationId),
    ]);

    return toStockLevelView(level);
  }

  /**
   * Lists every stock level at or below its replenishment threshold, with the
   * shortfall and a suggested order quantity.
   *
   * Cached briefly: this is the dashboard's most-hit query, and a minute-old
   * reorder list is operationally identical to a live one.
   *
   * @param orgContext - Resolved organisation context.
   * @param warehouseId - Optional warehouse filter.
   * @returns Low-stock lines, most urgent first.
   */
  async lowStock(
    orgContext: OrgContext,
    warehouseId?: string,
  ): Promise<LowStockItemView[]> {
    if (warehouseId) {
      assertWarehouseAccess(orgContext, warehouseId);
    }

    const cacheKey = this.cacheService.buildKey(
      orgContext.organizationId,
      'low-stock',
      warehouseId ?? 'all',
      orgContext.warehouseScope ? orgContext.warehouseScope.join(',') : 'unscoped',
    );

    return this.cacheService.remember(cacheKey, async () => {
      const scope = warehouseScopeFilter(orgContext);

      const rows = await this.prisma.stockLevel.findMany({
        where: {
          organizationId: orgContext.organizationId,
          ...belowThresholdFilter(this.prisma),
          ...(warehouseId ? { warehouseId } : scope ? { warehouseId: scope } : {}),
          product: { isActive: true },
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              supplier: { select: { id: true, name: true } },
            },
          },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      });

      return rows
        .map((level) => ({
          productId: level.product.id,
          productName: level.product.name,
          sku: level.product.sku,
          warehouseId: level.warehouse.id,
          warehouseName: level.warehouse.name,
          warehouseCode: level.warehouse.code,
          quantity: level.quantity,
          reorderPoint: level.reorderPoint,
          shortfall: level.reorderPoint - level.quantity,
          suggestedOrderQuantity:
            level.reorderQuantity > 0
              ? level.reorderQuantity
              : Math.max(level.reorderPoint - level.quantity, 0),
          supplier: level.product.supplier,
        }))
        .sort((a, b) => b.shortfall - a.shortfall);
    });
  }

  /** Builds the shared `where` clause for stock level queries. */
  private buildLevelWhere(
    orgContext: OrgContext,
    query: StockLevelQuery,
  ): Prisma.StockLevelWhereInput {
    const scope = warehouseScopeFilter(orgContext);

    if (query.warehouseId) {
      assertWarehouseAccess(orgContext, query.warehouseId);
    }

    return {
      organizationId: orgContext.organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.warehouseId
        ? { warehouseId: query.warehouseId }
        : scope
          ? { warehouseId: scope }
          : {}),
      ...(query.categoryId ? { product: { categoryId: query.categoryId } } : {}),
      ...(query.belowThreshold ? belowThresholdFilter(this.prisma) : {}),
      ...(query.search
        ? {
            product: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
  }

  private async assertWarehouseInOrg(
    orgContext: OrgContext,
    warehouseId: string,
  ): Promise<void> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: orgContext.organizationId },
      select: { id: true },
    });

    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
  }

  private async loadLevelView(id: string): Promise<StockLevelView> {
    const level = await this.prisma.stockLevel.findUniqueOrThrow({
      where: { id },
      include: STOCK_LEVEL_INCLUDE,
    });

    return toStockLevelView(level);
  }
}
