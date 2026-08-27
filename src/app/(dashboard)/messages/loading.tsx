import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="py-0">
          <CardContent className="space-y-4 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="hidden min-h-[420px] py-0 lg:block">
          <CardContent className="space-y-4 p-4">
            <Skeleton className="ms-auto h-12 w-2/3 rounded-lg" />
            <Skeleton className="h-12 w-2/3 rounded-lg" />
            <Skeleton className="ms-auto h-12 w-1/2 rounded-lg" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
