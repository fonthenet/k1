import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The calendar's shape while it reads: header, the filter bar, one card with
 * its toolbar row and the seven-column month, the next-days card under it.
 * The same anatomy as the page, so nothing jumps when the data lands.
 */
export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="ms-auto h-7 w-32" />
      </div>
      <Card className="hidden border border-border py-0 shadow-sm ring-0 md:block">
        <CardContent className="px-0">
          <div className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="ms-auto h-6 w-20 rounded-full" />
          </div>
          <div className="flex gap-5 border-b border-border px-4 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-16" />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-border">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={`h-${i}`} className="bg-muted/40 px-2 py-2">
                <Skeleton className="mx-auto h-3 w-8" />
              </div>
            ))}
            {Array.from({ length: 42 }).map((_, i) => (
              <div key={i} className="min-h-28 space-y-1.5 bg-card p-1.5">
                <Skeleton className="size-6 rounded-full" />
                {i % 5 === 0 && <Skeleton className="h-4 w-full" />}
                {i % 3 === 0 && <Skeleton className="h-3 w-3/4" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:hidden">
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="grid grid-cols-7 gap-y-1">
            {Array.from({ length: 42 }).map((_, i) => (
              <Skeleton key={i} className="mx-auto size-8 rounded-lg" />
            ))}
          </div>
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
      <Card className="mt-6 border border-border py-0 shadow-sm ring-0">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl" />
            <Skeleton className="h-4 w-40" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-4 w-56" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
