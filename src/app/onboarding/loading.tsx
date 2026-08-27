import { Skeleton } from "@/components/ui/skeleton";

export default function OnboardingLoading() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,var(--primary),transparent_70%)] opacity-[0.09]"
        aria-hidden
      />
      <div className="relative mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
        <Skeleton className="h-9 w-32 rounded-xl" />
        <Skeleton className="h-9 w-44 rounded-full" />
      </div>
      <div className="relative mx-auto w-full max-w-4xl px-4 pt-8 sm:px-6">
        <div className="mx-auto mb-8 max-w-sm space-y-3 text-center">
          <Skeleton className="mx-auto h-8 w-56" />
          <Skeleton className="mx-auto h-1 w-12 rounded-full" />
          <Skeleton className="mx-auto h-4 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
