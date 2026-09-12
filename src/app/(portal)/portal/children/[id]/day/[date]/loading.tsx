import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The day page's shape while it composes: back line, identity row, the ‹ › row, three section cards. */
export default function PortalChildDayLoading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-5 w-28 rounded-lg" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div className="flex items-center gap-2 py-2">
        <Skeleton className="size-9 rounded-lg" />
        <Skeleton className="mx-auto h-4 w-44" />
        <Skeleton className="size-9 rounded-lg" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="border border-border shadow-sm ring-0">
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-10 w-full rounded-lg" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
