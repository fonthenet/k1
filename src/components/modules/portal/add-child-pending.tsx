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
import type { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { StructureMark } from "@/components/shared/structure-mark";

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

/**
 * The requests still in flight, as rows of the family's children list.
 *
 * Rendered INSIDE the list's `<ul>`, under a group row of its own, rather
 * than as a card per request under a heading of its own: a request is a
 * child who is not on the register yet, and it belongs in the same register
 * the enrolled children sit in — the group row is what says "not yet". The
 * rows are not doors; there is no page behind a request, and the office
 * delivers the outcome itself.
 */
export async function PendingApplications({
  rows,
  structures = [],
}: {
  rows: PortalApplicationRow[];
  /** For the mark naming the structure asked for; unused with one structure. */
  structures?: Structure[];
}) {
  if (rows.length === 0) return null;

  const t = await getTranslations("portal.applications");
  // The parent-side name of a move lives with the dialog that asks for it;
  // the row reuses that word rather than inventing a second one.
  const tTransfer = await getTranslations("portal.transfer");
  const locale = await getLocale();
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const multiStructure = structures.length > 1;

  return (
    <>
      <li className="bg-muted/30 px-5 py-1.5 text-xs">
        <span className="flex items-center gap-2">
          <span className="font-semibold">{t("group")}</span>
          <span className="text-muted-foreground tabular-nums">{rows.length}</span>
        </span>
      </li>
      {rows.map((row) => {
        const name =
          `${row.child_first_name ?? ""} ${row.child_last_name ?? ""}`.trim() || "—";
        // The glyph is hidden from assistive tech, so it can only echo what
        // the words say: a closed file has its own sentence, and a transfer
        // is named as one under the child — otherwise a family with a move
        // and a new enrolment in flight reads two identical rows, and a
        // screen reader hears no difference at all.
        const Icon = row.closed ? FileCheck2 : row.transfer ? ArrowRightLeft : Hourglass;
        const structure =
          multiStructure && row.structure_id ? structureById.get(row.structure_id) : undefined;
        return (
          <li key={row.id} className="flex min-h-14 items-center gap-3 px-5 py-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
              aria-hidden
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <bdi dir="auto" className="block truncate text-sm font-medium">
                {name}
              </bdi>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {/* A closed file is a different sentence from a pending one:
                    the date it was sent no longer matters, the next step
                    does. */}
                {row.closed ? (
                  <span>{t("closed")}</span>
                ) : (
                  <>
                    {row.transfer && (
                      <>
                        <span>{tTransfer("title")}</span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                    <span>{t("sentOn", { date: formatDate(row.created_at, locale) })}</span>
                    {structure && (
                      <>
                        <span aria-hidden>·</span>
                        <StructureMark
                          structure={{ name: structureName(structure, locale), color: structure.color }}
                          className="text-xs"
                        />
                      </>
                    )}
                  </>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </>
  );
}
