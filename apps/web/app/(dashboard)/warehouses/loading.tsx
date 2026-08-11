import { ListPageSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <ListPageSkeleton columns={7} rows={6} withAction={true} />;
}
