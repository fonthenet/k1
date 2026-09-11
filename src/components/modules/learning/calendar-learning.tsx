import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { scoped, type TenantContext } from "@/lib/tenant";
import { ValueRange } from "@/components/shared/value-range";
import { addDays } from "./domain";

export async function CalendarLearning({
  ctx,
  start,
  end,
}: {
  ctx: TenantContext;
  start: string;
  end: string;
}) {
  const t = await getTranslations("learning");
  const locale = await getLocale();
  const db = await createClient();
  const classes = await scoped(
    db.from("kg_classes").select("id").eq("tenant_id", ctx.tenant.id),
    ctx,
  );
  if (classes.error) throw new Error("Calendar classes unavailable");
  const ids = (classes.data ?? []).map((c) => c.id);
  const lessons = ids.length
    ? await db
        .from("kg_learning_lessons")
        .select("id,title,starts_at,ends_at,class_id")
        .eq("tenant_id", ctx.tenant.id)
        .in("class_id", ids)
        .neq("status", "cancelled")
        .gte("starts_at", `${start}T00:00:00+01:00`)
        .lt("starts_at", `${addDays(end, 1)}T00:00:00+01:00`)
        .order("starts_at")
        .limit(20)
    : { data: [], error: null };
  if (lessons.error) throw new Error("Class timetable unavailable");
  const label = (d: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Algiers",
    }).format(new Date(d));
  return (
    <details className="mb-5 rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-semibold">{t("week")}</summary>
      <div className="mt-3 space-y-3">
        <Link
          href={`/learning?week=${start}`}
          className="text-sm text-primary underline"
        >
          {t("open")}
        </Link>
        {!lessons.data?.length && (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {lessons.data?.map((l) => (
          <Link
            className="block rounded-lg border p-3 text-sm"
            key={l.id}
            href={`/learning?class=${l.class_id}&week=${l.starts_at.slice(0, 10)}`}
          >
            <span dir="auto" className="block text-start font-medium">
              {l.title}
            </span>
            <ValueRange from={label(l.starts_at)} to={label(l.ends_at)} />
          </Link>
        ))}
      </div>
    </details>
  );
}
