import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from '../common/utils/csv.util';
import { toMoneyString } from '../common/utils/decimal.util';
import {
  assertWarehouseAccess,
  warehouseScopeFilter,
} from '../common/utils/warehouse-scope.util';
import type { OrgContext } from '../common/types/request-context';

/** Rows fetched per batch while streaming. */
const BATCH_SIZE = 500;

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Streams the product catalogue.
   *
   * @param orgContext - Resolved organisation context.
   * @param response - Express response to write into.
   */
  async streamProducts(
    orgContext: OrgContext,
    response: Response,
  ): Promise<void> {
    const scope = warehouseScopeFilter(orgContext);

    await this.stream(
      response,
      [
        'sku',
        'name',
        'category',
        'supplier',
        'unit',
        'unitPrice',
        'totalQuantity',
        'totalReserved',
        'reorderPoint',
        'isActive',
      ],
      async (skip) => {
        const rows = await this.prisma.product.findMany({
          where: { organizationId: orgContext.organizationId },
          orderBy: { sku: 'asc' },
          skip,
          take: BATCH_SIZE,
          include: {
            category: { select: { name: true } },
            supplier: { select: { name: true } },
            stockLevels: {
              where: scope ? { warehouseId: scope } : {},
              select: {
                quantity: true,
                reservedQuantity: true,
                reorderPoint: true,
              },
            },
          },
        });

        return rows.map((product) => [
          product.sku,
          product.name,
          product.category?.name ?? '',
          product.supplier?.name ?? '',
          product.unit,
          toMoneyString(product.unitPrice),
          product.stockLevels.reduce((sum, level) => sum + level.quantity, 0),
          product.stockLevels.reduce(
            (sum, level) => sum + level.reservedQuantity,
            0,
          ),
          product.defaultReorderPoint,
          product.isActive,
        ]);
      },
    );
  }

  /**
   * Streams current stock levels.
   *
   * @param orgContext - Resolved organisation context.
   * @param response - Express response to write into.
   * @param warehouseId - Optional warehouse filter.
   */
  async streamStockLevels(
    orgContext: OrgContext,
    response: Response,
    warehouseId?: string,
  ): Promise<void> {
    if (warehouseId) assertWarehouseAccess(orgContext, warehouseId);
    const scope = warehouseScopeFilter(orgContext);

    await this.stream(
      response,
      [
        'sku',
        'product',
        'warehouseCode',
        'warehouse',
        'quantity',
        'reserved',
        'available',
        'reorderPoint',
        'reorderQuantity',
        'belowThreshold',
      ],
      async (skip) => {
        const rows = await this.prisma.stockLevel.findMany({
          where: {
            organizationId: orgContext.organizationId,
            ...(warehouseId
              ? { warehouseId }
              : scope
                ? { warehouseId: scope }
                : {}),
          },
          orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }],
          skip,
          take: BATCH_SIZE,
          include: {
            product: { select: { sku: true, name: true } },
            warehouse: { select: { code: true, name: true } },
          },
        });

        return rows.map((level) => [
          level.product.sku,
          level.product.name,
          level.warehouse.code,
          level.warehouse.name,
          level.quantity,
          level.reservedQuantity,
          level.quantity - level.reservedQuantity,
          level.reorderPoint,
          level.reorderQuantity,
          level.reorderPoint > 0 && level.quantity <= level.reorderPoint,
        ]);
      },
    );
  }

  /**
   * Streams the movement ledger, newest first.
   *
   * @param orgContext - Resolved organisation context.
   * @param response - Express response to write into.
   * @param warehouseId - Optional warehouse filter.
   */
  async streamMovements(
    orgContext: OrgContext,
    response: Response,
    warehouseId?: string,
  ): Promise<void> {
    if (warehouseId) assertWarehouseAccess(orgContext, warehouseId);
    const scope = warehouseScopeFilter(orgContext);

    await this.stream(
      response,
      [
        'occurredAt',
        'type',
        'sku',
        'product',
        'warehouseCode',
        'counterpartCode',
        'quantity',
        'balanceAfter',
        'unitCost',
        'reference',
        'note',
        'recordedBy',
      ],
      async (skip) => {
        const rows = await this.prisma.stockMovement.findMany({
          where: {
            organizationId: orgContext.organizationId,
            ...(warehouseId
              ? { warehouseId }
              : scope
                ? { warehouseId: scope }
                : {}),
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: BATCH_SIZE,
          include: {
            product: { select: { sku: true, name: true } },
            warehouse: { select: { code: true } },
            counterpartWarehouse: { select: { code: true } },
            createdBy: { select: { fullName: true } },
          },
        });

        return rows.map((movement) => [
          movement.createdAt.toISOString(),
          movement.type,
          movement.product.sku,
          movement.product.name,
          movement.warehouse.code,
          movement.counterpartWarehouse?.code ?? '',
          movement.quantity,
          movement.balanceAfter,
          movement.unitCost ? toMoneyString(movement.unitCost) : '',
          movement.referenceCode ?? movement.referenceType,
          movement.note ?? '',
          movement.createdBy?.fullName ?? '',
        ]);
      },
    );
  }

  /**
   * Writes a header then pulls batches until a short page signals the end.
   *
   * Offset paging is fine here because the export is a point-in-time snapshot
   * and each batch is written and released before the next is fetched.
   */
  private async stream(
    response: Response,
    headers: string[],
    fetchBatch: (skip: number) => Promise<unknown[][]>,
  ): Promise<void> {
    response.write(
      toCsv(
        headers.map((header, index) => ({
          header,
          value: (row: unknown[]) => row[index],
        })),
        [],
      ),
    );

    let skip = 0;

    for (;;) {
      const batch = await fetchBatch(skip);
      if (batch.length === 0) break;

      response.write(
        toCsv(
          headers.map((header, index) => ({
            header,
            value: (row: unknown[]) => row[index],
          })),
          batch,
        )
          .split('\n')
          .slice(1) // the header was already written
          .join('\n'),
      );

      if (batch.length < BATCH_SIZE) break;
      skip += BATCH_SIZE;
    }

    response.end();
  }
}
