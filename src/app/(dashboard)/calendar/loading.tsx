import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="mb-4 flex items-center gap-1">
        <Skeleton className="size-8" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="size-8" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 gap-px bg-border">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`h-${i}`} className="bg-muted/40 px-2 py-2">
              <Skeleton className="mx-auto h-3 w-8" />
            </div>
          ))}
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="min-h-24 space-y-1.5 bg-card p-1.5">
              <Skeleton className="size-5 rounded-full" />
              {i % 4 === 0 && <Skeleton className="h-4 w-full" />}
            </div>
          ))}
        </div>
      </div>
      <Card className="mt-6 py-0">
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-1 rounded-full" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="ms-auto h-5 w-20 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
