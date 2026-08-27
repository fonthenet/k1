// Notifications are grouped and stamped in Algeria's calendar (Africa/Algiers,
// UTC+1, no DST), not in whatever timezone the server happens to run in.

/** The Algiers calendar day (YYYY-MM-DD) of a timestamptz value. */
export function algiersDay(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(
    typeof iso === "string" ? new Date(iso) : iso
  );
}

/** Shift a YYYY-MM-DD day, staying in plain-date space. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
