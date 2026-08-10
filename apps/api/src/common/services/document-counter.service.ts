import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

/** Document families that get their own per-organisation sequence. */
export type CounterScope = 'PO' | 'SO' | 'TRF';

const PREFIXES: Record<CounterScope, string> = {
  PO: 'PO',
  SO: 'SO',
  TRF: 'TRF',
};

@Injectable()
export class DocumentCounterService {
  /**
   * Mints the next human-readable document code for an organisation, e.g.
   * `PO-000042`.
   *
   * This must be called with the same transaction client that creates the
   * document. The `upsert` takes a row lock on the counter, so two concurrent
   * requests serialise on it and can never be handed the same number — which a
   * `SELECT max(code) + 1` would happily do under load.
   *
   * @param tx - The active Prisma transaction client.
   * @param organizationId - Organisation the sequence belongs to.
   * @param scope - Document family to increment.
   * @returns The formatted document code.
   */
  async next(
    tx: Prisma.TransactionClient,
    organizationId: string,
    scope: CounterScope,
  ): Promise<string> {
    const counter = await tx.documentCounter.upsert({
      where: { organizationId_scope: { organizationId, scope } },
      create: { organizationId, scope, value: 1 },
      update: { value: { increment: 1 } },
      select: { value: true },
    });

    return `${PREFIXES[scope]}-${String(counter.value).padStart(6, '0')}`;
  }
}
