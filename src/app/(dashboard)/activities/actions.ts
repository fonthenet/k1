"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { clashFromDetails, isRoomClash, type ClashRange } from "@/lib/db-clash";
import { DAY_KEYS, isWithinHours, toOpeningHours } from "@/lib/week";
import { ACTIVITY_CATEGORIES } from "@/components/modules/classes/class-types";

/**
 * The activities' own write path (0155).
 *
 * `saveActivity` and `setActivityActive` used to live beside the class
 * actions, where a slot was `{day, time}` with no end and no room. An
 * activity now books ONE room for every weekly slot, the database refuses a
 * slot that lands on a booking that named its room itself, and the refusal
 * has to come back as a sentence with a range — so the two actions moved
 * here, next to the page that owns them, with the room mapping of §7. The
 * structure travels in the same write: it used to need a second call because
 * the schema was somewhere this module did not own.
 */

export type ActivityActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: "invalid" | "forbidden" | "conflictRoom" | "error"; at?: ClashRange };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** The canonical slot, the only spelling the app writes from now on. */
const scheduleSlotSchema = z
  .object({ day: z.enum(DAY_KEYS), start: time, end: time })
  .refine((s) => s.end > s.start);

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null));

const activitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalText,
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
  category: z.enum(ACTIVITY_CATEGORIES),
  feeAmount: z.number().min(0).max(10_000_000),
  feePeriod: z.enum(["once", "monthly", "quarterly", "yearly", "per_session"]),
  capacity: z.number().int().min(1).max(500).nullable(),
  active: z.boolean(),
  schedule: z.array(scheduleSlotSchema).max(14),
  roomId: z.uuid().nullable(),
  structureId: z.uuid().nullable(),
});

export type SaveActivityInput = z.input<typeof activitySchema>;

/**
 * What the database said, as one of the four words the dialog knows.
 *
 * A room refusal is checked first and by its message, not its code alone:
 * 23P01 is any exclusion, and `room_booking` is the prefix of both room
 * guards (the ledger's constraint and the activity check). The DETAIL carries
 * the occupant's dated range when the other side is a booking; when it is
 * another activity the guard compares weekly patterns and names a weekday
 * instead, `clashFromDetails` reads nothing, and the toast says "on one of
 * the slots" — the line under the field already named the other activity.
 * A CHECK (23514: the shape, a bound out of order) and a reference the
 * composite FK refuses (23503: a room of another establishment) are both
 * "invalid": the dialog cannot have produced them, so there is nothing to
 * say to a person beyond that the save did not go through.
 */
function mapDbError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ActivityActionResult {
  if (error.code === "23P01" && isRoomClash(error.message)) {
    return { ok: false, error: "conflictRoom", at: clashFromDetails(error.details) };
  }
  if (error.code === "23514" || error.code === "23503") return { ok: false, error: "invalid" };
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "error" };
}

function revalidateActivity(activityId?: string) {
  revalidatePath("/activities");
  if (activityId) revalidatePath(`/activities/${activityId}`);
  // The room sheet and every room picker read the ledger, which the
  // activity's slots feed on demand.
  revalidatePath("/classes");
}

export async function saveActivity(
  activityId: string | null,
  input: SaveActivityInput,
): Promise<ActivityActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  // A slot on a day the establishment does not open is refused here, not just
  // hidden in the picker. The dialog offers the open days, but the day list
  // travels in the request, and a schedule that survives a later change of
  // opening days would put children in a room on a day nobody is there to
  // receive them. Both bounds must fall inside that day's hours: an activity
  // that starts at 15:30 and ends at 18:00 when the doors shut at 16:30 is a
  // room with nobody in it and a parent arriving to collect a child who was
  // never there.
  const hours = toOpeningHours((ctx.tenant as { opening_hours?: unknown }).opening_hours);
  if (
    d.schedule.some(
      (slot) => !isWithinHours(hours, slot.day, slot.start) || !isWithinHours(hours, slot.day, slot.end),
    )
  ) {
    return { ok: false, error: "invalid" };
  }

  const supabase = await createClient();

  // The structure's foreign key says the structure exists, not whose it is.
  // Without this, an id from another establishment would be stored happily
  // and the activity would then belong to a structure nobody here can see or
  // filter on. The room needs no such check: its key is composite on
  // (room_id, tenant_id) since 0155, so the database refuses a foreign room.
  if (d.structureId) {
    const { data: structure } = await supabase
      .from("kg_structures")
      .select("id")
      .eq("id", d.structureId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!structure) return { ok: false, error: "invalid" };
  }

  const row = {
    name: d.name,
    name_ar: d.nameAr,
    description: d.description,
    category: d.category,
    fee_amount: d.feeAmount,
    fee_period: d.feePeriod,
    capacity: d.capacity,
    // Written canonical ({day, start, end}); 0155 stores it as written and
    // 0156 canonicalises and checks every row.
    schedule: d.schedule,
    active: d.active,
    room_id: d.roomId,
    structure_id: d.structureId,
  };

  if (activityId) {
    if (!z.uuid().safeParse(activityId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_activities")
      .update(row)
      .eq("id", activityId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidateActivity(activityId);
    return { ok: true, id: activityId };
  }

  const { data, error } = await supabase
    .from("kg_activities")
    .insert({ ...row, tenant_id: ctx.tenant.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidateActivity(data.id);
  return { ok: true, id: data.id };
}

/**
 * Switch an activity on or off. Reactivating one puts its slots back into
 * the room, so the same guard runs and the same room refusal can come back;
 * the toggle prints it as its own sentence (the activity stays inactive).
 */
export async function setActivityActive(
  activityId: string,
  active: boolean,
): Promise<ActivityActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(activityId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_activities")
    .update({ active })
    .eq("id", activityId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateActivity(activityId);
  return { ok: true };
}
