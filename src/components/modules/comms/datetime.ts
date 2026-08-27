// Server-safe helpers producing `datetime-local` input values.
// Rendered on the server in Africa/Algiers so SSR and client hydration agree.

/** "YYYY-MM-DDTHH:mm" for `d` as seen in Algiers. */
export function algiersLocalInput(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "YYYY-MM-DDTHH:mm" for a calendar date at a fixed wall-clock time. */
export function dateAtTimeInput(date: string, time = "09:00"): string {
  return `${date}T${time}`;
}
