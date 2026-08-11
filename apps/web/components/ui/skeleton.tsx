import { cn } from '@/lib/cn';

/**
 * Loading placeholders.
 *
 * Rendered by route-level `loading.tsx` files, so Next streams a skeleton the
 * instant a link is clicked instead of leaving the previous page frozen while
 * the server fetches. That matters more here than usual: the API is a network
 * hop away and its free tier can be slow to wake, so without this the app feels
 * broken rather than merely slow.
 *
 * The shapes deliberately mirror the real layout — same column count, same row
 * height — so the content does not jump when it arrives.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded bg-line-strong/50', className)}
    />
  );
}

export function PageHeaderSkeleton({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {withAction ? <Skeleton className="h-9 w-36" /> : null}
    </div>
  );
}

export function FiltersSkeleton() {
  return (
    <div className="mb-4 flex flex-wrap gap-3">
      <Skeleton className="h-9 w-full sm:w-64" />
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-9 w-40" />
    </div>
  );
}

export function TableSkeleton({
  columns = 6,
  rows = 8,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 border-b border-line bg-surface-sunken px-4 py-3">
        {Array.from({ length: columns }, (_unused, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_unused, rowIndex) => (
        <div
          key={rowIndex}
          className="flex items-center gap-4 border-b border-line px-4 py-4"
        >
          {Array.from({ length: columns }, (_unused, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-4 flex-1', columnIndex === 0 && 'max-w-[14rem]')}
              // Slight stagger so the page reads as loading rather than frozen.
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_unused, index) => (
        <div key={index} className="card space-y-3 px-5 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** The standard list-page skeleton: header, filters, table. */
export function ListPageSkeleton({
  columns = 6,
  rows = 8,
  withAction = true,
}: {
  columns?: number;
  rows?: number;
  withAction?: boolean;
}) {
  return (
    <>
      <PageHeaderSkeleton withAction={withAction} />
      <FiltersSkeleton />
      <TableSkeleton columns={columns} rows={rows} />
    </>
  );
}
