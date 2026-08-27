import { Skeleton } from "@/components/ui/skeleton";

export default function PortalNotificationsLoading() {
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-5">
        {[3, 2].map((count, group) => (
          <div key={group} className="grid gap-2">
            <Skeleton className="h-3 w-24" />
            <div className="grid gap-2">
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="flex min-h-16 items-start gap-3 rounded-xl bg-card px-3 py-3 ring-1 ring-foreground/10">
                  <Skeleton className="size-10 shrink-0 rounded-xl" />
                  <div className="grid flex-1 gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
