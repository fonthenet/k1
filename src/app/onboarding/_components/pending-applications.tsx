import "server-only";

import { getLocale, getTranslations } from "next-intl/server";
import { Hourglass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

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
 */

type Row = {
  id: string;
  tenant_name: string;
  child_first_name: string | null;
  child_last_name: string | null;
  created_at: string;
  closed: boolean;
};

export async function getMyPendingApplications(userId: string): Promise<Row[]> {
  void userId; // kg_my_applications scopes to auth.uid() itself
  const supabase = await createClient();
  const { data } = await supabase.rpc("kg_my_applications");
  // Closed files still render on /portal/children; on the onboarding screen
  // only files that are actually moving explain the wait.
  return ((data ?? []) as Row[]).filter((r) => !r.closed);
}

export async function PendingApplicationsNotice({ rows }: { rows: Row[] }) {
  const t = await getTranslations("auth.onboarding.pending");
  const locale = await getLocale();
  if (rows.length === 0) return null;

  return (
    <Card className="border border-gold/35 bg-gold-muted/40 shadow-sm ring-0">
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
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-background/70 px-3.5 py-2.5"
            >
              <span className="text-sm font-medium">
                {`${r.child_first_name ?? ""} ${r.child_last_name ?? ""}`.trim() || "—"}
              </span>
              {r.tenant_name && (
                <span className="text-xs text-muted-foreground">{r.tenant_name}</span>
              )}
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                {formatDate(r.created_at, locale)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
