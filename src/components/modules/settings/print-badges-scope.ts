/**
 * The vocabulary the badges print dialog and the print route share — and
 * nothing else. The dialog is a client component and the button that feeds
 * it reads the database; a client file must never reach into that one, even
 * for a type, because the day someone imports a value from it the server
 * client ships to the browser. So the shared words live here, in a file
 * that imports nothing.
 */

/**
 * The three sheets the register prints: one kind of person per sheet, so a
 * stack of cut cards is handed out to one desk. The dialog offers these as
 * tiles and the print route reads them back from the URL through
 * `printScopeOf`.
 */
export type PrintScope = "children" | "guardians" | "staff";

/** searchParams.scope, defaulting to the children: anything else is a typo, not a fourth sheet. */
export function printScopeOf(value: string | string[] | undefined): PrintScope {
  return value === "guardians" || value === "staff" ? value : "children";
}

/**
 * What the dialog needs to say "N badges" before a sheet is opened: who
 * holds a printed code, and — for the children, whom the selects narrow —
 * where each one sits. Never the codes themselves; the sheet reads those.
 */
export interface PrintBadgesSummary {
  /** Every enrolled child, placed, and whether a code exists to print. */
  children: { structureId: string | null; classId: string | null; coded: boolean }[];
  /** The adults of the enrolled children, and how many of them hold a code. */
  guardians: { total: number; coded: number };
  /** The active team, and how many hold a staff code. */
  staff: { total: number; coded: number };
  /** The building's classes, for the class select; names in both scripts. */
  classes: { id: string; name: string; nameAr: string | null; color: string; structureId: string | null }[];
}
