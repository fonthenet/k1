import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalChildDetailLoading() {
  return (
    <div className="grid gap-4">
      <div>
        <Skeleton className="mb-2 h-8 w-28 rounded-lg" />
        <Card className="bg-gold-muted/40 shadow-sm ring-gold/25">
          <CardContent className="flex items-center gap-3.5">
            <Skeleton className="size-14 rounded-full bg-foreground/10" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-44 bg-foreground/10" />
              <Skeleton className="h-3 w-32 bg-foreground/10" />
            </div>
          </CardContent>
        </Card>
      </div>
      <Skeleton className="h-11 w-full rounded-xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="shadow-sm">
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 rounded-full" />
              <Skeleton className="h-5 w-40" />
            </div>
            <Skeleton className="h-16 w-full rounded-xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
