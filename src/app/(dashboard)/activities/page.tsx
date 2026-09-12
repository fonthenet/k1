import Link from "next/link";
import { Fragment } from "react";
import { Sparkles } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureGroupRow } from "@/components/shared/structure-group-row";
import { ValueRange } from "@/components/shared/value-range";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { toOpeningHours } from "@/lib/week";
import { formatDZD } from "@/lib/format";
import { groupClassesByStructure } from "@/lib/structure-groups";
import type { Activity } from "@/lib/types";
import { ACTIVITY_CATEGORIES } from "@/components/modules/classes/class-types";
import { ActivityDialog } from "@/components/modules/classes/activity-dialog";
import { ActivityStructureFilter } from "@/components/modules/classes/activity-structure-filter";
import { FillBar } from "@/components/modules/classes/fill-bar";
import {
  asScheduleSlots,
  roomName,
  structureName,
  type ActivityFormValues,
  type Structure,
} from "@/components/modules/classes/class-types";
import { readRoomChoices } from "@/components/modules/rooms/occupancy-data";

type EnrollmentCountRow = { activity_id: string; status: string };

/** The row as the table has it — `Activity` is shared and does not carry the column yet. */
type ActivityRow = Activity & { structure_id: string | null };

/** Row → the shape the create/edit dialog expects. */
function toFormValues(a: Activity): ActivityFormValues {
  return {
    id: a.id,
    name: a.name,
    name_ar: a.name_ar,
    description: a.description,
    category: a.category,
    fee_amount: Number(a.fee_amount),
    fee_period: a.fee_period,
    schedule: asScheduleSlots(a.schedule),
    capacity: a.capacity,
    active: a.active,
    room_id: a.room_id ?? null,
  };
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ structure?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const openingHours = toOpeningHours(
    (ctx.tenant as { opening_hours?: unknown }).opening_hours
  );
  const t = await getTranslations("activities");
  const locale = await getLocale();
  const supabase = await createClient();

  const [
    { data: activityRows, error },
    { data: enrollmentRows },
    { data: structureRows },
    { rooms, homeClasses },
  ] = await Promise.all([
      scoped(
        supabase
          .from("kg_activities")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .order("active", { ascending: false })
          .order("name"),
        ctx
      ),
      supabase
        .from("kg_activity_enrollments")
        .select("activity_id, status")
        .eq("tenant_id", ctx.tenant.id)
        .in("status", ["active", "requested"]),
      // The structures of the establishment (0125). One for most crèches, two
      // for a building that runs a crèche and a jardin d'enfants side by side.
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active")
        .eq("tenant_id", ctx.tenant.id)
        .order("sort_order")
        .order("name"),
    // Every room of the building and who lives in each, for the table's
    // room tail and the dialog's picker. The occupancy itself is read by
    // the dialog when it opens: twelve weeks of bookings are not worth
    // fetching for a list that only names the room.
    readRoomChoices(supabase, ctx, locale),
  ]);

  if (error) throw new Error(error.message);
  const activities = (activityRows ?? []) as ActivityRow[];
  const structures = (structureRows ?? []) as Structure[];
  const structureById = new Map(structures.map((s) => [s.id, s] as const));
  const roomById = new Map(rooms.map((r) => [r.id, r] as const));
  /** Neither the filter nor a group row is worth showing under two structures. */
  const manyStructures = structures.length > 1;

  // An id this building does not have is ignored rather than emptying the grid
  // — a link kept from before a structure was deleted still opens the page.
  // Falls back to the rail's switcher, so the page and the sidebar never
  // disagree about which structure is being read. And once the rail HAS
  // narrowed, the in-page filter is hidden below — one question, one control.
  const structureFilter =
    manyStructures && sp.structure && structureById.has(sp.structure)
      ? sp.structure
      : (ctx.structureId ?? "all");
  // A structure's own activities, PLUS the ones open to the whole building:
  // null is not a missing structure, it is every structure at once, and the
  // jardin's parents can enrol in the building's chorale like anyone else.
  const shown =
    structureFilter === "all"
      ? activities
      : activities.filter(
          (a) => a.structure_id === structureFilter || a.structure_id === null
        );

  const activeByActivity = new Map<string, number>();
  const requestedByActivity = new Map<string, number>();
  for (const row of (enrollmentRows ?? []) as EnrollmentCountRow[]) {
    const bucket = row.status === "requested" ? requestedByActivity : activeByActivity;
    bucket.set(row.activity_id, (bucket.get(row.activity_id) ?? 0) + 1);
  }

  // The activities under their structure, in the building's own order, with
  // a trailing group for the ones open to the whole building. Only the
  // unfiltered list of a two-structure building is grouped: once a structure
  // is chosen the filter has already said which one, and a single group
  // needs no heading. The query order (active first, then name) holds
  // inside each group.
  const grouped = manyStructures && structureFilter === "all";
  const { groups } = groupClassesByStructure(shown, structures);
  const showGroupRows = grouped && groups.length > 1;
  const columns = ctx.isAdmin ? 7 : 6;

  // One row per activity, the way the classes page draws classes: the name
  // is the link, the facts are columns, the capacity is the same fill bar.
  // Cards were a 3-column grid that left five activities as three-and-two,
  // with the category as a tinted tile, the fee in bold, the requests in
  // solid gold and the schedule as a run of chips — four colours for four
  // facts. A row says each once and reads the same at five and at fifteen.
  const activityRow = (a: ActivityRow) => {
    const enrolled = activeByActivity.get(a.id) ?? 0;
    const requested = requestedByActivity.get(a.id) ?? 0;
    // Read through the normaliser (sorted on the way out), so the rows
    // still stored as integer days print their slots before 0156 has run.
    const slots = asScheduleSlots(a.schedule);
    const room = a.room_id ? roomById.get(a.room_id) : undefined;
    const fee = Number(a.fee_amount);
    const displayName = locale === "ar" && a.name_ar ? a.name_ar : a.name;
    // A category the messages do not carry would throw MISSING_MESSAGE and
    // take the page with it. The edit dialog already guards this way.
    const category = (ACTIVITY_CATEGORIES as readonly string[]).includes(a.category)
      ? a.category
      : "general";

    return (
      <TableRow key={a.id} className="relative transition-colors hover:bg-primary/5">
        <TableCell>
          {/* The whole row is the link: the name's overlay reaches every
              cell, and the admin's pencil at the end is lifted above it.
              An inactive activity is said by its pill, not by fading the
              row. */}
          <Link href={`/activities/${a.id}`} className="font-semibold after:absolute after:inset-0">
            <bdi dir="auto" className="truncate">{displayName}</bdi>
          </Link>
        </TableCell>
        <TableCell className="text-muted-foreground">{t(`categories.${category}`)}</TableCell>
        <TableCell className="whitespace-nowrap text-end tabular-nums">
          {fee > 0 ? (
            <>
              <span className="font-medium">{formatDZD(fee, locale)}</span>
              <span className="text-muted-foreground"> · {t(`periods.${a.fee_period}`)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{t("list.free")}</span>
          )}
        </TableCell>
        <TableCell className="min-w-40 whitespace-normal text-muted-foreground">
          {/* One unit per line — "Dim 11:00 – 12:00" / "Mer 11:00 – 12:00" /
              "Salle 4": each slot as its day and its range, then the room
              once, because it is one room for the whole activity, not one
              per slot. Stacked rather than joined with a separator: the
              column cannot hold two slots and a room on one line, and a
              separator that trails the unit before a forced break read as a
              bare dot ending every line. A slot never splits its day from
              its range. */}
          {slots.length === 0 && !room
            ? "—"
            : slots.map((s, i) => (
                <span key={`${s.day}-${s.start}-${i}`} className="block whitespace-nowrap">
                  <span className="font-semibold">{t(`days.${s.day}`)}</span>{" "}
                  <ValueRange from={s.start} to={s.end} separator="–" className="tabular-nums" />
                </span>
              ))}
          {room && (
            <bdi dir="auto" className="block whitespace-nowrap">{roomName(room, locale)}</bdi>
          )}
        </TableCell>
        <TableCell className="w-40">
          {a.capacity != null ? (
            <FillBar enrolled={enrolled} capacity={a.capacity} className="min-w-28" />
          ) : (
            <span className="tabular-nums">
              <span className="font-semibold">{enrolled}</span>
              <span className="text-muted-foreground"> · {t("list.noCapacity")}</span>
            </span>
          )}
        </TableCell>
        <TableCell>
          {/* One mark: a parent waiting on an answer outranks "inactive",
              and an active activity with nothing pending says nothing. */}
          {requested > 0 ? (
            <StatusPill tone="attention">{t("list.requests", { count: requested })}</StatusPill>
          ) : !a.active ? (
            <StatusPill tone="muted">{t("list.inactive")}</StatusPill>
          ) : null}
        </TableCell>
        {ctx.isAdmin && (
          <TableCell className="w-12">
            {/* The pencil alone: the edit dialog already holds the active
                switch, so a second one in every row was five solid primaries
                beside the page's one button, repeating what the muted pill
                says. */}
            <span className="relative z-10 flex items-center justify-end">
              <ActivityDialog
                activity={toFormValues(a)}
                openingHours={openingHours}
                structures={structures}
                structureId={a.structure_id}
                rooms={rooms}
                homeClasses={homeClasses}
                enrolled={enrolled}
              />
            </span>
          </TableCell>
        )}
      </TableRow>
    );
  };

  return (
    <div>
      {/* One primary per page: the thing this page creates. */}
      <PageHeader title={t("list.title")} description={t("list.description")}>
        {ctx.isAdmin && (
          <ActivityDialog
            openingHours={openingHours}
            structures={structures}
            rooms={rooms}
            homeClasses={homeClasses}
            enrolled={0}
          />
        )}
      </PageHeader>

      {/* The roster's filter card, only when there is a structure to choose:
          a bar holding nothing but the count would be a box for a number. */}
      {manyStructures && !ctx.structureId && activities.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
          <ActivityStructureFilter structures={structures} value={structureFilter} />
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
            {t("list.count", { count: shown.length })}
          </span>
        </div>
      )}

      {activities.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={t("list.empty")}
          description={t("list.emptyDescription")}
        />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            {shown.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">{t("structures.empty")}</p>
            ) : (
              <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
                <TableHeader>
                  <TableRow className="[&>th]:font-semibold">
                    <TableHead>{t("list.columns.activity")}</TableHead>
                    <TableHead>{t("dialog.category")}</TableHead>
                    <TableHead className="text-end">{t("list.columns.fee")}</TableHead>
                    <TableHead>{t("detail.schedule.title")}</TableHead>
                    <TableHead>{t("list.enrolled")}</TableHead>
                    <TableHead>{t("detail.enrollments.status")}</TableHead>
                    {ctx.isAdmin && (
                      <TableHead className="w-12">
                        <span className="sr-only">{t("detail.enrollments.actions")}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <Fragment key={g.structure?.id ?? "building"}>
                      {/* Group rows inside the one table, never a card per
                          structure: the structure is said once, as its mark,
                          and "the whole building" is a statement — it says
                          the jardin's children may enrol too. */}
                      {showGroupRows && (
                        <StructureGroupRow
                          structure={
                            g.structure
                              ? { name: structureName(g.structure, locale), color: g.structure.color ?? "#19819a" }
                              : null
                          }
                          label={t("structures.wholeBuilding")}
                          count={t("list.count", { count: g.classes.length })}
                          colSpan={columns}
                        />
                      )}
                      {g.classes.map(activityRow)}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
