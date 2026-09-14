"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { clashFromDetails, isRoomClash, type ClashRange } from "@/lib/db-clash";
import { flushPush } from "@/app/actions/push";
import { childDisplayName, intlLocale } from "@/lib/format";
import { addDaysStr, dateRange, isValidDateStr } from "./dates";
import { eventSpan } from "./datetime";
import { onStructure } from "./structures";
import type { EventInput, EventReach, EventResponseRow, RsvpSummary } from "./types";
import { isOpenDayStr, toOpeningHours, type OpeningHours } from "@/lib/week";

export type CommsActionResult =
  | { ok: true; id?: string; count?: number; repeated?: MenuRepeatResult }
  | {
      ok: false;
      error: "invalid" | "duplicate" | "forbidden" | "conflictRoom" | "error";
      at?: ClashRange;
    };
export type ActionResult = CommsActionResult;

/** What kg_repeat_menu did: days written, days it left alone, the last one written. */
export interface MenuRepeatResult {
  written: number;
  kept: number;
  last: string | null;
}

/**
 * The one refusal this module can say something about is the room's: an
 * event that names a room is a booking in the ledger of 0155, and the
 * exclusion (23P01, message `room_booking…`) carries the existing booking's
 * range in its DETAIL. A roomed event without an end is the CHECK
 * `kg_events_room_needs_range` (23514) — the dialog never lets it through,
 * so here it is simply invalid.
 */
function mapDbError(
  error: { code?: string; message?: string; details?: string } | null,
): CommsActionResult {
  if (error?.code === "23P01" && isRoomClash(error.message)) {
    return { ok: false, error: "conflictRoom", at: clashFromDetails(error.details) };
  }
  if (error?.code === "23514") return { ok: false, error: "invalid" };
  if (error?.code === "23505") return { ok: false, error: "duplicate" };
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "error" };
}

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : null));

const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "invalid datetime" });

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ===== Announcements =====

const announcementSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(5000),
    audience: z.enum(["all", "parents", "staff", "class", "structure"]),
    classId: z.uuid().nullable(),
    structureId: z.uuid().nullable(),
    pinned: z.boolean(),
    publishAt: isoDateTime,
  })
  .refine((d) => d.audience !== "class" || d.classId !== null, { message: "class required" })
  // The same guard the class audience has, and for the same reason: an
  // audience naming a structure with no structure named reaches nobody, and
  // reads on the wall as if it had reached somebody.
  .refine((d) => d.audience !== "structure" || d.structureId !== null, {
    message: "structure required",
  });

export async function saveAnnouncement(
  announcementId: string | null,
  input: z.infer<typeof announcementSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const row = {
    title: d.title,
    body: d.body,
    audience: d.audience,
    class_id: d.audience === "class" ? d.classId : null,
    structure_id: d.audience === "structure" ? d.structureId : null,
    pinned: d.pinned,
    publish_at: d.publishAt,
  };

  const supabase = await createClient();
  if (announcementId) {
    if (!z.uuid().safeParse(announcementId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_announcements")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", announcementId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidatePath("/announcements");
    return { ok: true, id: announcementId };
  }

  const { data, error } = await supabase
    .from("kg_announcements")
    .insert({ ...row, tenant_id: ctx.tenant.id, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidatePath("/announcements");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true, id: data.id };
}

export async function deleteAnnouncement(announcementId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(announcementId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_announcements")
    .delete()
    .eq("id", announcementId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidatePath("/announcements");
  return { ok: true };
}

// ===== Messaging =====

const threadSchema = z.object({
  childId: z.uuid().nullable(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

/**
 * Records that the signed-in person has opened a thread.
 *
 * Returns whether anything changed, so the caller refreshes the list only when
 * a dot actually needs to disappear rather than on every mount.
 *
 * Uses getTenantContext, not requireStaff: parents read threads too, and the
 * database restates the visibility rule itself (0070).
 */
export async function markThreadRead(threadId: string): Promise<boolean> {
  if (!z.uuid().safeParse(threadId).success) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_mark_thread_read", { p_thread: threadId });
  if (error || data !== true) return false;

  // Revalidate here rather than leaving it to the caller: the thread list is
  // rendered by the very page the reader is looking at, so the dot has to
  // disappear under them, not on their next visit. Self-limiting — a second
  // call finds the marker already current, returns false above, and never
  // reaches this line, so there is no revalidate/re-render loop.
  revalidatePath("/messages", "layout");
  revalidatePath("/portal/messages", "layout");
  return true;
}

export async function createThread(input: z.infer<typeof threadSchema>): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = threadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: thread, error } = await supabase
    .from("kg_threads")
    .insert({
      tenant_id: ctx.tenant.id,
      child_id: d.childId,
      subject: d.subject,
      created_by: ctx.user.id,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);

  const { error: msgErr } = await supabase.from("kg_thread_messages").insert({
    thread_id: thread.id,
    tenant_id: ctx.tenant.id,
    sender_id: ctx.user.id,
    body: d.body,
  });
  if (msgErr) return mapDbError(msgErr);

  revalidatePath("/messages");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true, id: thread.id };
}

const replySchema = z.object({
  threadId: z.uuid(),
  body: z.string().trim().min(1).max(5000),
});

export async function sendThreadMessage(input: z.infer<typeof replySchema>): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("kg_thread_messages").insert({
    thread_id: d.threadId,
    tenant_id: ctx.tenant.id,
    sender_id: ctx.user.id,
    body: d.body,
  });
  if (error) return mapDbError(error);

  const { error: updErr } = await supabase
    .from("kg_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", d.threadId)
    .eq("tenant_id", ctx.tenant.id);
  if (updErr) return mapDbError(updErr);

  revalidatePath("/messages");
  revalidatePath(`/messages/${d.threadId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

// ===== Calendar events =====

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * The form's parts, validated before any instant is built (an unparseable
 * part would make the Date constructor throw instead of returning a clean
 * `invalid`). A timed event carries an end date and an end time together or
 * not at all; an all-day event carries no times; the end never precedes the
 * start — equal is allowed, because a past row with end_at = start_at is a
 * valid row and must stay editable; a room needs a real span, because the
 * ledger of 0155 holds ranges, not instants (kg_events_room_needs_range).
 */
const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .transform((v) => (v ? v : null)),
    date: dateStr.refine(isValidDateStr),
    startTime: timeStr.nullable(),
    endDate: dateStr.refine(isValidDateStr).nullable(),
    endTime: timeStr.nullable(),
    allDay: z.boolean(),
    audience: z.enum(["all", "parents", "staff", "class", "structure"]),
    classId: z.uuid().nullable(),
    structureId: z.uuid().nullable(),
    roomId: z.uuid().nullable(),
    rsvp: z.boolean(),
  })
  .refine((d) => d.allDay || d.startTime !== null, { message: "start time required" })
  .refine((d) => d.allDay || (d.endDate === null) === (d.endTime === null), {
    message: "end date and end time go together",
  })
  .refine((d) => !d.allDay || d.endDate === null || d.endDate >= d.date, {
    message: "end before start",
  })
  .refine(
    (d) => {
      if (d.allDay) return true;
      const span = eventSpan(d);
      return span.endAt === null || Date.parse(span.endAt) >= Date.parse(span.startAt);
    },
    { message: "end before start" },
  )
  .refine(
    (d) => {
      if (!d.roomId) return true;
      const span = eventSpan(d);
      return span.endAt !== null && Date.parse(span.endAt) > Date.parse(span.startAt);
    },
    { message: "room needs a span" },
  )
  .refine((d) => d.audience !== "class" || d.classId !== null, { message: "class required" })
  .refine((d) => d.audience !== "structure" || d.structureId !== null, {
    message: "structure required",
  });

/** The pages an event sits on: the staff calendar, the family's home and calendar, the dashboard's next-days card. */
function revalidateEventPages() {
  revalidatePath("/calendar");
  revalidatePath("/portal");
  revalidatePath("/portal/calendar");
  revalidatePath("/dashboard");
}

/**
 * Creates or updates an event. The colour column is never written: an event
 * is drawn in one tint and carries its structure's dot, so the row keeps
 * whatever it has and a new row takes the column default. The database does
 * the telling (0159's insert and update triggers) and this only flushes the
 * push queue afterwards so the phones ring now rather than on the next cron.
 */
export async function saveEvent(eventId: string | null, input: EventInput): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  const span = eventSpan(d);

  const row = {
    title: d.title,
    description: d.description,
    start_at: span.startAt,
    end_at: span.endAt,
    all_day: d.allDay,
    audience: d.audience,
    class_id: d.audience === "class" ? d.classId : null,
    structure_id: d.audience === "structure" ? d.structureId : null,
    room_id: d.roomId,
    // A staff meeting asks no family anything: the summary counts family
    // recipients, and a box that can never be answered is a lie on screen.
    rsvp: d.audience === "staff" ? false : d.rsvp,
  };

  const supabase = await createClient();
  if (eventId) {
    if (!z.uuid().safeParse(eventId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_events")
      .update(row)
      .eq("id", eventId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidateEventPages();
    await flushPush();
    return { ok: true, id: eventId };
  }

  const { data, error } = await supabase
    .from("kg_events")
    .insert({ ...row, tenant_id: ctx.tenant.id, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidateEventPages();
  await flushPush();
  return { ok: true, id: data.id };
}

/**
 * Cancels without deleting. Once anyone was told, the row has to stay: the
 * pill stays on every calendar struck through, the room is released, and
 * the update trigger tells everyone still told that it is off. The person
 * doing it is stamped as cancelled_by, because the notification speaks in
 * their name and never in the author's by assumption (decision 7).
 */
export async function cancelEvent(eventId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(eventId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_events")
    .update({ cancelled_at: new Date().toISOString(), cancelled_by: ctx.user.id })
    .eq("id", eventId)
    .eq("tenant_id", ctx.tenant.id)
    .is("cancelled_at", null);
  if (error) return mapDbError(error);
  revalidateEventPages();
  await flushPush();
  return { ok: true, id: eventId };
}

/** Puts a cancelled event back; the update trigger tells the current audience it has changed. */
export async function restoreEvent(eventId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(eventId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_events")
    .update({ cancelled_at: null, cancelled_by: null })
    .eq("id", eventId)
    .eq("tenant_id", ctx.tenant.id)
    .not("cancelled_at", "is", null);
  if (error) return mapDbError(error);
  revalidateEventPages();
  await flushPush();
  return { ok: true, id: eventId };
}

/**
 * Deletes an event nobody was told about. A told event is cancelled instead
 * (cancelEvent), so its pill stays and the people told read "annulé" rather
 * than finding a hole: the dialog offers Delete only when the reach is
 * zero, and this refuses a stale screen's request the same way. A delete
 * the database itself cascades (a class removed) still speaks through the
 * delete trigger; this is the only door that checks first.
 */
export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(eventId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: reach, error: reachErr } = await supabase.rpc("kg_event_reach", {
    p_tenant: ctx.tenant.id,
    p_event_ids: [eventId],
  });
  if (reachErr) return mapDbError(reachErr);
  const told = ((reach ?? []) as { families: number; staff: number }[]).some(
    (r) => r.families + r.staff > 0,
  );
  if (told) return { ok: false, error: "invalid" };

  const { error } = await supabase
    .from("kg_events")
    .delete()
    .eq("id", eventId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateEventPages();
  return { ok: true };
}

/**
 * Who was told, per event: families, staff and how many read it, each
 * person counted once by their latest row (a family moved away no longer
 * counts). Events the database returned nothing for reached nobody.
 */
export async function eventReach(eventIds: string[]): Promise<Record<string, EventReach>> {
  const ctx = await requireStaff();
  const ids = eventIds.filter((id) => z.uuid().safeParse(id).success);
  if (ids.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_event_reach", {
    p_tenant: ctx.tenant.id,
    p_event_ids: ids,
  });
  // A failed count must never block the calendar: every event simply reads
  // as unreached, which is what a missing row means too.
  if (error) return {};
  const out: Record<string, EventReach> = {};
  for (const r of (data ?? []) as { event_id: string; families: number; staff: number; read: number }[]) {
    out[r.event_id] = { families: r.families, staff: r.staff, read: r.read };
  }
  return out;
}

/** The answers so far, per person; null when the caller may not read them or the event asked nobody. */
export async function eventRsvp(eventId: string): Promise<RsvpSummary | null> {
  await requireStaff();
  if (!z.uuid().safeParse(eventId).success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_event_rsvp_summary", { p_event: eventId });
  if (error) return null;
  const row = ((data ?? []) as { going: number; not_going: number; asked: number }[])[0];
  if (!row) return null;
  return { going: row.going, notGoing: row.not_going, asked: row.asked };
}

/**
 * Every answer with the person's name, for the director's list under the
 * dialog. The rows come through rsp_own_sel (educators read every answer of
 * their tenant); the names are the guardian's, because that is who answers,
 * with the profile's full name for a member who is not a guardian on file.
 * Those who said yes come first, then by name in the reader's script.
 */
export async function eventResponses(eventId: string): Promise<EventResponseRow[]> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(eventId).success) return [];

  const [supabase, locale] = await Promise.all([createClient(), getLocale()]);
  const { data: rows, error } = await supabase
    .from("kg_event_responses")
    .select("user_id, response, note, responded_at")
    .eq("event_id", eventId)
    .eq("tenant_id", ctx.tenant.id);
  if (error || !rows || rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r) => r.user_id as string)));
  const [guardiansRes, profilesRes] = await Promise.all([
    supabase
      .from("kg_guardians")
      .select("user_id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .in("user_id", userIds),
    supabase.from("kg_profiles").select("id, full_name").in("id", userIds),
  ]);
  const guardianName = new Map<string, string>();
  for (const g of guardiansRes.data ?? []) {
    if (g.user_id && !guardianName.has(g.user_id)) guardianName.set(g.user_id, childDisplayName(g, locale));
  }
  const profileName = new Map<string, string>();
  for (const p of profilesRes.data ?? []) {
    if (p.full_name) profileName.set(p.id, p.full_name);
  }

  const collator = new Intl.Collator(intlLocale(locale));
  return rows
    .map((r) => ({
      userId: r.user_id as string,
      name: guardianName.get(r.user_id) ?? profileName.get(r.user_id) ?? "",
      response: r.response as "going" | "not_going",
      note: (r.note as string | null) ?? null,
      respondedAt: r.responded_at as string,
    }))
    .sort(
      (a, b) =>
        Number(a.response !== "going") - Number(b.response !== "going") ||
        collator.compare(a.name, b.name),
    );
}

/**
 * Is the door shut on this day, and by what name — the one closure rule
 * (kg_closure_on, 0157) asked from a dialog: the event dialog when its page
 * did not hand it the closures, the follow-up and assessment dialogs on
 * every date change. A confirmed closure is said in muted text, a tentative
 * one in gold; neither refuses anything here, the database does that on
 * save. A failed read says nothing rather than something wrong.
 */
export async function closedDayStatus(
  structureId: string | null,
  date: string,
): Promise<{ confirmed: string | null; tentative: string | null }> {
  const none = { confirmed: null, tentative: null };
  const ctx = await requireStaff();
  if (!isValidDateStr(date)) return none;
  if (structureId !== null && !z.uuid().safeParse(structureId).success) return none;

  const [supabase, locale] = await Promise.all([createClient(), getLocale()]);
  const { data, error } = await supabase.rpc("kg_closure_on", {
    p_structure: structureId,
    p_tenant: ctx.tenant.id,
    p_date: date,
  });
  if (error) return none;
  const rows = (data ?? []) as { name: string; name_ar: string | null; tentative: boolean }[];
  const label = (r: { name: string; name_ar: string | null }) => (locale === "ar" && r.name_ar) || r.name;
  const confirmed = rows.find((r) => !r.tentative);
  const tentative = rows.find((r) => r.tentative);
  return { confirmed: confirmed ? label(confirmed) : null, tentative: tentative ? label(tentative) : null };
}

// ===== Menus =====

const menuDaySchema = z.object({
  date: dateStr,
  /** Whose lunch. Null = the whole building: one kitchen, one menu (0125). */
  structureId: z.uuid().nullable(),
  breakfast: optionalText,
  lunch: optionalText,
  snack: optionalText,
  allergens: z.array(z.string().trim().min(1).max(100)).max(20),
  published: z.boolean(),
  /**
   * "Every Sunday until…": after the day is saved, kg_repeat_menu (0151)
   * copies it onto the same weekday up to `until`, skipping closed days and
   * — unless `replace` — days already filled in. Absent = this day only.
   */
  repeat: z
    .object({ until: dateStr, replace: z.boolean() })
    .nullable()
    .optional(),
});

export async function saveMenuDay(input: z.infer<typeof menuDaySchema>): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = menuDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const meals = {
    breakfast: d.breakfast,
    lunch: d.lunch,
    snack: d.snack,
    allergens: d.allergens,
    published: d.published,
  };

  // Read, then write — deliberately not an upsert.
  //
  // A day's identity is now (tenant, date, coalesce(structure_id, …)): an
  // EXPRESSION index, because null means the whole building and two nulls must
  // collide instead of stacking two menus on one day. PostgREST's on_conflict
  // takes bare column names, so it can name neither that index nor the plain
  // (tenant, date) one it replaced.
  const { data: existing, error: readErr } = await onStructure(
    supabase.from("kg_menus").select("id").eq("tenant_id", ctx.tenant.id).eq("date", d.date),
    d.structureId
  ).maybeSingle();
  if (readErr) return mapDbError(readErr);

  const { error } = existing
    ? await supabase
        .from("kg_menus")
        .update(meals)
        .eq("id", existing.id)
        .eq("tenant_id", ctx.tenant.id)
    : await supabase.from("kg_menus").insert({
        ...meals,
        tenant_id: ctx.tenant.id,
        date: d.date,
        structure_id: d.structureId,
      });
  if (error) return mapDbError(error);

  // The repeat runs in the database, one call for the whole horizon, so a
  // year of Sundays is one round trip and one transaction — and the rule
  // about closed days lives next to the tables that define them.
  let repeated: MenuRepeatResult | undefined;
  if (d.repeat) {
    const { data, error: repeatErr } = await supabase.rpc("kg_repeat_menu", {
      p_date: d.date,
      p_structure: d.structureId,
      p_until: d.repeat.until,
      p_replace: d.repeat.replace,
    });
    if (repeatErr) return mapDbError(repeatErr);
    const r = (data ?? {}) as Partial<MenuRepeatResult>;
    repeated = { written: r.written ?? 0, kept: r.kept ?? 0, last: r.last ?? null };
  }
  revalidatePath("/menus");
  revalidatePath("/portal");
  revalidatePath("/dashboard");
  return { ok: true, repeated };
}

/** The crèche's own week, not a hardcoded one. See src/lib/week.ts. */
function tenantHours(tenant: unknown): OpeningHours {
  return toOpeningHours((tenant as { opening_hours?: unknown }).opening_hours);
}

/**
 * The week kept by the scope being planned for.
 *
 * A jardin that shuts on Thursday while the crèche stays open is the reason
 * this is not simply the tenant's week: copying or publishing "the week" for
 * the jardin must not invent a Thursday. kg_structure_hours already answers
 * "its own hours, or the building's" — the coalesce is not restated here.
 */
async function scopeHours(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenant: { id: string },
  structureId: string | null
): Promise<OpeningHours> {
  if (structureId === null) return tenantHours(tenant);
  const { data } = await supabase.rpc("kg_structure_hours", {
    p_structure: structureId,
    p_tenant: tenant.id,
  });
  return data ? toOpeningHours(data) : tenantHours(tenant);
}

/** Dates in [start, start+6] the crèche actually opens on. */
function openDatesOfWeek(hours: OpeningHours, start: string): string[] {
  return dateRange(start, addDaysStr(start, 6), 7).filter((d) => isOpenDayStr(hours, d));
}

/**
 * Copy the previous week's menus onto the week starting at `weekStart`.
 *
 * Two rules that are easy to get wrong, and were:
 *
 * DRAFTS. The copy lands unpublished, whatever the source week was. Copying
 * forward is how a kitchen plans ahead, and the whole point of planning ahead
 * is that somebody checks it before parents read it — carrying `published`
 * across meant a fortnight of menus went live the instant the button was
 * pressed, allergens and all, with nobody having looked. Publishing is now a
 * separate, deliberate act: publishWeekMenus.
 *
 * THE WEEK IS THE TENANT'S. This used to read Sunday→Thursday out of the
 * previous week and write it five days later, which silently dropped a
 * Saturday-opening crèche's Saturday and invented menus for a Thursday-closed
 * one. Both ends now follow the stored opening hours.
 */
export async function copyPreviousWeekMenus(
  weekStart: string,
  /** The scope being planned; null = the whole building. */
  structureId: string | null = null
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!dateStr.safeParse(weekStart).success) return { ok: false, error: "invalid" };
  if (structureId !== null && !z.uuid().safeParse(structureId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const targets = new Set(
    openDatesOfWeek(await scopeHours(supabase, ctx.tenant, structureId), weekStart)
  );
  if (targets.size === 0) return { ok: true, count: 0 };

  const prevStart = addDaysStr(weekStart, -7);
  const { data: prevRows, error } = await onStructure(
    supabase
      .from("kg_menus")
      .select("date, breakfast, lunch, snack, allergens")
      .eq("tenant_id", ctx.tenant.id)
      .gte("date", prevStart)
      .lte("date", addDaysStr(prevStart, 6)),
    structureId
  );
  if (error) return mapDbError(error);
  if (!prevRows || prevRows.length === 0) return { ok: true, count: 0 };

  const planned = prevRows
    .map((r) => ({ ...r, date: addDaysStr(r.date, 7) }))
    // A source day whose mirror is a closed day this week has nowhere to go.
    .filter((r) => targets.has(r.date))
    .map((r) => ({
      date: r.date as string,
      meals: {
        breakfast: r.breakfast,
        lunch: r.lunch,
        snack: r.snack,
        allergens: r.allergens,
        published: false,
      },
    }));
  if (planned.length === 0) return { ok: true, count: 0 };

  // The days of the target week that already exist for this scope. Same reason
  // saveMenuDay reads first: the unique key is an expression index no
  // on_conflict can name, so an overwrite has to be an update by id.
  const { data: existing, error: exErr } = await onStructure(
    supabase
      .from("kg_menus")
      .select("id, date")
      .eq("tenant_id", ctx.tenant.id)
      .gte("date", weekStart)
      .lte("date", addDaysStr(weekStart, 6)),
    structureId
  );
  if (exErr) return mapDbError(exErr);
  const idByDate = new Map((existing ?? []).map((r) => [r.date as string, r.id as string]));

  const fresh = planned
    .filter((p) => !idByDate.has(p.date))
    .map((p) => ({
      ...p.meals,
      tenant_id: ctx.tenant.id,
      date: p.date,
      structure_id: structureId,
    }));
  if (fresh.length > 0) {
    const { error: insErr } = await supabase.from("kg_menus").insert(fresh);
    if (insErr) return mapDbError(insErr);
  }

  const overwritten = await Promise.all(
    planned
      .filter((p) => idByDate.has(p.date))
      .map((p) =>
        supabase
          .from("kg_menus")
          .update(p.meals)
          .eq("id", idByDate.get(p.date)!)
          .eq("tenant_id", ctx.tenant.id)
      )
  );
  const failed = overwritten.find((r) => r.error);
  if (failed?.error) return mapDbError(failed.error);

  revalidatePath("/menus");
  return { ok: true, count: planned.length };
}

/**
 * Publish every day of a week that has something on it.
 *
 * The counterpart to copying as drafts: without this, making the copy a draft
 * would mean opening five dialogs and flipping five switches to undo it.
 *
 * Empty days are left alone deliberately. "Published" on a day with no meals
 * tells a parent the kitchen has decided there is nothing to eat, which is a
 * different statement from "we have not filled this in yet".
 */
export async function publishWeekMenus(
  weekStart: string,
  /** The scope being published; null = the whole building. */
  structureId: string | null = null
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!dateStr.safeParse(weekStart).success) return { ok: false, error: "invalid" };
  if (structureId !== null && !z.uuid().safeParse(structureId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const dates = openDatesOfWeek(await scopeHours(supabase, ctx.tenant, structureId), weekStart);
  if (dates.length === 0) return { ok: true, count: 0 };

  // Scoped, so publishing the jardin's week leaves the crèche's drafts alone —
  // they are a different kitchen's plan and a different button's job.
  const { data, error } = await onStructure(
    supabase
      .from("kg_menus")
      .update({ published: true })
      .eq("tenant_id", ctx.tenant.id)
      .in("date", dates)
      .eq("published", false)
      .or("breakfast.not.is.null,lunch.not.is.null,snack.not.is.null"),
    structureId
  ).select("date");
  if (error) return mapDbError(error);
  revalidatePath("/menus");
  return { ok: true, count: data?.length ?? 0 };
}

// ===== Incidents =====

const incidentSchema = z.object({
  childId: z.uuid(),
  severity: z.enum(["minor", "moderate", "serious"]),
  location: optionalText,
  occurredAt: isoDateTime,
  description: z.string().trim().min(1).max(5000),
  actionTaken: optionalText,
  notifyParent: z.boolean(),
});

export async function reportIncident(input: z.infer<typeof incidentSchema>): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = incidentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_incidents")
    .insert({
      tenant_id: ctx.tenant.id,
      child_id: d.childId,
      occurred_at: d.occurredAt,
      severity: d.severity,
      location: d.location,
      description: d.description,
      action_taken: d.actionTaken,
      reported_by: ctx.user.id,
      parent_notified_at: d.notifyParent ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidatePath("/incidents");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true, id: data.id };
}

/** Mark the parent as notified now (used from the detail page when not notified at report time). */
export async function notifyIncidentParent(incidentId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(incidentId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_incidents")
    .update({ parent_notified_at: new Date().toISOString() })
    .eq("id", incidentId)
    .eq("tenant_id", ctx.tenant.id)
    .is("parent_notified_at", null);
  if (error) return mapDbError(error);
  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incidentId}`);
  return { ok: true };
}

/**
 * How many people this event would interrupt, for the dialog to show before it
 * saves.
 *
 * The audience picker defaults to "all". While events notified nobody that was
 * harmless; now it means a push to every family in the establishment, and the
 * author is the only person positioned to notice. So the number goes on screen
 * next to the picker — if it surprises them, they change the audience. That is
 * the whole anti-spam mechanism, and it costs one query.
 *
 * Returns a count only. kg_event_recipients stays revoked from clients because
 * it is a directory of parents; kg_event_audience_count is the narrow door.
 */
export async function eventAudienceCount(
  audience: string,
  classId: string | null,
  /** The event's start. An event that has already ENDED notifies nobody —
   *  the triggers compare coalesce(end_at, start_at) to now — so the count
   *  has to know the same instant, or it promises an audience the insert
   *  trigger will refuse. */
  startAt: string | null,
  structureId: string | null = null,
  /** The event's end, when it has one; it is what decides "past", not the start. */
  endAt: string | null = null,
): Promise<{ count: number; past: boolean }> {
  const ctx = await requireStaff();
  const supabase = await createClient();
  // The RPC's p_start_at is really "the instant after which nobody is told":
  // it returns 0 once that instant has passed, exactly as the triggers do
  // for coalesce(end_at, start_at). So the end goes there when there is one.
  const deadline = endAt ?? startAt;
  const { data, error } = await supabase.rpc("kg_event_audience_count", {
    p_tenant: ctx.tenant.id,
    p_audience: audience,
    p_class: classId,
    p_start_at: deadline,
    // Sent only when it is the question being asked. p_structure has a default,
    // so the four-argument call is still the one PostgREST resolves for every
    // other audience — and stays resolvable on a database that has not learned
    // the word yet.
    ...(structureId !== null ? { p_structure: structureId } : {}),
  });
  // Decided here, not in the component: the client cannot read a clock during
  // render without breaking React's purity rule, and the server's clock is the
  // one the insert trigger will actually compare against.
  const past = deadline !== null ? Date.parse(deadline) <= Date.now() : false;

  // A failed count must never block saving an event — the dialog simply shows
  // nothing rather than a wrong number.
  if (error || typeof data !== "number") return { count: -1, past };
  return { count: data, past };
}
