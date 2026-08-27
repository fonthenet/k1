import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalChildrenLoading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="shadow-sm">
            <CardContent className="flex items-center gap-3.5">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="size-8 rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
