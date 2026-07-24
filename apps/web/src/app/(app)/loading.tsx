import { Skeleton } from '@/components/ui';

/** Shown during route transitions within the app, before a page's own data resolves. */
export default function AppLoading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="mt-2 grid gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
