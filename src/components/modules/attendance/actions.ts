"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { algiersInstant, algiersToday } from "@/lib/algiers";
import { flushPush } from "@/app/actions/push";
import { isAway, isPresentish } from "./status-config";

export type ActionResult =
  | { ok: true; count?: number }
  | { ok: false; error: string };

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * The register is a record of what happened, so nothing may be written about
 * a day that has not started. Compared in Algiers, not on the host: at 23:30
 * UTC on a Sunday the host still says Sunday while every crèche is already on
 * Monday, and refusing Monday there would lock the register for an hour every
 * night.
 */
function isFutureDate(date: string): boolean {
  return date > algiersToday();
}

const setStatusSchema = z.object({
  childId: uuid,
  date: dateStr,
  status: z.enum(["present", "late", "absent", "sick", "excused"]),
});

/** Upsert the day's status (kg_attendance is unique on child_id+date). */
export async function setAttendanceStatus(
  input: z.infer<typeof setStatusSchema>
): Promise<ActionResult> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, status } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("kg_attendance")
    .select("id, check_in_at")
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", childId)
    .eq("date", date)
    .maybeSingle();

  const presentish = isPresentish(status);
  const row: Record<string, unknown> = {
    tenant_id: ctx.tenant.id,
    child_id: childId,
    date,
    status,
  };
  if (presentish) {
    row.absence_reason = null;
    // The arrival is stamped with "now" ONLY when the register is on today.
    // Backfilling Thursday's register on Sunday morning used to stamp every
    // child as arriving at the moment of data entry, and because
    // trg_kg_notify_attendance treats an INSERT with a check_in_at as an
    // arrival, every family was pushed "{child} arrived 09:12" about a day
    // that was already over. A past day gets the status alone; the real time,
    // if anyone knows it, goes in through the pencil.
    if (!existing?.check_in_at && date === algiersToday()) {
      row.check_in_at = new Date().toISOString();
      row.check_in_method = "manual";
      row.checked_in_by = ctx.user.id;
    }
  }

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(row, { onConflict: "child_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const setTimesSchema = z.object({
  childId: uuid,
  date: dateStr,
  checkIn: timeStr.or(z.literal("")),
  checkOut: timeStr.or(z.literal("")),
});

/** Manually set (or clear, with "") the check-in / check-out times of a day. */
export async function setAttendanceTimes(
  input: z.infer<typeof setTimesSchema>
): Promise<ActionResult> {
  const parsed = setTimesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, checkIn, checkOut } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  const supabase = await createClient();

  // The typed HH:mm is Algiers wall-clock time and must be anchored to +01:00
  // explicitly. `new Date(`${date}T${time}:00`)` parsed it in the HOST zone —
  // UTC on Vercel — so "08:30" was stored as 08:30Z, printed as 09:30, and
  // re-saving the dialog moved the row another hour each time. Three auditors
  // found this line independently.
  const toIso = (time: string) => (time === "" ? null : algiersInstant(date, time));

  const { data: existing } = await supabase
    .from("kg_attendance")
    .select("status")
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", childId)
    .eq("date", date)
    .maybeSingle();

  const row: Record<string, unknown> = {
    tenant_id: ctx.tenant.id,
    child_id: childId,
    date,
    check_in_at: toIso(checkIn),
    check_in_method: checkIn === "" ? null : "manual",
    check_out_at: toIso(checkOut),
    check_out_method: checkOut === "" ? null : "manual",
  };
  if (checkIn !== "") {
    // A manual check-in implies the child was there — but not that they were on
    // time. Correcting a late child's arrival time used to rewrite them to
    // `present`, which is the one edit staff make most often on a late row.
    // Only a row that says nothing yet, or one whose absence was reported and
    // then contradicted by an arrival, gets promoted.
    if (existing?.status == null || isAway(existing.status))
      row.status = "present";
    row.checked_in_by = ctx.user.id;
  }
  if (checkOut !== "") row.checked_out_by = ctx.user.id;

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(row, { onConflict: "child_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const checkOutSchema = z.object({
  childId: uuid,
  date: dateStr,
  // Who took the child. The register's one safeguarding fact, and it was not
  // being recorded at all on this path.
  pickedUpBy: z.string().trim().max(120).optional(),
  // The record, not just the name: a guardian id can be checked against the
  // child's file afterwards, and a typed string cannot.
  guardianId: uuid.optional(),
});

/** Row action: record the check-out right now. */
export async function checkOutNow(
  input: z.infer<typeof checkOutSchema>
): Promise<ActionResult> {
  const parsed = checkOutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, pickedUpBy, guardianId } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase
    .from("kg_attendance")
    .update({
      check_out_at: new Date().toISOString(),
      check_out_method: "manual",
      checked_out_by: ctx.user.id,
      // Only ever ADD the collector — a check-out with the box left empty must
      // not wipe a name the kiosk or an earlier correction already recorded.
      ...(pickedUpBy ? { picked_up_by: pickedUpBy } : {}),
      ...(guardianId ? { checked_out_guardian_id: guardianId } : {}),
    })
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", childId)
    .eq("date", date);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const textFieldSchema = z.object({
  childId: uuid,
  date: dateStr,
  field: z.enum(["picked_up_by", "absence_reason"]),
  value: z.string().trim().max(200),
});

/** Save picked_up_by / absence_reason for a day (creates the row if needed). */
export async function setAttendanceText(
  input: z.infer<typeof textFieldSchema>
): Promise<ActionResult> {
  const parsed = textFieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, field, value } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    tenant_id: ctx.tenant.id,
    child_id: childId,
    date,
    [field]: value === "" ? null : value,
  };

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(row, { onConflict: "child_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const bulkSchema = z.object({
  date: dateStr,
  childIds: z.array(uuid).min(1).max(300),
});

/**
 * "Tout marquer présent" — inserts a present row for children with no row yet.
 *
 * Existing rows are never touched, which is also what keeps a parent's
 * absence report safe: the family said "sick" this morning, the row is there,
 * and the button walks past it.
 */
export async function markAllPresent(
  input: z.infer<typeof bulkSchema>
): Promise<ActionResult> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { date, childIds } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  const supabase = await createClient();

  // This is the one write that marks a whole room in a tap, so it is the one
  // that must know the door was shut. kg_is_open_on carries both rules — the
  // tenant's week and its confirmed holiday closures — so the register and
  // the database cannot disagree about whether 1 November was a school day.
  // A single child can still be marked by hand on a closed day: an
  // exceptional opening is the office's call, a bulk stamp is not.
  const { data: open, error: openError } = await supabase.rpc("kg_is_open_on", {
    p_tenant: ctx.tenant.id,
    p_date: date,
  });
  if (openError) return { ok: false, error: openError.message };
  if (open === false) return { ok: false, error: "closed" };

  const { data: existing, error: selError } = await supabase
    .from("kg_attendance")
    .select("child_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("date", date)
    .in("child_id", childIds);
  if (selError) return { ok: false, error: selError.message };

  const done = new Set((existing ?? []).map((r) => r.child_id as string));
  const missing = childIds.filter((id) => !done.has(id));
  if (missing.length === 0) return { ok: true, count: 0 };

  // Same rule as setAttendanceStatus: an arrival time only exists for today.
  // A past day filled in from memory gets the word "present" and nothing
  // else, so no family is told their child "arrived" at the minute the
  // office caught up on paperwork.
  const arrival =
    date === algiersToday()
      ? {
          check_in_at: new Date().toISOString(),
          check_in_method: "manual",
          checked_in_by: ctx.user.id,
        }
      : {};
  const rows = missing.map((child_id) => ({
    tenant_id: ctx.tenant.id,
    child_id,
    date,
    status: "present",
    ...arrival,
  }));

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(rows, { onConflict: "child_id,date", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true, count: missing.length };
}

// ------------------------------------------------------------- kiosk exit

const exitSchema = z.object({
  secret: z.string().min(1).max(200),
});

export type KioskExitResult = { ok: false; error: "wrong" | "locked" | "noPin" | "invalid" };

/**
 * Leaves the door kiosk — behind a secret, and never into the dashboard.
 *
 * The kiosk header used to carry a plain link to /dashboard. The tablet is
 * signed in as a staff account and mounted in a hall where every parent and
 * every visiting older sibling can reach it; on an OS-pinned tablet that
 * link was the one control that defeated the pinning. A crèche with a single
 * owner will most plausibly have left the owner's own session on the device.
 *
 * Two secrets are accepted, checked on the server:
 *   - the PIN of an owner/admin membership of this tenant, compared in
 *     kg_kiosk_exit_unlock (rate-limited per session, five failures in ten
 *     minutes); a digits-only entry is always tried as a PIN;
 *   - otherwise the password of the account the kiosk is signed in with,
 *     re-verified through Supabase Auth (which enforces its own rate limit).
 *
 * On success the session is signed out and the browser lands on /login. The
 * secret never unlocks the dashboard under the kiosk's session: whoever
 * wants the office signs in as themselves.
 */
export async function exitKiosk(input: z.infer<typeof exitSchema>): Promise<KioskExitResult> {
  const parsed = exitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const secret = parsed.data.secret.trim();

  const ctx = await requireStaff();
  const supabase = await createClient();

  let unlocked = false;
  if (/^\d{4,8}$/.test(secret)) {
    const { data, error } = await supabase.rpc("kg_kiosk_exit_unlock", {
      p_tenant: ctx.tenant.id,
      p_pin: secret,
    });
    if (error) return { ok: false, error: "wrong" };
    if (data === "locked") return { ok: false, error: "locked" };
    if (data === "no_pin") return { ok: false, error: "noPin" };
    unlocked = data === "ok";
  } else if (ctx.user.email) {
    // Re-authenticating mints a fresh session for the same account, which the
    // sign-out below discards along with the kiosk's own.
    const { error } = await supabase.auth.signInWithPassword({
      email: ctx.user.email,
      password: secret,
    });
    unlocked = !error;
  }
  if (!unlocked) return { ok: false, error: "wrong" };

  await supabase.auth.signOut();
  redirect("/login");
}
