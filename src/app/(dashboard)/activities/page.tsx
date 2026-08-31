import Link from "next/link";
import { Clock, Sparkles, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { toOpeningHours } from "@/lib/week";
import { formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Activity } from "@/lib/types";
import { ActivityActiveToggle } from "@/components/modules/classes/activity-active-toggle";
import { ACTIVITY_CATEGORIES } from "@/components/modules/classes/class-types";
import { ActivityDialog } from "@/components/modules/classes/activity-dialog";
import { CategoryIcon } from "@/components/modules/classes/category-icon";
import {
  asScheduleSlots,
  sortSchedule,
  type ActivityFormValues,
} from "@/components/modules/classes/class-types";

type EnrollmentCountRow = { activity_id: string; status: string };

/** Row → the shape the create/edit dialog expects. */
function toFormValues(a: Activity): ActivityFormValues {
  return {
    id: a.id,
    name: a.name,
    name_ar: a.name_ar,
    description: a.description,
    category: a.category,
    fee_amount: Number(a.fee_amount),
    fee_period: a.fee_period,
    schedule: asScheduleSlots(a.schedule),
    capacity: a.capacity,
    active: a.active,
  };
}

export default async function ActivitiesPage() {
  const ctx = await requireStaff();
  const openingHours = toOpeningHours(
    (ctx.tenant as { opening_hours?: unknown }).opening_hours
  );
  const t = await getTranslations("activities");
  const locale = await getLocale();
  const supabase = await createClient();

  const [{ data: activityRows, error }, { data: enrollmentRows }] = await Promise.all([
    supabase
      .from("kg_activities")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("active", { ascending: false })
      .order("name"),
    supabase
      .from("kg_activity_enrollments")
      .select("activity_id, status")
      .eq("tenant_id", ctx.tenant.id)
      .in("status", ["active", "requested"]),
  ]);

  if (error) throw new Error(error.message);
  const activities = (activityRows ?? []) as Activity[];

  const activeByActivity = new Map<string, number>();
  const requestedByActivity = new Map<string, number>();
  for (const row of (enrollmentRows ?? []) as EnrollmentCountRow[]) {
    const bucket = row.status === "requested" ? requestedByActivity : activeByActivity;
    bucket.set(row.activity_id, (bucket.get(row.activity_id) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader title={t("list.title")} description={t("list.description")}>
        {ctx.isAdmin && <ActivityDialog openingHours={openingHours} />}
      </PageHeader>

      {activities.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gold text-gold-foreground [&>svg]:size-7">
              <Sparkles />
            </span>
          }
          title={t("list.empty")}
          description={t("list.emptyDescription")}
          action={ctx.isAdmin ? <ActivityDialog openingHours={openingHours} /> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {activities.map((a) => {
            const enrolled = activeByActivity.get(a.id) ?? 0;
            const requested = requestedByActivity.get(a.id) ?? 0;
            const full = a.capacity != null && enrolled >= a.capacity;
            const slots = sortSchedule(asScheduleSlots(a.schedule));
            const fee = Number(a.fee_amount);
            const displayName = locale === "ar" && a.name_ar ? a.name_ar : a.name;

            return (
              <Card
                key={a.id}
                className={cn(
                  "shadow-sm transition-shadow duration-200 hover:shadow-md",
                  !a.active && "opacity-65"
                )}
              >
                <CardContent className="flex flex-1 flex-col gap-3.5">
                  <div className="flex items-start gap-3">
                    <CategoryIcon category={a.category} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/activities/${a.id}`}
                        className="block truncate text-base font-semibold hover:underline"
                      >
                        {displayName}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                        <span>
                          {/* A category the messages do not carry would throw
                              MISSING_MESSAGE and take the page with it. The edit
                              dialog already guards this way; the list did not. */}
                          {t(`categories.${
                            (ACTIVITY_CATEGORIES as readonly string[]).includes(a.category)
                              ? a.category
                              : "general"
                          }`)}
                        </span>
                        <span aria-hidden>·</span>
                        {fee > 0 ? (
                          <>
                            <span className="font-semibold tabular-nums text-foreground">
                              {formatDZD(fee, locale)}
                            </span>
                            <span aria-hidden>·</span>
                            <span>{t(`periods.${a.fee_period}`)}</span>
                          </>
                        ) : (
                          <span className="font-medium text-success">{t("list.free")}</span>
                        )}
                      </div>
                    </div>
                    {ctx.isAdmin && (
                      <div className="flex shrink-0 items-center gap-1">
                        <ActivityDialog activity={toFormValues(a)} openingHours={openingHours} />
                        <ActivityActiveToggle activityId={a.id} active={a.active} />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {slots.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="size-3.5" />
                        {t("list.noSchedule")}
                      </span>
                    ) : (
                      slots.map((s, i) => (
                        <Badge
                          key={`${s.day}-${s.time}-${i}`}
                          variant="outline"
                          className="bg-muted/50"
                        >
                          <span className="font-semibold">{t(`days.${s.day}`)}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {s.time.slice(0, 5)}
                          </span>
                        </Badge>
                      ))
                    )}
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Users className="size-3.5" />
                    </span>
                    <span className="text-muted-foreground">{t("list.enrolled")}</span>
                    <span
                      className={cn(
                        "font-bold tabular-nums",
                        full ? "text-destructive" : "text-foreground"
                      )}
                    >
                      {a.capacity != null ? `${enrolled} / ${a.capacity}` : enrolled}
                    </span>
                    {a.capacity == null && (
                      <span className="text-xs text-muted-foreground">{t("list.noCapacity")}</span>
                    )}
                    <div className="ms-auto flex items-center gap-1.5">
                      {requested > 0 && (
                        <Badge className="border-transparent bg-gold font-medium text-gold-foreground">
                          {t("list.requests", { count: requested })}
                        </Badge>
                      )}
                      {!a.active && <Badge variant="outline">{t("list.inactive")}</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
