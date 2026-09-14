import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b py-3 last:border-0">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-8 rounded-full" />
            <Skeleton className="size-8 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
