import { Skeleton } from "@/components/ui/skeleton";

/**
 * Root-level Suspense fallback. The landing page itself is static, so this is
 * mostly a neutral placeholder for the first paint of any segment that has no
 * loading.tsx of its own — deliberately brand-light so it fits anywhere.
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-border/60 px-4 sm:px-6 lg:px-8">
        <Skeleton className="size-9 rounded-xl" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="ms-auto h-9 w-24 rounded-lg" />
      </div>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-14 sm:px-6 lg:px-8">
        <Skeleton className="h-6 w-56 rounded-full" />
        <Skeleton className="mt-5 h-12 w-full max-w-2xl" />
        <Skeleton className="mt-3 h-12 w-full max-w-md" />
        <Skeleton className="mt-6 h-5 w-full max-w-xl" />
        <div className="mt-8 flex gap-3">
          <Skeleton className="h-11 w-40 rounded-xl" />
          <Skeleton className="h-11 w-32 rounded-xl" />
        </div>
        <Skeleton className="mt-12 h-72 w-full rounded-2xl" />
      </div>
    </div>
  );
}
