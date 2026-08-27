import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, group) => (
          <div key={group} className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="p-4 md:p-6">
              <Skeleton className="h-5 w-32" />
            </div>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-t px-4 py-3 md:px-6">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-6 w-10 rounded-full" />
                <Skeleton className="size-8 rounded-md" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
