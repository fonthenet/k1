import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomChoice } from "@/components/modules/classes/class-types";
import { algiersDaySlices, type BusyKind, type BusySlot, type HomeClass } from "./room-state";

/**
 * The building's rooms and who is in them, read once for a page or a dialog.
 *
 * Both readers take the SIGNED-IN member's client and never a service-role
 * one: `kg_bookings` is granted to `authenticated` only and reads the source
 * tables under their own RLS through `kg_is_staff(auth.uid())`, and the
 * ledger it summarises is closed to every role. Nothing here is scoped by
 * the sidebar switcher — the ledger is establishment-wide, as the staff
 * ledger already is, because a room in the jardin is the same room to the
 * crèche next door (D13).
 */

export interface RoomChoices {
  /** Every room of the tenant, by name. */
  rooms: RoomChoice[];
  /** By room id, names locale-resolved. */
  homeClasses: Record<string, HomeClass[]>;
}

export interface RoomOccupancy extends RoomChoices {
  /** kg_bookings(from, to): lessons (with or without room), sessions, roomed events, activity occurrences — one slot per Algiers day each touches. */
  busy: BusySlot[];
}

interface Ctx {
  tenant: { id: string };
}

/** What kg_bookings returns, one row per booking or activity occurrence. */
interface BookingRow {
  source: BusyKind;
  source_id: string;
  room_id: string | null;
  explicit: boolean;
  starts_at: string;
  ends_at: string;
  class_id: string | null;
  membership_id: string | null;
  title: string | null;
}

interface ClassRow {
  id: string;
  name: string;
  name_ar: string | null;
  color: string | null;
  room_id: string | null;
}

interface ActivityNameRow {
  id: string;
  name: string;
  name_ar: string | null;
}

/**
 * The roomed activities' names in the reader's locale, by id.
 *
 * kg_bookings names an activity occurrence by `kg_activities.name` alone —
 * the French name — while /activities, the portal and the rooms table under
 * the sheet all print `name_ar` in Arabic, so without this read one screen
 * said إنجليزية in its table and Anglais in its lanes. Resolved here rather
 * than in the RPC because 0156 is not applied yet and every reader must
 * serve the 0155 shape as it is. Only activities with a room can appear in
 * the ledger, so only those are read.
 */
async function readActivityNames(db: SupabaseClient, ctx: Ctx, locale: string) {
  const activities = await db
    .from("kg_activities")
    .select("id,name,name_ar")
    .eq("tenant_id", ctx.tenant.id)
    .not("room_id", "is", null);
  if (activities.error) throw new Error(activities.error.message);
  return new Map<string, string>(
    ((activities.data ?? []) as ActivityNameRow[]).map((a) => [
      a.id,
      locale === "ar" && a.name_ar ? a.name_ar : a.name,
    ]),
  );
}

async function readChoices(db: SupabaseClient, ctx: Ctx, locale: string) {
  const [rooms, classes] = await Promise.all([
    db
      .from("kg_rooms")
      .select("id,name,name_ar,capacity,active")
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
    db
      .from("kg_classes")
      .select("id,name,name_ar,color,room_id")
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
  ]);
  if (rooms.error) throw new Error(rooms.error.message);
  if (classes.error) throw new Error(classes.error.message);
  const byId = new Map<string, HomeClass>();
  const homeClasses: Record<string, HomeClass[]> = {};
  for (const c of (classes.data ?? []) as ClassRow[]) {
    const cls: HomeClass = {
      id: c.id,
      name: locale === "ar" && c.name_ar ? c.name_ar : c.name,
      color: c.color ?? null,
    };
    byId.set(c.id, cls);
    if (c.room_id) (homeClasses[c.room_id] ??= []).push(cls);
  }
  return { rooms: (rooms.data ?? []) as RoomChoice[], homeClasses, byId };
}

/** Every room of the tenant plus the classes that live in each. */
export async function readRoomChoices(
  db: SupabaseClient,
  ctx: Ctx,
  locale: string,
): Promise<RoomChoices> {
  const { rooms, homeClasses } = await readChoices(db, ctx, locale);
  return { rooms, homeClasses };
}

/**
 * The choices plus every booking of the establishment in [from, to) — ISO
 * instants, `to` after `from`, at most 120 days or the RPC refuses (22023).
 * Windows in this build: a timetable its week, the rooms sheet the week
 * around `?day`, the calendar its visible grid, a dialog its day(s), the
 * activity dialog twelve weeks, a lesson series up to sixteen.
 */
export async function readRoomOccupancy(
  db: SupabaseClient,
  ctx: Ctx,
  locale: string,
  from: string,
  to: string,
): Promise<RoomOccupancy> {
  const [choices, activityNames, bookings] = await Promise.all([
    readChoices(db, ctx, locale),
    readActivityNames(db, ctx, locale),
    db.rpc("kg_bookings", { p_from: from, p_to: to }),
  ]);
  if (bookings.error) throw new Error(bookings.error.message);
  // A booking that crosses midnight (a multi-day roomed event) becomes one
  // slot per day, so the pre-checks find it on every day it books and the
  // sheet draws it on each; the `kind:id:date` keys the readers dedupe by
  // already tolerate several slots per source.
  const busy: BusySlot[] = ((bookings.data ?? []) as BookingRow[]).flatMap((b) =>
    algiersDaySlices(b.starts_at, b.ends_at).map((slice) => ({
      id: b.source_id,
      kind: b.source,
      classId: b.class_id,
      className: b.class_id ? (choices.byId.get(b.class_id)?.name ?? null) : null,
      membershipId: b.membership_id,
      roomId: b.room_id,
      explicit: b.explicit,
      ...slice,
      title:
        b.source === "activity"
          ? (activityNames.get(b.source_id) ?? b.title ?? "")
          : (b.title ?? ""),
    })),
  );
  return { rooms: choices.rooms, homeClasses: choices.homeClasses, busy };
}
