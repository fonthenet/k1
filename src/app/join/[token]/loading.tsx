import { Skeleton } from "@/components/ui/skeleton";

export default function JoinLoading() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,var(--primary),transparent_70%)] opacity-[0.09]"
        aria-hidden
      />
      <div className="relative mx-auto flex w-full max-w-xl items-center justify-between px-4 py-4">
        <Skeleton className="h-9 w-32 rounded-xl" />
        <Skeleton className="h-9 w-44 rounded-full" />
      </div>
      <div className="relative mx-auto flex w-full max-w-xl flex-1 items-start justify-center px-4 pt-8 sm:items-center sm:pt-0">
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
}
