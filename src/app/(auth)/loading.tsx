import { Skeleton } from "@/components/ui/skeleton";

export default function AuthLoading() {
  return (
    <div>
      <Skeleton className="size-11 rounded-2xl" />
      <Skeleton className="mt-5 h-7 w-2/3" />
      <Skeleton className="mt-2 h-4 w-full" />
      <div className="mt-7 grid gap-5">
        <div className="grid gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <Skeleton className="mt-1 h-11 w-full rounded-lg" />
      </div>
    </div>
  );
}
