import { cn } from "@/lib/utils";

/** One number, said plainly. The operator scans these, they do not read them. */
export function StatTile({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "plain" | "attention";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "attention" && Number(value) > 0
          ? "border-primary/30 bg-primary/5"
          : "border-border bg-card"
      )}
    >
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-3xl font-bold tabular-nums",
          tone === "attention" && Number(value) > 0 ? "text-primary" : "text-foreground"
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
