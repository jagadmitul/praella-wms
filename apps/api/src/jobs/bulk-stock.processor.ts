import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import { BULK_STOCK_QUEUE, type BulkStockJobPayload } from './jobs.constants';

/** One failed line, reported back on the job record. */
interface LineError {
  line: number;
  message: string;
}

/** How many lines are applied per database transaction. */
const CHUNK_SIZE = 100;

/**
 * Applies queued bulk stock adjustments.
 *
 * Two decisions worth calling out:
 *
 * 1. Lines are applied in chunks, each in its own transaction. One 20 000-line
 *    transaction would hold row locks across the entire catalogue for minutes
 *    and block every picker in the building; 200 short transactions do not.
 *
 * 2. A bad line fails that line, not the job. A bulk import is a bag of
 *    independent corrections, so rejecting all 20 000 because row 8 431 has a
 *    typo would be actively unhelpful. Failures are counted and reported
 *    per-line on the job record.
 */
@Processor(BULK_STOCK_QUEUE, { concurrency: 2 })
export class BulkStockProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkStockProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly cacheService: CacheService,
  ) {
    super();
  }

  /**
   * Processes one bulk stock adjustment job.
   *
   * @param job - The queued job carrying its lines.
   * @returns A summary of processed and failed lines.
   */
  async process(
    job: Job<BulkStockJobPayload>,
  ): Promise<{ processed: number; failed: number }> {
    const { bulkJobId, organizationId, actorId, lines } = job.data;

    await this.prisma.bulkJob.update({
      where: { id: bulkJobId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });

    const errors: LineError[] = [];
    let processed = 0;

    // Resolve SKUs and warehouse codes to ids once, rather than per line.
    const [products, warehouses] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          organizationId,
          sku: { in: [...new Set(lines.map((l) => l.sku))] },
        },
        select: { id: true, sku: true },
      }),
      this.prisma.warehouse.findMany({
        where: {
          organizationId,
          code: { in: [...new Set(lines.map((l) => l.warehouseCode))] },
        },
        select: { id: true, code: true },
      }),
    ]);

    const productBySku = new Map(products.map((p) => [p.sku, p.id]));
    const warehouseByCode = new Map(warehouses.map((w) => [w.code, w.id]));

    for (let offset = 0; offset < lines.length; offset += CHUNK_SIZE) {
      const chunk = lines.slice(offset, offset + CHUNK_SIZE);

      for (const [index, line] of chunk.entries()) {
        const lineNumber = offset + index + 1;
        const productId =
          productBySku.get(line.sku.toUpperCase()) ??
          productBySku.get(line.sku);
        const warehouseId =
          warehouseByCode.get(line.warehouseCode.toUpperCase()) ??
          warehouseByCode.get(line.warehouseCode);

        if (!productId) {
          errors.push({
            line: lineNumber,
            message: `Unknown SKU "${line.sku}"`,
          });
          continue;
        }

        if (!warehouseId) {
          errors.push({
            line: lineNumber,
            message: `Unknown warehouse code "${line.warehouseCode}"`,
          });
          continue;
        }

        if (line.delta === 0) {
          errors.push({ line: lineNumber, message: 'Delta cannot be zero' });
          continue;
        }

        try {
          await this.prisma.$transaction(async (tx) => {
            await this.ledger.applyMovement(tx, {
              organizationId,
              productId,
              warehouseId,
              type: 'ADJUSTMENT',
              delta: line.delta,
              actorId,
              referenceType: 'BULK_JOB',
              referenceId: bulkJobId,
              note: line.reason ?? 'Bulk stock adjustment',
              respectReservations: line.delta < 0,
            });
          });

          processed += 1;
        } catch (error: unknown) {
          errors.push({
            line: lineNumber,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await job.updateProgress(
        Math.round(((offset + chunk.length) / lines.length) * 100),
      );

      await this.prisma.bulkJob.update({
        where: { id: bulkJobId },
        data: { processedLines: processed, failedLines: errors.length },
      });
    }

    await this.prisma.bulkJob.update({
      where: { id: bulkJobId },
      data: {
        status: errors.length === 0 ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS',
        processedLines: processed,
        failedLines: errors.length,
        // Cap what is stored: a 50 000-line job with every line broken should
        // not write a multi-megabyte JSON blob into the row.
        errors: errors.slice(0, 100).map((error) => ({ ...error })),
        finishedAt: new Date(),
      },
    });

    await this.cacheService.invalidateOrganization(organizationId);

    this.logger.log(
      `Bulk job ${bulkJobId}: ${processed} applied, ${errors.length} failed of ${lines.length} lines`,
    );

    return { processed, failed: errors.length };
  }
}
