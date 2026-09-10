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
import { ArrowRightLeft, FileCheck2, Hourglass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import type { Structure } from "@/components/modules/classes/class-types";
import { StructureChip } from "./structure-chip";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface PortalApplicationRow {
  id: string;
  tenant_name: string;
  child_first_name: string | null;
  child_last_name: string | null;
  created_at: string;
  /** The file stopped moving. The outcome itself is the crèche's to deliver. */
  closed: boolean;
  /** The structure the family asked for — their own words, via the RPC (0142). */
  structure_id: string | null;
  /** A request to MOVE an existing child rather than enrol a new one. */
  transfer: boolean;
}

type MyApplicationRpcRow = Omit<PortalApplicationRow, "structure_id" | "transfer"> & {
  source: string | null;
  existing_child_id: string | null;
  structure_id: string | null;
};

/**
 * The signed-in parent's requests that have not turned into a child yet.
 *
 * kg_my_applications() returns nothing internal — no status, no stage — and
 * since 0142 it does return the structure and the child the family named,
 * so a transfer is a transfer by its own row and nothing here matches names.
 */
export async function getMyOpenApplications(
  supabase: Supabase,
  ctx: TenantContext
): Promise<PortalApplicationRow[]> {
  void ctx; // the RPC scopes to auth.uid() itself, across every crèche
  const { data } = await supabase.rpc("kg_my_applications");
  return ((data ?? []) as MyApplicationRpcRow[]).map((r) => ({
    id: r.id,
    tenant_name: r.tenant_name,
    child_first_name: r.child_first_name,
    child_last_name: r.child_last_name,
    created_at: r.created_at,
    closed: r.closed,
    structure_id: r.structure_id,
    transfer: !!r.existing_child_id,
  }));
}

export async function PendingApplications({
  rows,
  structures = [],
}: {
  rows: PortalApplicationRow[];
  /** For the chip naming the structure asked for; unused with one structure. */
  structures?: Structure[];
}) {
  if (rows.length === 0) return null;

  const t = await getTranslations("portal.applications");
  const locale = await getLocale();
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const multiStructure = structures.length > 1;

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
          const Icon = row.closed ? FileCheck2 : row.transfer ? ArrowRightLeft : Hourglass;
          const structure =
            multiStructure && row.structure_id ? structureById.get(row.structure_id) : undefined;
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
                  <span className="font-semibold text-start" dir="auto">
                    {name}
                  </span>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{t("sentOn", { date: formatDate(row.created_at, locale) })}</span>
                    {structure && <StructureChip structure={structure} locale={locale} />}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">
                    {row.closed ? t("closed") : row.transfer ? t("processingTransfer") : t("processing")}
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
