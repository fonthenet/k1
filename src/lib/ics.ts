// One event as an .ics file, built in the browser.
//
// A family taps "Ajouter à mon agenda" and gets a file their phone's calendar
// opens; nothing is fetched, no route exists, no token is minted (the
// subscription feed was dropped — §17). The text is RFC 5545 as strictly as
// the phones need: CRLF line ends, 75-octet folding, escaped text, a
// VTIMEZONE for Africa/Algiers so an event at 17:00 is 17:00 on a phone set
// to Paris time, and a SEQUENCE that grows with every edit so a re-import
// replaces the earlier copy instead of stacking a second one.
import { TZ, algiersDate } from "@/lib/algiers";
import { addDaysStr } from "@/components/modules/comms/dates";

export interface IcsEvent {
  id: string;
  title: string;
  description?: string | null;
  /** The room, printed once as LOCATION. */
  location?: string | null;
  /** ISO instants as kg_events stores them. */
  startAt: string;
  endAt?: string | null;
  /** All-day rows are stored [00:00, 00:00 next day) Algiers; the .ics says VALUE=DATE with an exclusive DTEND. */
  allDay: boolean;
  cancelled: boolean;
  /** kg_events.updated_at — the SEQUENCE is its epoch seconds, so any edit outranks the copy already imported. */
  updatedAt: string;
  url?: string;
}

const CRLF = "\r\n";

/** Backslash, semicolon, comma and newline are the four characters TEXT must escape (RFC 5545 §3.3.11). */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** 20260923T170000 — the wall clock of an instant in Algiers, no zone suffix (the TZID carries it). */
function localStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

/** 20260923T160000Z — UTC, for DTSTAMP. */
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Folds one content line at 75 OCTETS, never in the middle of a character.
 *
 * The limit is bytes, not characters (RFC 5545 §3.1), and an Arabic title is
 * two bytes a letter: folding at 75 characters would cut a UTF-8 sequence in
 * half and the phone would show a broken glyph — or refuse the file. Each
 * continuation starts with one space that counts toward its own 75.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join(CRLF);
}

/**
 * The file. `now` is a parameter so a test can pin DTSTAMP; callers leave it.
 */
export function buildEventIcs(e: IcsEvent, calendarName: string, now: Date = new Date()): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    // No language tag: the same product writes French, English and Arabic.
    "PRODID:-//Rawdatik//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${TZ}`,
    // Algeria has kept UTC+1 with no daylight saving since 1981: one STANDARD
    // component, from and to the same offset, is the whole zone.
    "BEGIN:VTIMEZONE",
    `TZID:${TZ}`,
    "BEGIN:STANDARD",
    "DTSTART:19810501T010000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:event:${e.id}@rawdatik`,
    `DTSTAMP:${utcStamp(now)}`,
    `SEQUENCE:${sequenceOf(e.updatedAt)}`,
  ];

  if (e.allDay) {
    const start = algiersDate(e.startAt);
    // The stored end is already the exclusive next-day midnight; a row with
    // no end is one day long.
    const end = e.endAt ? algiersDate(e.endAt) : addDaysStr(start, 1);
    lines.push(`DTSTART;VALUE=DATE:${start.replace(/-/g, "")}`);
    lines.push(`DTEND;VALUE=DATE:${(end > start ? end : addDaysStr(start, 1)).replace(/-/g, "")}`);
  } else {
    lines.push(`DTSTART;TZID=${TZ}:${localStamp(e.startAt)}`);
    // No DTEND for a row without one: the event ends when it starts (RFC 5545
    // §3.6.1), which is what the database stored.
    if (e.endAt) lines.push(`DTEND;TZID=${TZ}:${localStamp(e.endAt)}`);
  }

  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push(`STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Epoch seconds of updated_at; a value the parser cannot read counts as the first version. */
function sequenceOf(updatedAt: string): number {
  const ms = Date.parse(updatedAt);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/**
 * Hands the text to the browser as a download. Client only: builds a Blob,
 * clicks a hidden anchor, releases the URL. The MIME type is what makes iOS
 * offer "Add to Calendar" instead of showing the text.
 */
export function downloadIcs(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking on the next tick gives the click time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
