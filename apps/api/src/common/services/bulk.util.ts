import type { BulkResult } from '@wms/contracts';

/**
 * Runs an operation across many records, isolating failures.
 *
 * Bulk actions in this system are deliberately *not* transactional across the
 * whole set. Ten orders where three are in the wrong state is the normal case,
 * and rolling back the seven that worked would be actively unhelpful. Instead
 * each record is attempted independently and the caller is told exactly which
 * failed and why.
 *
 * Records are processed sequentially rather than in parallel: several of these
 * operations take row locks on stock, and firing them concurrently would have
 * them contend with each other for no throughput gain.
 *
 * @param items - Records to operate on, each with an id and display label.
 * @param operate - The per-record operation; throwing marks that record failed.
 * @returns Per-record outcomes plus totals.
 */
export async function runBulk<TItem extends { id: string; label: string }>(
  items: readonly TItem[],
  operate: (item: TItem) => Promise<void>,
): Promise<BulkResult> {
  const results: BulkResult['results'] = [];

  for (const item of items) {
    try {
      await operate(item);
      results.push({ id: item.id, label: item.label, ok: true });
    } catch (error: unknown) {
      results.push({
        id: item.id,
        label: item.label,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    requested: items.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}
