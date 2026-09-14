import { calendarPageData } from "@/components/modules/calendar/calendar-data";
import { CalendarView } from "@/components/modules/calendar/calendar-view";

/**
 * The establishment's calendar: every dated fact of the building composed by
 * the database (kg_calendar, 0158) and drawn by one view in three layouts.
 *
 * The page is only the seam between the URL and the reader: calendar-data.ts
 * turns the parameters into one read under the person's own RLS, and the
 * view — a client component, because it holds the one event dialog and the
 * one lesson detail the whole page opens — draws it. The month, the week and
 * the day are the same URL with `view=` changed; `?month=` from older links
 * still lands on its month.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A parameter repeated in the URL arrives as an array; the first value
  // is the one a hand-typed or truncated link meant.
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const data = await calendarPageData(params);
  return <CalendarView data={data} />;
}
