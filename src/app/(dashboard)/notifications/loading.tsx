import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="mb-2 h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-36 rounded-lg" />
          <Skeleton className="h-7 w-40 rounded-lg" />
        </div>
      </div>

      {[3, 2].map((rows, group) => (
        <div key={group} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <div className="space-y-px overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="size-9 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2 py-0.5">
                  <Skeleton className="h-3.5 w-44 max-w-full" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
                <Skeleton className="h-3 w-10 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
