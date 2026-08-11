import { ForbiddenException } from '@nestjs/common';
import type { OrgContext } from '../types/request-context';

/**
 * Builds the warehouse-id filter fragment for a scoped membership.
 *
 * Returns `undefined` for unrestricted roles so the caller can spread it into a
 * Prisma `where` clause without branching.
 *
 * @param orgContext - Resolved organisation context for the request.
 * @returns A Prisma filter such as `{ in: [...] }`, or `undefined`.
 */
export function warehouseScopeFilter(
  orgContext: OrgContext,
): { in: string[] } | undefined {
  return orgContext.warehouseScope === null
    ? undefined
    : { in: [...orgContext.warehouseScope] };
}

/**
 * Asserts that the caller may act on a specific warehouse.
 *
 * @param orgContext - Resolved organisation context for the request.
 * @param warehouseId - Warehouse the request is trying to touch.
 * @throws ForbiddenException when a scoped membership is not assigned to it.
 */
export function assertWarehouseAccess(
  orgContext: OrgContext,
  warehouseId: string,
): void {
  if (orgContext.warehouseScope === null) {
    return;
  }

  if (!orgContext.warehouseScope.includes(warehouseId)) {
    throw new ForbiddenException(
      'You do not have access to this warehouse. Ask an admin to assign you to it.',
    );
  }
}

/**
 * Asserts access to several warehouses at once, e.g. both ends of a transfer.
 *
 * @param orgContext - Resolved organisation context for the request.
 * @param warehouseIds - Warehouses the request is trying to touch.
 */
export function assertWarehousesAccess(
  orgContext: OrgContext,
  warehouseIds: readonly string[],
): void {
  for (const warehouseId of warehouseIds) {
    assertWarehouseAccess(orgContext, warehouseId);
  }
}
