import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { MovementReferenceType, MovementType } from '@wms/contracts';
import type { Prisma, StockLevel } from '../generated/prisma/client';

/** A single stock change to apply atomically. */
export interface ApplyMovementParams {
  organizationId: string;
  productId: string;
  warehouseId: string;
  type: MovementType;
  /** Signed change. Its sign must agree with `type` for non-adjustment types. */
  delta: number;
  actorId: string | null;
  referenceType: MovementReferenceType;
  referenceId?: string | null;
  referenceCode?: string | null;
  counterpartWarehouseId?: string | null;
  unitCost?: string | null;
  note?: string | null;
  /**
   * When true (the default for manual and transfer outbounds), the move must
   * leave enough stock to honour existing sales-order reservations. Sales-order
   * fulfilment sets this to false, because it is consuming its own reservation.
   */
  respectReservations?: boolean;
  /** Reservation change applied in the same statement, used by order flows. */
  reservedDelta?: number;
}

/** Row shape returned by the `SELECT … FOR UPDATE` lock query. */
interface LockedStockLevel {
  id: string;
  quantity: number;
  reservedQuantity: number;
}

/**
 * The single choke point through which every stock change passes.
 *
 * Centralising this is what keeps the ledger trustworthy: purchase receipts,
 * dispatches, transfers, manual adjustments and queued bulk jobs all call
 * `applyMovement`, so there is exactly one place that can move a number and
 * exactly one place that writes the matching ledger row. Nothing can change
 * stock without leaving a trace, because there is no other code path that can.
 *
 * Concurrency is handled with `SELECT … FOR UPDATE`. Two pickers dispatching
 * the last unit of a SKU at the same moment serialise on the row lock, so the
 * second one sees the first one's decrement and is rejected, rather than both
 * reading "1 available" and driving stock negative.
 */
@Injectable()
export class StockLedgerService {
  /**
   * Applies one stock change and appends its ledger row.
   *
   * Must be called inside a transaction — the row lock it takes is only held
   * until that transaction commits.
   *
   * @param tx - The active Prisma transaction client.
   * @param params - The change to apply.
   * @returns The stock level as it stands after the change.
   * @throws BadRequestException when the delta's sign contradicts the movement type.
   * @throws ConflictException when the move would drive stock negative or break a reservation.
   */
  async applyMovement(
    tx: Prisma.TransactionClient,
    params: ApplyMovementParams,
  ): Promise<StockLevel> {
    StockLedgerService.assertDirection(params.type, params.delta);

    if (params.delta === 0 && (params.reservedDelta ?? 0) === 0) {
      throw new BadRequestException('A stock movement must change something');
    }

    const level = await this.lockOrCreateLevel(tx, params);

    const nextQuantity = level.quantity + params.delta;
    const nextReserved = level.reservedQuantity + (params.reservedDelta ?? 0);

    if (nextQuantity < 0) {
      throw new ConflictException(
        `Insufficient stock: ${level.quantity} on hand, tried to remove ${Math.abs(params.delta)}`,
      );
    }

    if (nextReserved < 0) {
      throw new ConflictException('Cannot release more stock than is reserved');
    }

    const respectReservations = params.respectReservations ?? params.delta < 0;
    if (respectReservations && nextQuantity < nextReserved) {
      const available = level.quantity - level.reservedQuantity;
      throw new ConflictException(
        `Insufficient available stock: ${available} available (${level.quantity} on hand, ${level.reservedQuantity} reserved for open orders)`,
      );
    }

    const updated = await tx.stockLevel.update({
      where: { id: level.id },
      data: { quantity: nextQuantity, reservedQuantity: nextReserved },
    });

    // A pure reservation change moves no goods, so it gets no ledger row —
    // the ledger records physical movement, not intent.
    if (params.delta !== 0) {
      await tx.stockMovement.create({
        data: {
          organizationId: params.organizationId,
          productId: params.productId,
          warehouseId: params.warehouseId,
          counterpartWarehouseId: params.counterpartWarehouseId ?? null,
          type: params.type,
          quantity: Math.abs(params.delta),
          balanceAfter: nextQuantity,
          unitCost: params.unitCost ?? null,
          note: params.note ?? null,
          referenceType: params.referenceType,
          referenceId: params.referenceId ?? null,
          referenceCode: params.referenceCode ?? null,
          createdById: params.actorId,
        },
      });
    }

    return updated;
  }

  /**
   * Adjusts only the reserved quantity, leaving on-hand stock untouched. Used
   * when a sales order is allocated or cancelled.
   *
   * @param tx - The active Prisma transaction client.
   * @param params - Identifies the stock level and the reservation delta.
   * @returns The stock level after the change.
   */
  async adjustReservation(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      productId: string;
      warehouseId: string;
      reservedDelta: number;
    },
  ): Promise<StockLevel> {
    const level = await this.lockOrCreateLevel(tx, params);
    const nextReserved = level.reservedQuantity + params.reservedDelta;

    if (nextReserved < 0) {
      throw new ConflictException('Cannot release more stock than is reserved');
    }

    if (nextReserved > level.quantity) {
      throw new ConflictException(
        `Cannot reserve ${params.reservedDelta} units: only ${level.quantity - level.reservedQuantity} available`,
      );
    }

    return tx.stockLevel.update({
      where: { id: level.id },
      data: { reservedQuantity: nextReserved },
    });
  }

  /**
   * Takes a row lock on the (product, warehouse) stock level, creating it from
   * the product's defaults if this is the first movement for the pair.
   */
  private async lockOrCreateLevel(
    tx: Prisma.TransactionClient,
    params: { organizationId: string; productId: string; warehouseId: string },
  ): Promise<LockedStockLevel> {
    const locked = await tx.$queryRaw<LockedStockLevel[]>`
      SELECT id, quantity, "reservedQuantity"
      FROM stock_levels
      WHERE "productId" = ${params.productId}
        AND "warehouseId" = ${params.warehouseId}
      FOR UPDATE
    `;

    if (locked.length > 0) {
      return locked[0];
    }

    const product = await tx.product.findFirst({
      where: { id: params.productId, organizationId: params.organizationId },
      select: { defaultReorderPoint: true, defaultReorderQuantity: true },
    });

    if (!product) {
      throw new BadRequestException(
        'Product does not exist in this organisation',
      );
    }

    // Two requests can race to create the same pair; the unique constraint on
    // (productId, warehouseId) makes the loser's upsert fall through to an
    // update, after which it re-reads under the lock.
    const created = await tx.stockLevel.upsert({
      where: {
        productId_warehouseId: {
          productId: params.productId,
          warehouseId: params.warehouseId,
        },
      },
      create: {
        organizationId: params.organizationId,
        productId: params.productId,
        warehouseId: params.warehouseId,
        quantity: 0,
        reservedQuantity: 0,
        reorderPoint: product.defaultReorderPoint,
        reorderQuantity: product.defaultReorderQuantity,
      },
      update: {},
      select: { id: true, quantity: true, reservedQuantity: true },
    });

    return created;
  }

  /** Rejects a delta whose sign contradicts the declared movement type. */
  private static assertDirection(type: MovementType, delta: number): void {
    const mustBePositive = type === 'INBOUND' || type === 'TRANSFER_IN';
    const mustBeNegative = type === 'OUTBOUND' || type === 'TRANSFER_OUT';

    if (mustBePositive && delta < 0) {
      throw new BadRequestException(`${type} movements must increase stock`);
    }

    if (mustBeNegative && delta > 0) {
      throw new BadRequestException(`${type} movements must decrease stock`);
    }
  }
}
