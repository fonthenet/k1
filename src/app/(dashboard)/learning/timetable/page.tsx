import { TimetableView } from "@/components/modules/learning/timetable-view";
import { timetableWeek } from "@/components/modules/learning/timetable-data";

/**
 * Pédagogie › Emploi du temps — the week's lessons as a grid on the wall.
 *
 * The URL holds the whole filter state (week, class, structure, teacher,
 * view, day) so the page is a bookmark; the server reads and scopes, the
 * view only draws. `teacher` may be a membership id or "me", resolved on
 * the server against the reader's own membership.
 */
export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    class?: string;
    structure?: string;
    teacher?: string;
    view?: string;
    day?: string;
  }>;
}) {
  const data = await timetableWeek(await searchParams);
  return <TimetableView data={data} />;
}
