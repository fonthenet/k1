import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/** The Journal screen's shape while it loads: header, the tab bar, the
 *  toolbar card, then one card of rows — avatar, name, the three controls. */
export default function JournalLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-12 w-80 rounded-xl" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-8 w-72" />
      </div>
      <Card className="py-0">
        <CardContent className="space-y-4 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ms-auto h-10 w-44 rounded-xl" />
              <Skeleton className="h-8 w-56 rounded-lg" />
              <Skeleton className="h-8 w-52 rounded-lg" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
