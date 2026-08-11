'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { buttonClass } from './index';

/**
 * URL-driven filtering, sorting and pagination.
 *
 * Filter state lives in the query string rather than component state, so a
 * filtered view is a shareable link, survives a refresh, and lets the list
 * itself stay a Server Component that simply reads `searchParams`.
 */

function useQueryUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const update = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    // Any filter change invalidates the current page number.
    if (!('page' in changes)) {
      params.delete('page');
    }

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return { update, isPending, searchParams, pathname, router, startTransition };
}

/** Wraps a row of filters and dims them while a change is in flight. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">{children}</div>
  );
}

export function SearchFilter({ placeholder = 'Search…' }: { placeholder?: string }) {
  const { update, isPending, searchParams } = useQueryUpdater();
  const current = searchParams.get('search') ?? '';

  return (
    <form
      role="search"
      className="flex w-full items-center gap-2 sm:w-auto"
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get('search');
        update({ search: typeof value === 'string' ? value.trim() : undefined });
      }}
    >
      <div className="relative w-full sm:w-64">
        <input
          type="search"
          name="search"
          key={current}
          defaultValue={current}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn('field w-full', isPending && 'opacity-70')}
        />
        {isPending ? (
          <span
            aria-hidden
            className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin rounded-full border-[1.5px] border-line-strong border-t-brand-600"
          />
        ) : null}
      </div>
      <button type="submit" className={buttonClass('secondary')}>
        Search
      </button>
    </form>
  );
}

export function SelectFilter({
  name,
  label,
  options,
  allLabel = 'All',
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  const { update, isPending, searchParams } = useQueryUpdater();

  return (
    <label className="flex w-full items-center gap-2 text-xs text-ink-500 sm:w-auto">
      <span className="sr-only lg:not-sr-only">{label}</span>
      <select
        value={searchParams.get(name) ?? ''}
        onChange={(event) => update({ [name]: event.target.value || undefined })}
        aria-label={label}
        className={cn('field w-full py-1.5 sm:w-auto sm:min-w-40', isPending && 'opacity-70')}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A date input bound to a query parameter, for range filtering. */
export function DateFilter({ name, label }: { name: string; label: string }) {
  const { update, isPending, searchParams } = useQueryUpdater();
  const raw = searchParams.get(name) ?? '';

  return (
    <label className="flex items-center gap-2 text-xs text-ink-500">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="date"
        value={raw.slice(0, 10)}
        onChange={(event) =>
          update({
            // The API takes an ISO-8601 instant; a date input gives a plain day.
            [name]: event.target.value
              ? new Date(
                  `${event.target.value}T${name === 'to' ? '23:59:59' : '00:00:00'}Z`,
                ).toISOString()
              : undefined,
          })
        }
        aria-label={label}
        className={cn('field w-auto py-1.5', isPending && 'opacity-70')}
      />
    </label>
  );
}

/**
 * Sort control. The field list is passed in per page because the API only
 * permits sorting on an allow-list — offering a column the server would reject
 * would just produce a silently-ignored filter.
 */
export function SortFilter({
  options,
}: {
  options: Array<{ value: string; label: string }>;
}) {
  const { update, isPending, searchParams } = useQueryUpdater();
  const sortBy = searchParams.get('sortBy') ?? '';
  const sortDir = searchParams.get('sortDir') ?? 'desc';

  return (
    <div className="flex items-center gap-1.5 text-xs text-ink-500">
      <span className="sr-only lg:not-sr-only">Sort</span>
      <select
        value={sortBy}
        onChange={(event) => update({ sortBy: event.target.value || undefined })}
        aria-label="Sort by"
        className={cn('field w-auto py-1.5', isPending && 'opacity-70')}
      >
        <option value="">Default</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => update({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })}
        aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
        title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        className={buttonClass('secondary', 'px-2 py-1.5')}
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d={sortDir === 'asc' ? 'M10 15V5m0 0L6 9m4-4l4 4' : 'M10 5v10m0 0l4-4m-4 4l-4-4'}
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Clears every filter except the ones that define the view itself. */
export function ClearFilters({ keep = [] }: { keep?: string[] }) {
  const { searchParams, pathname, router, startTransition, isPending } =
    useQueryUpdater();

  const active = [...searchParams.keys()].filter(
    (key) => !keep.includes(key) && key !== 'page',
  );

  if (active.length === 0) return null;

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        const params = new URLSearchParams();
        for (const key of keep) {
          const value = searchParams.get(key);
          if (value) params.set(key, value);
        }
        startTransition(() => router.push(`${pathname}?${params.toString()}`));
      }}
      className={buttonClass('ghost', 'px-2.5 py-1.5 text-xs')}
    >
      Clear {active.length} filter{active.length === 1 ? '' : 's'}
    </button>
  );
}

const PAGE_SIZES = [10, 20, 50, 100];

export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
}) {
  const { update, isPending } = useQueryUpdater();

  if (totalItems === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex items-center gap-3">
        <p className="text-xs text-ink-500">
          <span className="tabular">
            {first.toLocaleString('en-IN')}–{last.toLocaleString('en-IN')}
          </span>{' '}
          of <span className="tabular font-medium text-ink-700">
            {totalItems.toLocaleString('en-IN')}
          </span>
        </p>

        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          <span className="hidden sm:inline">Rows</span>
          <select
            value={String(pageSize)}
            onChange={(event) =>
              // Changing page size invalidates the current offset.
              update({ pageSize: event.target.value, page: undefined })
            }
            aria-label="Rows per page"
            className={cn('field w-auto py-1 text-xs', isPending && 'opacity-70')}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-400">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <button
          type="button"
          disabled={page <= 1 || isPending}
          onClick={() => update({ page: '1' })}
          className={buttonClass('secondary', 'px-2 py-1.5 text-xs')}
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          disabled={page <= 1 || isPending}
          onClick={() => update({ page: String(page - 1) })}
          className={buttonClass('secondary', 'px-2.5 py-1.5 text-xs')}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages || isPending}
          onClick={() => update({ page: String(page + 1) })}
          className={buttonClass('secondary', 'px-2.5 py-1.5 text-xs')}
        >
          Next
        </button>
        <button
          type="button"
          disabled={page >= totalPages || isPending}
          onClick={() => update({ page: String(totalPages) })}
          className={buttonClass('secondary', 'px-2 py-1.5 text-xs')}
          aria-label="Last page"
        >
          »
        </button>
      </div>
    </div>
  );
}
