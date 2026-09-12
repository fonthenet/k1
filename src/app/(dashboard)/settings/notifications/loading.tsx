import { Skeleton } from "@/components/ui/skeleton";

/** One header row per card (tile, title, hint), then the card's own rows:
 *  the journal's switch, time and footer; the device toggle; the event list. */
function CardHead({ action = false }: { action?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className="size-9 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3 w-full max-w-lg" />
      </div>
      {action && <Skeleton className="h-8 w-36" />}
    </div>
  );
}

export default function Loading() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <div className="space-y-6">
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <CardHead action />
          <div className="flex items-center gap-3">
            <Skeleton className="h-[18px] w-8 rounded-full" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-32" />
          </div>
          <div className="border-t border-border pt-4">
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <CardHead />
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <CardHead />
          <div className="mt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 border-t py-3 first:border-t-0 first:pt-0">
                <Skeleton className="size-9 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full max-w-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
