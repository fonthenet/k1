import { Skeleton } from "@/components/ui/skeleton";

export default function PrintRegisterLoading() {
  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mx-auto max-w-5xl space-y-6 rounded-xl border border-border bg-white p-8 shadow-sm md:p-10">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-3 w-72" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-7 w-80 max-w-full self-center" />
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
