import { Skeleton } from "@/components/ui/skeleton";
import { SoftWash } from "@/components/shared/soft-wash";

export default function EnrollLoading() {
  return (
    <div className="min-h-dvh bg-background relative overflow-hidden">
      <SoftWash />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center px-4 pt-16">
        <Skeleton className="mb-6 size-20 rounded-3xl" />
        <Skeleton className="mb-3 h-7 w-56" />
        <Skeleton className="mb-8 h-4 w-40" />
        <Skeleton className="mb-3 h-32 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}
