import { Skeleton } from "@/components/ui/skeleton";

export default function PortalCheckinLoading() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-4 w-full" />
      </div>
      {/* Same footprint as the white QR card, so the page does not jump when
          the code arrives — the parent is already holding the phone up. */}
      <Skeleton className="aspect-square w-full max-w-[22rem] justify-self-center rounded-3xl" />
      <Skeleton className="h-4 w-64" />
      <div className="grid gap-3">
        <Skeleton className="h-3 w-28" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border bg-card p-3"
          >
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-24 rounded-4xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
