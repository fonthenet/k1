import Link from "next/link";
import { School, Star, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StaffLink } from "@/components/shared/entity-link";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { cn } from "@/lib/utils";
import type { KgClass } from "@/lib/types";
import { ClassDialog } from "@/components/modules/classes/class-dialog";
import { DeleteClassButton } from "@/components/modules/classes/delete-class-button";
import { yearsLabel } from "@/components/modules/classes/class-types";

type MainStaffRow = {
  class_id: string;
  is_main: boolean;
  kg_memberships: { id: string; user_id: string | null; full_name: string | null } | null;
};

export default async function ClassesPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("classes");
  const locale = await getLocale();
  const supabase = await createClient();

  const [{ data: classRows, error }, { data: enrolledRows }, { data: mainRows }] =
    await Promise.all([
      supabase.from("kg_classes").select("*").eq("tenant_id", ctx.tenant.id).order("name"),
      supabase
        .from("kg_children")
        .select("class_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled")
        .not("class_id", "is", null),
      supabase
        .from("kg_class_staff")
        .select("class_id, is_main, kg_memberships(id, user_id, full_name)")
        .eq("is_main", true),
    ]);

  if (error) throw new Error(error.message);
  const classes = (classRows ?? []) as KgClass[];

  const enrolledByClass = new Map<string, number>();
  for (const row of enrolledRows ?? []) {
    if (row.class_id)
      enrolledByClass.set(row.class_id, (enrolledByClass.get(row.class_id) ?? 0) + 1);
  }

  const mains = (mainRows ?? []) as unknown as MainStaffRow[];
  // Local staff have no login, so their name comes off the membership; the
  // profile lookup only covers the ones who do.
  const mainUserByClass = new Map<string, string>();
  const mainLocalNameByClass = new Map<string, string>();
  const mainMembershipByClass = new Map<string, string>();
  for (const row of mains) {
    if (!row.kg_memberships) continue;
    mainMembershipByClass.set(row.class_id, row.kg_memberships.id);
    if (row.kg_memberships.user_id) {
      mainUserByClass.set(row.class_id, row.kg_memberships.user_id);
    } else if (row.kg_memberships.full_name) {
      mainLocalNameByClass.set(row.class_id, row.kg_memberships.full_name);
    }
  }
  const mainUserIds = [...new Set(mainUserByClass.values())];
  const { data: profiles } = mainUserIds.length
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", mainUserIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  function ageRange(c: KgClass): string {
    if (c.age_min_months != null && c.age_max_months != null)
      return t("ageRange.between", {
        min: yearsLabel(c.age_min_months),
        max: yearsLabel(c.age_max_months),
      });
    if (c.age_min_months != null)
      return t("ageRange.from", { min: yearsLabel(c.age_min_months) });
    if (c.age_max_months != null)
      return t("ageRange.upTo", { max: yearsLabel(c.age_max_months) });
    return t("ageRange.none");
  }

  return (
    <div>
      <PageHeader title={t("list.title")} description={t("list.description")}>
        {ctx.isAdmin && <ClassDialog />}
      </PageHeader>

      {classes.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
              <School />
            </span>
          }
          title={t("list.empty")}
          description={t("list.emptyDescription")}
          action={ctx.isAdmin ? <ClassDialog /> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => {
            const enrolled = enrolledByClass.get(c.id) ?? 0;
            const full = enrolled >= c.capacity;
            const pct = c.capacity > 0 ? Math.min((enrolled / c.capacity) * 100, 100) : 0;
            // Emerald while there's room, gold once it's nearly full, red when full.
            const nearlyFull = !full && pct >= 80;
            const mainUserId = mainUserByClass.get(c.id);
            const mainMembershipId = mainMembershipByClass.get(c.id);
            const teacher = mainUserId
              ? nameByUser.get(mainUserId)
              : mainLocalNameByClass.get(c.id);
            const displayName = locale === "ar" && c.name_ar ? c.name_ar : c.name;

            return (
              <Card
                key={c.id}
                className="shadow-sm transition-shadow duration-200 hover:shadow-md"
              >
                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-3">
                      {/* The class colour lives on the tile that stands for the
                          class, not on a band across the top of the card. It
                          identifies rather than decorates, and a tint with an
                          ink glyph stays legible whatever colour a crèche
                          picks — a solid fill would not.
                          kg_classes.color is user data, hence inline styles. */}
                      <span
                        className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl text-foreground"
                        style={{
                          backgroundColor: `color-mix(in oklch, ${c.color} 20%, transparent)`,
                          boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${c.color} 45%, transparent)`,
                        }}
                        aria-hidden
                      >
                        <School className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <Link
                          href={`/classes/${c.id}`}
                          className="block truncate text-base font-semibold hover:underline"
                        >
                          {displayName}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                          <span>{ageRange(c)}</span>
                          {c.room && (
                            <>
                              <span aria-hidden>·</span>
                              <span>{t("list.room", { room: c.room })}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {ctx.isAdmin && (
                      <div className="flex shrink-0 items-center">
                        <ClassDialog klass={c} />
                        <DeleteClassButton classId={c.id} childCount={enrolled} />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">{t("list.occupancy")}</span>
                      <span className="flex items-center gap-2">
                        {full && <Badge variant="destructive">{t("list.full")}</Badge>}
                        <span
                          className={cn(
                            "text-base font-bold tabular-nums",
                            full ? "text-destructive" : "text-foreground"
                          )}
                        >
                          {enrolled}
                          <span className="text-sm font-medium text-muted-foreground">
                            {" / "}
                            {c.capacity}
                          </span>
                        </span>
                      </span>
                    </div>
                    <Progress
                      value={pct}
                      className={cn(
                        "h-2",
                        full && "[&_[data-slot=progress-indicator]]:bg-destructive",
                        nearlyFull && "[&_[data-slot=progress-indicator]]:bg-gold"
                      )}
                    />
                  </div>

                  <div className="mt-auto flex items-start gap-2.5 border-t border-border pt-3 text-sm">
                    {teacher ? (
                      <>
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gold text-gold-foreground">
                          <Star className="size-3.5" />
                        </span>
                        {/* The label wraps and the name follows it, rather than
                            the whole line truncating and eating the teacher's
                            name — which is the one part worth reading. */}
                        <span className="min-w-0 text-pretty">
                          <span className="text-muted-foreground">{t("list.mainTeacher")}</span>{" "}
                          <span className="font-semibold">
                            {mainMembershipId ? (
                              <StaffLink id={mainMembershipId}>{teacher}</StaffLink>
                            ) : (
                              teacher
                            )}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Users className="size-3.5" />
                        </span>
                        <span className="text-muted-foreground">{t("list.noTeacher")}</span>
                      </>
                    )}
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
