import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-40" />
      <Skeleton className="h-96" />
    </div>
  );
}
