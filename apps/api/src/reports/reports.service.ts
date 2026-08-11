import { Injectable } from '@nestjs/common';
import type { DashboardSummaryView } from '@wms/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { warehouseScopeFilter } from '../common/utils/warehouse-scope.util';
import type { OrgContext } from '../common/types/request-context';
import { MOVEMENT_INCLUDE, toMovementView } from '../stock/stock.mapper';
import { StockService } from '../stock/stock.service';

/** One row of the 14-day inbound/outbound trend. */
interface TrendRow {
  day: Date;
  inbound: bigint | number;
  outbound: bigint | number;
}

/** Aggregate returned by the inventory-value query. */
interface ValuationRow {
  total: string | number | null;
}

const TREND_DAYS = 14;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly stockService: StockService,
  ) {}

  /**
   * Builds the dashboard summary.
   *
   * This is the single most-requested endpoint in the application and it runs
   * eight aggregates, so the whole payload is cached per (organisation,
   * warehouse scope). Any stock write invalidates the organisation's cache, so
   * the numbers can be at most one write behind, never stale across a change.
   *
   * @param orgContext - Resolved organisation context.
   * @returns The dashboard summary.
   */
  async dashboard(orgContext: OrgContext): Promise<DashboardSummaryView> {
    const scopeKey = orgContext.warehouseScope
      ? orgContext.warehouseScope.join(',')
      : 'unscoped';

    const cacheKey = this.cacheService.buildKey(
      orgContext.organizationId,
      'dashboard',
      scopeKey,
    );

    return this.cacheService.remember(cacheKey, async () => {
      const scope = warehouseScopeFilter(orgContext);
      const warehouseIds = orgContext.warehouseScope
        ? [...orgContext.warehouseScope]
        : null;
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
      const trendSince = new Date(
        Date.now() - TREND_DAYS * 24 * 60 * 60 * 1_000,
      );

      const [
        warehouseCount,
        productCount,
        stockAggregate,
        inventoryValue,
        openPurchaseOrders,
        openSalesOrders,
        movementsLast7Days,
        recentMovements,
        trend,
        lowStock,
      ] = await Promise.all([
        this.prisma.warehouse.count({
          where: {
            organizationId: orgContext.organizationId,
            ...(scope ? { id: scope } : {}),
          },
        }),
        this.prisma.product.count({
          where: { organizationId: orgContext.organizationId, isActive: true },
        }),
        this.prisma.stockLevel.aggregate({
          where: {
            organizationId: orgContext.organizationId,
            ...(scope ? { warehouseId: scope } : {}),
          },
          _sum: { quantity: true },
        }),
        this.inventoryValue(orgContext.organizationId, warehouseIds),
        this.prisma.purchaseOrder.count({
          where: {
            organizationId: orgContext.organizationId,
            status: { in: ['DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED'] },
            ...(scope ? { warehouseId: scope } : {}),
          },
        }),
        this.prisma.salesOrder.count({
          where: {
            organizationId: orgContext.organizationId,
            status: { in: ['DRAFT', 'ALLOCATED', 'PARTIALLY_FULFILLED'] },
            ...(scope ? { warehouseId: scope } : {}),
          },
        }),
        this.prisma.stockMovement.count({
          where: {
            organizationId: orgContext.organizationId,
            createdAt: { gte: since },
            ...(scope ? { warehouseId: scope } : {}),
          },
        }),
        this.prisma.stockMovement.findMany({
          where: {
            organizationId: orgContext.organizationId,
            ...(scope ? { warehouseId: scope } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
          include: MOVEMENT_INCLUDE,
        }),
        this.movementTrend(orgContext.organizationId, warehouseIds, trendSince),
        this.stockService.lowStock(orgContext),
      ]);

      return {
        warehouseCount,
        productCount,
        totalUnits: stockAggregate._sum.quantity ?? 0,
        inventoryValue,
        lowStockCount: lowStock.length,
        openPurchaseOrders,
        openSalesOrders,
        movementsLast7Days,
        recentMovements: recentMovements.map(toMovementView),
        topLowStock: lowStock.slice(0, 6),
        movementTrend: trend,
      };
    });
  }

  /**
   * Sums `quantity × unitPrice` across stock levels.
   *
   * Done in SQL rather than in JavaScript: pulling every stock level into the
   * process to multiply and add would be an unbounded fetch that grows with the
   * catalogue, and Postgres does exact decimal arithmetic for free.
   */
  private async inventoryValue(
    organizationId: string,
    warehouseIds: string[] | null,
  ): Promise<string> {
    const rows =
      warehouseIds === null
        ? await this.prisma.$queryRaw<ValuationRow[]>`
            SELECT COALESCE(SUM(sl.quantity * p."unitPrice"), 0)::text AS total
            FROM stock_levels sl
            JOIN products p ON p.id = sl."productId"
            WHERE sl."organizationId" = ${organizationId}
          `
        : warehouseIds.length === 0
          ? [{ total: '0' }]
          : await this.prisma.$queryRaw<ValuationRow[]>`
              SELECT COALESCE(SUM(sl.quantity * p."unitPrice"), 0)::text AS total
              FROM stock_levels sl
              JOIN products p ON p.id = sl."productId"
              WHERE sl."organizationId" = ${organizationId}
                AND sl."warehouseId" = ANY(${warehouseIds})
            `;

    return Number(rows[0]?.total ?? 0).toFixed(2);
  }

  /** Units in and out per day for the trend chart, oldest first. */
  private async movementTrend(
    organizationId: string,
    warehouseIds: string[] | null,
    since: Date,
  ): Promise<Array<{ date: string; inbound: number; outbound: number }>> {
    const rows =
      warehouseIds === null
        ? await this.prisma.$queryRaw<TrendRow[]>`
            SELECT date_trunc('day', "createdAt") AS day,
                   SUM(CASE WHEN type IN ('INBOUND','TRANSFER_IN') THEN quantity ELSE 0 END) AS inbound,
                   SUM(CASE WHEN type IN ('OUTBOUND','TRANSFER_OUT') THEN quantity ELSE 0 END) AS outbound
            FROM stock_movements
            WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${since}
            GROUP BY 1 ORDER BY 1 ASC
          `
        : warehouseIds.length === 0
          ? []
          : await this.prisma.$queryRaw<TrendRow[]>`
              SELECT date_trunc('day', "createdAt") AS day,
                     SUM(CASE WHEN type IN ('INBOUND','TRANSFER_IN') THEN quantity ELSE 0 END) AS inbound,
                     SUM(CASE WHEN type IN ('OUTBOUND','TRANSFER_OUT') THEN quantity ELSE 0 END) AS outbound
              FROM stock_movements
              WHERE "organizationId" = ${organizationId}
                AND "createdAt" >= ${since}
                AND "warehouseId" = ANY(${warehouseIds})
              GROUP BY 1 ORDER BY 1 ASC
            `;

    const byDate = new Map(
      rows.map((row) => [
        row.day.toISOString().slice(0, 10),
        { inbound: Number(row.inbound), outbound: Number(row.outbound) },
      ]),
    );

    // Days with no movement must still appear, otherwise the chart silently
    // compresses quiet periods and misrepresents the trend.
    return Array.from({ length: TREND_DAYS }, (_unused, index) => {
      const date = new Date(
        Date.now() - (TREND_DAYS - 1 - index) * 24 * 60 * 60 * 1_000,
      );
      const key = date.toISOString().slice(0, 10);
      const entry = byDate.get(key);
      return {
        date: key,
        inbound: entry?.inbound ?? 0,
        outbound: entry?.outbound ?? 0,
      };
    });
  }
}
