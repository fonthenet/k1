import { Skeleton } from "@/components/ui/skeleton";

export default function TasksLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="mb-2 h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-8 w-72 max-w-full rounded-lg" />

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, lane) => (
          <div key={lane} className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/40 p-3">
            <Skeleton className="mb-3 h-5 w-32" />
            {Array.from({ length: lane === 2 ? 1 : 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
