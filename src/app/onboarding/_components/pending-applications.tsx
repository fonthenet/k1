import "server-only";

import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Hourglass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import type { MyApplicationRow } from "@/lib/dossier";

/**
 * "Your request is with the crèche" — the state that was missing entirely.
 *
 * A parent who submits an enrolment request has no membership: one only
 * appears when staff approve, because approval is what sets
 * kg_guardians.user_id and fires the 0008 trigger. /onboarding read "no
 * membership" as "must be opening a nursery" and showed the founder wizard, so
 * a parent who had just asked to enrol their child was invited to create a
 * kindergarten. The success screen linking to /portal made it worse: /portal
 * bounces a membership-less user straight back to /onboarding.
 *
 * This does not need a TenantContext — which is the point, since the parent
 * has no tenant yet. Data comes from kg_my_applications() (0058), which scopes
 * to auth.uid() across every crèche and returns only what a family may see:
 * no pipeline stage, no internal notes. The kg_applications row itself is
 * staff-only under RLS.
 *
 * Since 0164 a request whose kind asks for papers is a door to
 * /enroll/dossier/[id] — the one page a family without a membership can act
 * on: add a paper still missing, replace one the office refused.
 */

type Row = Pick<
  MyApplicationRow,
  | "id"
  | "tenant_name"
  | "child_first_name"
  | "child_last_name"
  | "created_at"
  | "closed"
  | "dossier_required"
  | "dossier_missing"
  | "dossier_rejected"
>;

export async function getMyPendingApplications(userId: string): Promise<Row[]> {
  void userId; // kg_my_applications scopes to auth.uid() itself
  const supabase = await createClient();
  const { data } = await supabase.rpc("kg_my_applications");
  // Closed files still render on /portal/children; on the onboarding screen
  // only files that are actually moving explain the wait.
  return ((data ?? []) as MyApplicationRow[])
    .filter((r) => !r.closed)
    .map((r) => ({
      id: r.id,
      tenant_name: r.tenant_name,
      child_first_name: r.child_first_name,
      child_last_name: r.child_last_name,
      created_at: r.created_at,
      closed: r.closed,
      dossier_required: r.dossier_required ?? 0,
      dossier_missing: r.dossier_missing ?? 0,
      dossier_rejected: r.dossier_rejected ?? 0,
    }));
}

export async function PendingApplicationsNotice({
  rows,
  primary = false,
}: {
  rows: Row[];
  /**
   * True when this IS the page — a family whose only business here is the
   * wait — rather than a notice above something else.
   *
   * It changes CONTENT, not styling. An earlier pass also stripped the gold
   * surface and the hourglass tile here, reasoning that a wash plus a border
   * plus a tinted tile is one fact wearing colour three times. That rule is
   * real, but this card is the whole page and the accent is the only warmth
   * on it; plain white delivered "we have your file, relax" like a disabled
   * row. The owner asked for it back exactly as it was, and he is right.
   */
  primary?: boolean;
}) {
  const t = await getTranslations("auth.onboarding.pending");
  const tPortal = await getTranslations("portal");
  const locale = await getLocale();
  if (rows.length === 0) return null;
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <Card
      className="border border-gold/35 bg-gold-muted/40 shadow-sm ring-0"
    >
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gold text-gold-foreground"
          >
            <Hourglass className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {t("title", { count: rows.length })}
            </div>
            <p className="mt-0.5 text-sm leading-relaxed text-pretty text-muted-foreground">
              {t("description")}
            </p>
          </div>
        </div>

        <ul className="grid gap-2">
          {rows.map((r) => {
            // A door only when the file asks for papers (0164); otherwise
            // the row stays what it was — a line saying the wait is real.
            // The second line names the one thing the family can do: fix a
            // refused paper (the row's one coloured word), add a missing
            // one, or nothing, because the file is complete.
            const isDoor = r.dossier_required > 0;
            const dossierLine = !isDoor ? null : r.dossier_rejected > 0 ? (
              <span className="font-medium text-gold-ink">
                {tPortal("dossier.rejectedLine", { count: r.dossier_rejected })} · {tPortal("dossier.fix")}
              </span>
            ) : r.dossier_missing > 0 ? (
              <span className="text-muted-foreground">
                {tPortal("applications.dossierLine", {
                  text: tPortal("dossier.missingLine", { count: r.dossier_missing }),
                })}
              </span>
            ) : (
              <span className="text-muted-foreground">{tPortal("dossier.complete")}</span>
            );
            const body = (
              <>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <bdi dir="auto" className="text-sm font-medium">
                      {`${r.child_first_name ?? ""} ${r.child_last_name ?? ""}`.trim() || "—"}
                    </bdi>
                    {r.tenant_name && (
                      <bdi dir="auto" className="text-xs text-muted-foreground">{r.tenant_name}</bdi>
                    )}
                  </span>
                  {dossierLine && <span className="text-xs">{dossierLine}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDate(r.created_at, locale)}
                </span>
                {isDoor && <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              </>
            );
            return (
              <li key={r.id}>
                {isDoor ? (
                  <Link
                    href={`/enroll/dossier/${r.id}`}
                    className="flex items-center gap-3 rounded-xl bg-background/70 px-3.5 py-2.5 transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="flex items-center gap-3 rounded-xl bg-background/70 px-3.5 py-2.5">{body}</span>
                )}
              </li>
            );
          })}
        </ul>

        {primary && (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("contact")}</p>
        )}
      </CardContent>
    </Card>
  );
}
