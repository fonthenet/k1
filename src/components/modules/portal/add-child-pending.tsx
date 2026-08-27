// The family's own side of the admissions pipeline.
//
// A sibling request is an ordinary kg_applications row, so the parent has to
// be able to see it somewhere — otherwise they send a request and it vanishes
// until a phone call. Policy `app_sel` already lets a parent read the rows
// where `applicant_user_id = auth.uid()`, so no new grant is involved: this is
// simply that row, rendered.
//
// Approved requests are deliberately absent. Approval creates the child, so
// the family sees a real child card above instead of a stale request card.
import "server-only";

import { getLocale, getTranslations } from "next-intl/server";
import { FileX2, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { APPLICATION_STATUS_BADGE } from "@/components/modules/enroll/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Every stage where the family is still waiting on the kindergarten. */
const OPEN_STATUSES = [
  "submitted",
  "under_review",
  "interview",
  "offered",
  "waitlist",
  "rejected",
] as const;

export type OpenApplicationStatus = (typeof OPEN_STATUSES)[number];

export interface PortalApplicationRow {
  id: string;
  status: OpenApplicationStatus;
  child: unknown;
  review_note: string | null;
  created_at: string;
}

/** The signed-in parent's requests that have not turned into a child yet. */
export async function getMyOpenApplications(
  supabase: Supabase,
  ctx: TenantContext
): Promise<PortalApplicationRow[]> {
  const { data } = await supabase
    .from("kg_applications")
    .select("id, status, child, review_note, created_at")
    .eq("tenant_id", ctx.tenant.id)
    .eq("applicant_user_id", ctx.user.id)
    .in("status", [...OPEN_STATUSES])
    .order("created_at", { ascending: false });

  return (data ?? []) as unknown as PortalApplicationRow[];
}

/**
 * `child` is jsonb written by an RPC, so it is read defensively rather than
 * cast: a row with a surprising shape must degrade to a dash, never crash the
 * page a parent opens to check on their family.
 */
function applicantChildName(raw: unknown, locale: string): string {
  if (!raw || typeof raw !== "object") return "—";
  const c = raw as Record<string, unknown>;
  const str = (key: string) => (typeof c[key] === "string" ? (c[key] as string).trim() : "");
  const ar = `${str("first_name_ar")} ${str("last_name_ar")}`.trim();
  const latin = `${str("first_name")} ${str("last_name")}`.trim();
  if (locale === "ar" && ar) return ar;
  return latin || ar || "—";
}

export async function PendingApplications({ rows }: { rows: PortalApplicationRow[] }) {
  if (rows.length === 0) return null;

  const t = await getTranslations("portal.applications");
  const locale = await getLocale();

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-base font-semibold tracking-tight">{t("title")}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <div className="grid gap-3">
        {rows.map((row) => {
          const rejected = row.status === "rejected";
          const Icon = rejected ? FileX2 : Hourglass;
          return (
            <Card key={row.id} className="border-dashed bg-muted/30 shadow-none">
              <CardContent className="flex items-start gap-3.5">
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border ${
                    rejected ? "text-destructive" : "text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="font-semibold" dir="auto">
                      {applicantChildName(row.child, locale)}
                    </span>
                    <Badge className={APPLICATION_STATUS_BADGE[row.status]}>
                      {t(`status.${row.status}`)}
                    </Badge>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("sentOn", { date: formatDate(row.created_at, locale) })}
                  </p>

                  {rejected && row.review_note && (
                    <p className="mt-2.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs leading-relaxed text-destructive">
                      <span className="font-semibold">{t("reviewNote")} : </span>
                      {row.review_note}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
