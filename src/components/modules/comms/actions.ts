"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { flushPush } from "@/app/actions/push";
import { addDaysStr, dateRange } from "./dates";
import { isOpenDayStr, toOpeningHours, type OpeningHours } from "@/lib/week";

export type ActionResult =
  | { ok: true; id?: string; count?: number }
  | { ok: false; error: "invalid" | "duplicate" | "forbidden" | "error" };

function mapDbError(error: { code?: string } | null): ActionResult {
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
    audience: z.enum(["all", "parents", "staff", "class"]),
    classId: z.uuid().nullable(),
    pinned: z.boolean(),
    publishAt: isoDateTime,
  })
  .refine((d) => d.audience !== "class" || d.classId !== null, { message: "class required" });

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

const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: optionalText,
    startAt: isoDateTime,
    endAt: isoDateTime.nullable(),
    audience: z.enum(["all", "parents", "staff", "class"]),
    classId: z.uuid().nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .refine((d) => d.audience !== "class" || d.classId !== null, { message: "class required" })
  .refine((d) => !d.endAt || Date.parse(d.endAt) >= Date.parse(d.startAt), {
    message: "end before start",
  });

export async function saveEvent(
  eventId: string | null,
  input: z.infer<typeof eventSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const row = {
    title: d.title,
    description: d.description,
    start_at: d.startAt,
    end_at: d.endAt,
    audience: d.audience,
    class_id: d.audience === "class" ? d.classId : null,
    color: d.color,
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
    revalidatePath("/calendar");
    return { ok: true, id: eventId };
  }

  const { data, error } = await supabase
    .from("kg_events")
    .insert({ ...row, tenant_id: ctx.tenant.id, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidatePath("/calendar");
  return { ok: true, id: data.id };
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(eventId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_events")
    .delete()
    .eq("id", eventId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidatePath("/calendar");
  return { ok: true };
}

// ===== Menus =====

const menuDaySchema = z.object({
  date: dateStr,
  breakfast: optionalText,
  lunch: optionalText,
  snack: optionalText,
  allergens: z.array(z.string().trim().min(1).max(100)).max(20),
  published: z.boolean(),
});

export async function saveMenuDay(input: z.infer<typeof menuDaySchema>): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = menuDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("kg_menus").upsert(
    {
      tenant_id: ctx.tenant.id,
      date: d.date,
      breakfast: d.breakfast,
      lunch: d.lunch,
      snack: d.snack,
      allergens: d.allergens,
      published: d.published,
    },
    { onConflict: "tenant_id,date" }
  );
  if (error) return mapDbError(error);
  revalidatePath("/menus");
  return { ok: true };
}

/** The crèche's own week, not a hardcoded one. See src/lib/week.ts. */
function tenantHours(tenant: unknown): OpeningHours {
  return toOpeningHours((tenant as { opening_hours?: unknown }).opening_hours);
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
export async function copyPreviousWeekMenus(weekStart: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!dateStr.safeParse(weekStart).success) return { ok: false, error: "invalid" };

  const hours = tenantHours(ctx.tenant);
  const targets = new Set(openDatesOfWeek(hours, weekStart));
  if (targets.size === 0) return { ok: true, count: 0 };

  const supabase = await createClient();
  const prevStart = addDaysStr(weekStart, -7);
  const { data: prevRows, error } = await supabase
    .from("kg_menus")
    .select("date, breakfast, lunch, snack, allergens")
    .eq("tenant_id", ctx.tenant.id)
    .gte("date", prevStart)
    .lte("date", addDaysStr(prevStart, 6));
  if (error) return mapDbError(error);
  if (!prevRows || prevRows.length === 0) return { ok: true, count: 0 };

  const rows = prevRows
    .map((r) => ({ ...r, date: addDaysStr(r.date, 7) }))
    // A source day whose mirror is a closed day this week has nowhere to go.
    .filter((r) => targets.has(r.date))
    .map((r) => ({
      tenant_id: ctx.tenant.id,
      date: r.date,
      breakfast: r.breakfast,
      lunch: r.lunch,
      snack: r.snack,
      allergens: r.allergens,
      published: false,
    }));
  if (rows.length === 0) return { ok: true, count: 0 };

  const { error: upErr } = await supabase
    .from("kg_menus")
    .upsert(rows, { onConflict: "tenant_id,date" });
  if (upErr) return mapDbError(upErr);
  revalidatePath("/menus");
  return { ok: true, count: rows.length };
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
export async function publishWeekMenus(weekStart: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!dateStr.safeParse(weekStart).success) return { ok: false, error: "invalid" };

  const dates = openDatesOfWeek(tenantHours(ctx.tenant), weekStart);
  if (dates.length === 0) return { ok: true, count: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_menus")
    .update({ published: true })
    .eq("tenant_id", ctx.tenant.id)
    .in("date", dates)
    .eq("published", false)
    .or("breakfast.not.is.null,lunch.not.is.null,snack.not.is.null")
    .select("date");
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
 * harmless; now it means a push to every family in the crèche, and the author
 * is the only person positioned to notice. So the number goes on screen next to
 * the picker — if it surprises them, they change the audience. That is the
 * whole anti-spam mechanism, and it costs one query.
 *
 * Returns a count only. kg_event_recipients stays revoked from clients because
 * it is a directory of parents; kg_event_audience_count is the narrow door.
 */
export async function eventAudienceCount(
  audience: string,
  classId: string | null,
  /** The event's start. An event that has already started notifies nobody —
   *  the count has to know that, or it promises an audience the insert trigger
   *  will refuse. */
  startAt: string | null
): Promise<{ count: number; past: boolean }> {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_event_audience_count", {
    p_tenant: ctx.tenant.id,
    p_audience: audience,
    p_class: classId,
    p_start_at: startAt,
  });
  // Decided here, not in the component: the client cannot read a clock during
  // render without breaking React's purity rule, and the server's clock is the
  // one the insert trigger will actually compare against.
  const past = startAt !== null ? Date.parse(startAt) <= Date.now() : false;

  // A failed count must never block saving an event — the dialog simply shows
  // nothing rather than a wrong number.
  if (error || typeof data !== "number") return { count: -1, past };
  return { count: data, past };
}
