/** Name of the BullMQ queue that processes bulk stock work. */
export const BULK_STOCK_QUEUE = 'bulk-stock';

/** Job name for a queued bulk stock adjustment. */
export const BULK_STOCK_ADJUSTMENT_JOB = 'bulk-stock-adjustment';

/** Payload handed to the worker. Deliberately small — the lines live in the DB. */
export interface BulkStockJobPayload {
  bulkJobId: string;
  organizationId: string;
  actorId: string;
  lines: Array<{
    sku: string;
    warehouseCode: string;
    delta: number;
    reason?: string;
  }>;
}
