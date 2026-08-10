import type { MovementType, StockLevelView, StockMovementView } from '@wms/contracts';
import { toMoneyString, toNullableMoneyString } from '../common/utils/decimal.util';
import type { Prisma } from '../generated/prisma/client';

export const MOVEMENT_INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  counterpartWarehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.StockMovementInclude;

export const STOCK_LEVEL_INCLUDE = {
  product: { select: { id: true, name: true, sku: true, unit: true, unitPrice: true } },
  warehouse: { select: { id: true, name: true, code: true } },
} satisfies Prisma.StockLevelInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;
type StockLevelRow = Prisma.StockLevelGetPayload<{ include: typeof STOCK_LEVEL_INCLUDE }>;

/** Movement types that increase the affected warehouse's balance. */
const INBOUND_TYPES: readonly MovementType[] = ['INBOUND', 'TRANSFER_IN'];

/**
 * Maps a ledger row to the API view model.
 *
 * The database stores one required `warehouseId` (the site whose balance moved)
 * plus an optional counterpart. The UI wants the familiar "from → to" reading,
 * so the pair is reconstructed here from the movement's direction rather than
 * being stored ambiguously.
 *
 * @param movement - Ledger row with its relations loaded.
 * @returns The serialisable movement view.
 */
export function toMovementView(movement: MovementRow): StockMovementView {
  const isInbound = INBOUND_TYPES.includes(movement.type as MovementType);

  return {
    id: movement.id,
    type: movement.type as MovementType,
    quantity: movement.quantity,
    balanceAfter: movement.balanceAfter,
    unitCost: toNullableMoneyString(movement.unitCost),
    note: movement.note,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    referenceCode: movement.referenceCode,
    product: movement.product,
    sourceWarehouse: isInbound ? movement.counterpartWarehouse : movement.warehouse,
    destinationWarehouse: isInbound ? movement.warehouse : movement.counterpartWarehouse,
    createdBy: movement.createdBy,
    createdAt: movement.createdAt.toISOString(),
  };
}

/**
 * Maps a stock level row to the API view model.
 *
 * @param level - Stock level row with its relations loaded.
 * @returns The serialisable stock level view.
 */
export function toStockLevelView(level: StockLevelRow): StockLevelView {
  return {
    id: level.id,
    quantity: level.quantity,
    reservedQuantity: level.reservedQuantity,
    availableQuantity: level.quantity - level.reservedQuantity,
    reorderPoint: level.reorderPoint,
    reorderQuantity: level.reorderQuantity,
    isBelowThreshold: level.reorderPoint > 0 && level.quantity <= level.reorderPoint,
    product: {
      id: level.product.id,
      name: level.product.name,
      sku: level.product.sku,
      unit: level.product.unit,
      unitPrice: toMoneyString(level.product.unitPrice),
    },
    warehouse: level.warehouse,
    updatedAt: level.updatedAt.toISOString(),
  };
}
