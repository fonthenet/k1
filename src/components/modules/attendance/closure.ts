// Is a structure's door shut on a given date?
//
// The register used to ask kg_holidays tenant-wide, so a jardin d'enfants that
// follows the school calendar closed the crèche's register with it — and the
// crèche next door does not stop taking babies because the big children are on
// holiday. kg_structure_closed_on answers per structure, and a null structure
// asks about the whole building, which is the honest question for the "all
// structures" view and the only question a single-structure crèche ever has.
//
// One rule the function does not carry is this module's oldest: a `tentative`
// holiday is a proposal — an Aïd nobody has confirmed yet — and closes nothing
// (0068, 0103). So the confirmed row is still read here, and it is the same
// read that names the closure in the register's notice: "closed on Sunday" is
// not the answer when the question is "why is 1 November empty".
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

interface HolidayRow extends ClosureHoliday {
  structure_id: string | null;
}

export async function structureClosure(
  supabase: Client,
  tenantId: string,
  structureId: string | null,
  date: string
): Promise<StructureClosure> {
  const [closedRes, holidayRes] = await Promise.all([
    supabase.rpc("kg_structure_closed_on", {
      p_structure: structureId,
      p_tenant: tenantId,
      p_date: date,
    }),
    supabase
      .from("kg_holidays")
      .select("name, name_ar, structure_id")
      .eq("tenant_id", tenantId)
      .eq("closure", true)
      .eq("tentative", false)
      .lte("date", date)
      .or(`end_date.gte.${date},and(end_date.is.null,date.eq.${date})`),
  ]);

  const error = closedRes.error?.message ?? holidayRes.error?.message ?? null;
  if (error) return { closed: false, holiday: null, error };

  // The same scope the function applies, so the named holiday is always the
  // one that did the closing: a whole-building closure, or this structure's.
  const holiday =
    ((holidayRes.data ?? []) as HolidayRow[]).find(
      (h) => h.structure_id === null || h.structure_id === structureId
    ) ?? null;

  return { closed: closedRes.data === true && holiday !== null, holiday, error: null };
}
