import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalHomeLoading() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-2 rounded-2xl bg-gold-muted/50 p-5 ring-1 ring-gold/25">
        <Skeleton className="h-3 w-28 bg-foreground/10" />
        <Skeleton className="h-7 w-52 bg-foreground/10" />
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-3 w-28" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="shadow-sm">
            <CardContent className="grid gap-3.5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-24 rounded-4xl" />
              </div>
              <Skeleton className="h-14 w-full rounded-xl" />
              <div className="flex justify-between">
                <Skeleton className="h-8 w-40 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}
