import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 lg:col-span-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mx-auto mt-6 size-32 rounded-2xl" />
          <Skeleton className="mx-auto mt-4 h-9 w-36" />
        </div>
        <div className="space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10 lg:col-span-2">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
