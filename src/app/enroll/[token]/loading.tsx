import { Skeleton } from "@/components/ui/skeleton";

export default function EnrollLoading() {
  return (
    <div className="min-h-dvh bg-background bg-gradient-to-b from-gold-muted/60 via-background to-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center px-4 pt-16">
        <Skeleton className="mb-6 size-20 rounded-3xl" />
        <Skeleton className="mb-3 h-7 w-56" />
        <Skeleton className="mb-8 h-4 w-40" />
        <Skeleton className="mb-3 h-32 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}
