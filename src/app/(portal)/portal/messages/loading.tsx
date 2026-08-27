import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalMessagesLoading() {
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="shadow-sm">
            <CardContent className="flex items-center gap-3">
              <div className="grid flex-1 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded-4xl" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="size-8 rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
