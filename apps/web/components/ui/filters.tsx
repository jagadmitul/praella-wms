'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/cn';
import { buttonClass } from './index';

/**
 * URL-driven filtering and pagination.
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

  return { update, isPending, searchParams };
}

export function SearchFilter({ placeholder = 'Search…' }: { placeholder?: string }) {
  const { update, isPending, searchParams } = useQueryUpdater();

  return (
    <form
      role="search"
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get('search');
        update({ search: typeof value === 'string' ? value.trim() : undefined });
      }}
    >
      <input
        type="search"
        name="search"
        defaultValue={searchParams.get('search') ?? ''}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn('field w-64', isPending && 'opacity-70')}
      />
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
    <label className="flex items-center gap-2 text-xs text-ink-500">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={searchParams.get(name) ?? ''}
        onChange={(event) => update({ [name]: event.target.value || undefined })}
        aria-label={label}
        className={cn('field w-auto min-w-40 py-1.5', isPending && 'opacity-70')}
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

export function Pagination({
  page,
  totalPages,
  totalItems,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
}) {
  const { update, isPending } = useQueryUpdater();

  if (totalItems === 0) return null;

  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
      <p className="text-xs text-ink-500">
        Page <span className="font-medium text-ink-700">{page}</span> of{' '}
        <span className="font-medium text-ink-700">{Math.max(totalPages, 1)}</span> ·{' '}
        <span className="tabular">{totalItems.toLocaleString('en-IN')}</span> result
        {totalItems === 1 ? '' : 's'}
      </p>

      <div className="flex gap-2">
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
      </div>
    </div>
  );
}
