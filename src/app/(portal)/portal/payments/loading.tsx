import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalPaymentsLoading() {
  return (
    <div className="grid gap-5">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Card className="shadow-sm">
        <CardContent className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-40" />
          </div>
        </CardContent>
      </Card>
      <Card className="bg-gold-muted/50 shadow-sm ring-gold/25">
        <CardContent className="flex gap-3.5">
          <Skeleton className="size-10 rounded-xl bg-foreground/10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 bg-foreground/10" />
            <Skeleton className="h-3 w-full bg-foreground/10" />
          </div>
        </CardContent>
      </Card>
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} className="shadow-sm">
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-24 rounded-4xl" />
            </div>
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
