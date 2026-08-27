"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface StatusChip {
  value: string; // "all" | invoice status
  label: string;
  count: number;
}

/** Filter chips mirrored in the URL (?status=…). "all" clears the param. */
export function StatusChips({ chips, value }: { chips: StatusChip[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "all") params.delete("status");
    else params.set("status", v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group">
      {chips.map((c) => {
        const active = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => select(c.value)}
            aria-pressed={active}
            className="rounded-4xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Badge
              variant={active ? "default" : "outline"}
              className={cn(
                "h-7 cursor-pointer gap-1.5 px-3 text-xs font-medium transition-colors",
                active
                  ? "shadow-sm"
                  : "bg-card text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
              )}
            >
              {c.label}
              <span
                className={cn(
                  "rounded-4xl px-1.5 tabular-nums",
                  active ? "bg-primary-foreground/20" : "bg-muted"
                )}
              >
                {c.count}
              </span>
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
