import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <Skeleton className="h-11 w-full max-w-lg rounded-xl" />

      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, col) => (
          <Card key={col}>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-3 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ms-auto h-4 w-20" />
                  <Skeleton className="size-7 rounded-md" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
