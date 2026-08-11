import { ListPageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <ListPageSkeleton columns={9} rows={10} withAction={false} />;
}
