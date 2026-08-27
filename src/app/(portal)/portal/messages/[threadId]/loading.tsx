import { Skeleton } from "@/components/ui/skeleton";

export default function PortalThreadLoading() {
  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-2">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-5 w-28 rounded-4xl" />
        </div>
      </div>
      <div className="grid gap-3">
        {[false, true, false].map((mine, i) => (
          <div key={i} className={mine ? "flex justify-end" : "flex justify-start"}>
            <div className="w-[75%] space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-16 w-full rounded-2xl" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}
