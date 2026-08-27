// The family's own side of the admissions pipeline — deliberately opaque.
//
// Owner's decision (0058): the pipeline stages are the crèche's kitchen. A
// parent sees that their dossier was received and is being processed, and
// nothing else — no "en examen", no "entretien", no waitlist position. The
// outcome arrives as its own event: approval makes the child appear (with a
// notification), and a refusal is delivered by a person, in words the crèche
// chooses, shown here only as "this file is closed, contact us".
//
// The data comes from kg_my_applications(), an RPC that returns only what the
// family may see. The kg_applications row itself is staff-only under RLS, so
// nothing more is readable even with devtools open.
import "server-only";

import { getLocale, getTranslations } from "next-intl/server";
import { FileCheck2, Hourglass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenant";
import { formatDate } from "@/lib/format";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface PortalApplicationRow {
  id: string;
  tenant_name: string;
  child_first_name: string | null;
  child_last_name: string | null;
  created_at: string;
  /** The file stopped moving. The outcome itself is the crèche's to deliver. */
  closed: boolean;
}

/** The signed-in parent's requests that have not turned into a child yet. */
export async function getMyOpenApplications(
  supabase: Supabase,
  ctx: TenantContext
): Promise<PortalApplicationRow[]> {
  void ctx; // the RPC scopes to auth.uid() itself, across every crèche
  const { data } = await supabase.rpc("kg_my_applications");
  return (data ?? []) as PortalApplicationRow[];
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
          const name =
            `${row.child_first_name ?? ""} ${row.child_last_name ?? ""}`.trim() || "—";
          const Icon = row.closed ? FileCheck2 : Hourglass;
          return (
            <Card key={row.id} className="border-dashed bg-muted/30 shadow-none">
              <CardContent className="flex items-start gap-3.5">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border"
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <span className="font-semibold" dir="auto">
                    {name}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("sentOn", { date: formatDate(row.created_at, locale) })}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">
                    {row.closed ? t("closed") : t("processing")}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
