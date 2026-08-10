import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export interface AuditEntry {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes the audit trail for privileged actions.
 *
 * Audit writes are best-effort by design: a failure to record history must
 * never roll back the business operation that succeeded. When an entry belongs
 * inside a transaction (so it lands atomically with the change it describes),
 * pass the transaction client to `recordWithin`.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an audit entry outside any transaction, swallowing failures.
   *
   * @param entry - The action to record.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toRow(entry) });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to write audit entry "${entry.action}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Records an audit entry using an existing transaction client, so it commits
   * or rolls back together with the change it describes.
   *
   * @param tx - The active Prisma transaction client.
   * @param entry - The action to record.
   */
  async recordWithin(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toRow(entry) });
  }

  private toRow(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    return {
      organizationId: entry.organizationId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
    };
  }
}
