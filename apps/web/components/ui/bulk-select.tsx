'use client';

import { createContext, useActionState, useContext, useMemo, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { BulkResult } from '@wms/contracts';
import { IDLE, type ActionState } from '@/lib/actions/types';
import { buttonClass } from './index';
import { cn } from '@/lib/cn';

/**
 * Row selection with bulk actions.
 *
 * Selection lives in React state rather than the URL — unlike filters, a set of
 * checked ids is not something anyone wants to bookmark or share, and putting
 * a hundred ids in the query string would be unreadable.
 *
 * The action bar only appears once something is selected, so the table is not
 * permanently carrying chrome for an occasional operation.
 */

interface BulkContextValue {
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleAll: () => void;
  allIds: string[];
  clear: () => void;
}

const BulkContext = createContext<BulkContextValue | null>(null);

function useBulk(): BulkContextValue {
  const context = useContext(BulkContext);
  if (!context) {
    throw new Error('Bulk selection components must be used inside <BulkProvider>');
  }
  return context;
}

export function BulkProvider({
  allIds,
  children,
}: {
  allIds: string[];
  children: ReactNode;
}) {
  const [checked, setSelected] = useState<Set<string>>(new Set());

  // Ids change when the page or filters change. The visible selection is
  // narrowed to what is actually on screen by deriving it during render rather
  // than pruning the stored set from an effect: the guarantee is the same — a
  // hidden row can never be acted on — without a render pass per page change.
  const key = allIds.join(',');
  const selected = useMemo(() => {
    const visible = new Set(allIds);
    return new Set([...checked].filter((id) => visible.has(id)));
    // `key` stands in for `allIds`, which is a fresh array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, key]);

  const value = useMemo<BulkContextValue>(
    () => ({
      selected,
      allIds,
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      toggleAll: () =>
        setSelected((current) =>
          current.size === allIds.length ? new Set() : new Set(allIds),
        ),
      clear: () => setSelected(new Set()),
    }),
    [selected, allIds],
  );

  return <BulkContext value={value}>{children}</BulkContext>;
}

/** Header checkbox that selects or clears every row on the page. */
export function BulkSelectAll() {
  const { selected, allIds, toggleAll } = useBulk();
  const all = allIds.length > 0 && selected.size === allIds.length;
  const some = selected.size > 0 && !all;

  return (
    <input
      type="checkbox"
      checked={all}
      ref={(node) => {
        if (node) node.indeterminate = some;
      }}
      onChange={toggleAll}
      aria-label={all ? 'Clear selection' : 'Select all rows on this page'}
      className="size-4 cursor-pointer rounded border-line-strong accent-brand-600"
    />
  );
}

/** Per-row checkbox. */
export function BulkRowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useBulk();

  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={`Select ${label}`}
      className="size-4 cursor-pointer rounded border-line-strong accent-brand-600"
    />
  );
}

function ApplyButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass('primary', 'px-2.5 py-1.5 text-xs')}
    >
      {pending ? 'Working…' : label}
    </button>
  );
}

export interface BulkAction {
  value: string;
  label: string;
  /** Shown in a confirm dialog before running. */
  confirm?: string;
}

/**
 * The floating action bar, rendered only when rows are selected.
 *
 * Results are reported per record because a bulk transition across ten orders
 * where three are in the wrong state is normal — "3 failed" without saying
 * which three would make the feature untrustworthy.
 */
export function BulkActionBar({
  actions,
  action,
  noun,
}: {
  actions: BulkAction[];
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  noun: string;
}) {
  const { selected, clear } = useBulk();
  const [state, formAction] = useActionState(action, IDLE);
  const [choice, setChoice] = useState(actions[0]?.value ?? '');
  // The per-item report is the action's own result, so it is read straight off
  // `state`; only the dismissal needs remembering. `useActionState` hands back a
  // new object per submission, so identity is a safe marker for "this one has
  // been read".
  const [dismissed, setDismissed] = useState<ActionState | null>(null);
  const report: BulkResult | null =
    state.status === 'success' && state.result && dismissed !== state
      ? state.result
      : null;

  if (selected.size === 0 && !report) return null;

  const chosen = actions.find((candidate) => candidate.value === choice);

  return (
    <>
      {selected.size > 0 && !report ? (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
          <form
            action={formAction}
            onSubmit={(event) => {
              if (chosen?.confirm && !window.confirm(`${chosen.confirm} (${selected.size} ${noun})`)) {
                event.preventDefault();
              }
            }}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-lg"
          >
            <input type="hidden" name="ids" value={[...selected].join(',')} />

            <span className="px-1 text-xs font-medium text-ink-700">
              {selected.size} {noun}
              {selected.size === 1 ? '' : 's'} selected
            </span>

            <select
              name="action"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              aria-label="Bulk action"
              className="field w-auto py-1.5 text-xs"
            >
              {actions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <ApplyButton label="Apply" />

            <button
              type="button"
              onClick={clear}
              className={buttonClass('ghost', 'px-2.5 py-1.5 text-xs')}
            >
              Cancel
            </button>

            {state.status === 'error' ? (
              <span className="w-full px-1 text-xs text-danger-700">{state.message}</span>
            ) : null}
          </form>
        </div>
      ) : null}

      {report ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 max-w-sm rounded-xl border border-line bg-surface p-4 shadow-lg"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-ink-800">
              {report.succeeded} of {report.requested} {noun}
              {report.requested === 1 ? '' : 's'} updated
            </p>
            <button
              type="button"
              onClick={() => {
                setDismissed(state);
                clear();
              }}
              aria-label="Dismiss"
              className="text-ink-400 hover:text-ink-700"
            >
              ✕
            </button>
          </div>

          {report.failed > 0 ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {report.results
                .filter((result) => !result.ok)
                .map((result) => (
                  <li key={result.id} className="text-xs text-danger-700">
                    <span className="font-mono">{result.label}</span>: {result.message}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-xs text-positive-700">All succeeded.</p>
          )}
        </div>
      ) : null}
    </>
  );
}

/** Header cell for the checkbox column. */
export function BulkTh() {
  return (
    <th
      scope="col"
      className={cn(
        'w-10 border-b border-line bg-surface-sunken px-4 py-2.5 text-left',
      )}
    >
      <BulkSelectAll />
    </th>
  );
}
