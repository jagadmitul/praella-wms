import {
  PageHeaderSkeleton,
  Skeleton,
  StatTilesSkeleton,
  TableSkeleton,
} from '@/components/ui/skeleton';

/** Dashboard skeleton: stat tiles, two panels, then the activity table. */
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <StatTilesSkeleton />
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="card p-5">
          <Skeleton className="mb-5 h-4 w-40" />
          <Skeleton className="h-36 w-full" />
        </div>
        <TableSkeleton columns={4} rows={6} />
      </div>
      <div className="mt-6">
        <TableSkeleton columns={7} rows={6} />
      </div>
    </>
  );
}
