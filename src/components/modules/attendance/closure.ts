// Is a structure's door shut on a given date?
//
// The register used to ask kg_holidays tenant-wide, so a jardin d'enfants that
// follows the school calendar closed the crèche's register with it — and the
// crèche next door does not stop taking babies because the big children are on
// holiday. kg_structure_closed_on answers per structure, and a null structure
// asks about the whole building, which is the honest question for the "all
// structures" view and the only question a single-structure crèche ever has.
//
// One rule, everywhere (0157): kg_structure_closed_on is confirmed-only — a
// `tentative` holiday is a proposal, an Aïd nobody has confirmed yet, and
// closes nothing: not the register, not the timetable, not the room ledger.
// This module has held that rule since 0068 and 0103; since 0157 every guard
// in the database holds it too. The confirmed row is still read here, through
// lib/closures so the predicate is typed once, and it is the same read that
// names the closure in the register's notice: "closed on Sunday" is not the
// answer when the question is "why is 1 November empty".
import { closureOn, readClosures } from "@/lib/closures";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface ClosureHoliday {
  name: string;
  name_ar: string | null;
}

export interface StructureClosure {
  closed: boolean;
  /** The holiday that closed the day, when a holiday is what closed it. */
  holiday: ClosureHoliday | null;
  error: string | null;
}

export async function structureClosure(
  supabase: Client,
  tenantId: string,
  structureId: string | null,
  date: string
): Promise<StructureClosure> {
  const [closedRes, rows] = await Promise.all([
    supabase.rpc("kg_structure_closed_on", {
      p_structure: structureId,
      p_tenant: tenantId,
      p_date: date,
    }),
    readClosures(supabase, tenantId, date, date).then(
      (data) => ({ data, error: null as string | null }),
      (e: unknown) => ({ data: [], error: e instanceof Error ? e.message : String(e) }),
    ),
  ]);

  const error = closedRes.error?.message ?? rows.error ?? null;
  if (error) return { closed: false, holiday: null, error };

  // The same scope the function applies, so the named holiday is always the
  // one that did the closing: a whole-building closure, or this structure's,
  // confirmed — closureOn puts the building's row first, as the function
  // does.
  const holiday = closureOn(rows.data, date, structureId).confirmed;

  return { closed: closedRes.data === true && holiday !== null, holiday, error: null };
}
