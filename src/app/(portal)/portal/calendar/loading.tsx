import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The calendar's shape while it reads: title line, month line, a 7 × 5 grid, three agenda rows. */
export default function PortalCalendarLoading() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-36" />
        <div className="flex gap-1">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
        </div>
      </div>
      <Card className="border border-border shadow-sm ring-0">
        <CardContent className="grid gap-4 px-3">
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
          <div className="grid gap-2 border-t border-border pt-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex min-h-14 items-center gap-3">
                <Skeleton className="size-9 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
