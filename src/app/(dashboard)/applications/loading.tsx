import { Skeleton } from "@/components/ui/skeleton";

export default function ApplicationsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="mb-2 h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {/* One card, one table: a head band, then group rows and 56px rows. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-9 rounded-none opacity-60" />
            <div className="flex items-center gap-3 px-4 py-2">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ms-auto h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
