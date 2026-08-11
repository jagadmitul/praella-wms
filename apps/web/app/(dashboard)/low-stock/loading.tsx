import { ListPageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <ListPageSkeleton columns={7} rows={8} withAction={false} />;
}
