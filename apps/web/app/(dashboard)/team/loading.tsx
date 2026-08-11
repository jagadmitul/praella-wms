import { ListPageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <ListPageSkeleton columns={4} rows={5} withAction={false} />;
}
