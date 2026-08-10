import { ConflictException } from '@nestjs/common';

/**
 * Optimistic concurrency for editable documents.
 *
 * Stock is already safe under concurrency — the ledger takes row locks. What
 * was not safe is *document* editing: two managers opening the same purchase
 * order and saving would silently last-write-wins, and the loser would never
 * know their change vanished.
 *
 * The client echoes the `version` it read; if the row has moved on, the write
 * is rejected with 409 and a message that says what actually happened. This is
 * preferred over pessimistic locking because an order can sit open in a browser
 * tab for an hour, and holding a database lock for that long is not viable.
 */

/**
 * Rejects a write whose expected version no longer matches the stored one.
 *
 * A missing `expectedVersion` is allowed and skips the check, so integrations
 * that do not track versions keep working; the dashboard always sends it.
 *
 * @param entity - Human-readable name used in the error message.
 * @param currentVersion - The version currently stored.
 * @param expectedVersion - The version the caller believes is current.
 * @throws ConflictException when the versions disagree.
 */
export function assertVersion(
  entity: string,
  currentVersion: number,
  expectedVersion?: number,
): void {
  if (expectedVersion === undefined) {
    return;
  }

  if (expectedVersion !== currentVersion) {
    throw new ConflictException(
      `This ${entity} was changed by someone else (you have version ${expectedVersion}, the current version is ${currentVersion}). Reload it and reapply your changes.`,
    );
  }
}

/**
 * Prisma `where` fragment that makes the version check atomic.
 *
 * Checking the version in JavaScript and then updating leaves a window in which
 * another request can commit first. Folding the version into the `where` means
 * the database itself refuses the stale write.
 *
 * @param id - Row identifier.
 * @param expectedVersion - Version the caller believes is current.
 * @returns A `where` object that also matches on version when one was supplied.
 */
export function versionedWhere(
  id: string,
  expectedVersion?: number,
): { id: string; version?: number } {
  return expectedVersion === undefined ? { id } : { id, version: expectedVersion };
}
