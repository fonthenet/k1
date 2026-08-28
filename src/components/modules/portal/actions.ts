"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, type TenantContext } from "@/lib/tenant";
import { flushPush } from "@/app/actions/push";
// One definition of the consent vocabulary for the whole app — see setConsent.
import { CONSENT_TYPES } from "@/components/modules/children/types";
import { serializeHealthList } from "./health-edit-shared";
// One phone rule for the whole portal — the forms mirror this exact regex.
import { PHONE_RE } from "./portal-types";
import { setLocale } from "@/app/actions/locale";

type ActionError = "generic" | "forbidden" | "invalid" | "duplicate";
type Result = { ok: true } | { ok: false; error: ActionError };
/** Same shape as `Result`, plus the id of the row that was just created. */
type ThreadResult = { ok: true; id: string } | { ok: false; error: ActionError };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------ incident acknowledgement

export async function ackIncident(incidentId: string): Promise<Result> {
  if (!z.uuid().safeParse(incidentId).success) return { ok: false, error: "invalid" };
  await getTenantContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_ack_incident", { p_incident: incidentId });
  if (error) {
    return { ok: false, error: error.message.includes("forbidden") ? "forbidden" : "generic" };
  }
  revalidatePath("/portal");
  return { ok: true };
}

// ------------------------------------------------------- absence reporting

const absenceSchema = z.object({
  childId: z.uuid(),
  date: z.string().regex(DATE_RE),
  reason: z.string().min(2).max(500),
});

/** Creates a message thread "Absence — {child} — {date}" with the reason as first message. */
export async function reportAbsence(input: z.infer<typeof absenceSchema>): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = absenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  // RLS only returns the child if the caller is its guardian (or staff).
  const { data: child } = await supabase
    .from("kg_children")
    .select("id, first_name, last_name")
    .eq("id", v.childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!child) return { ok: false, error: "forbidden" };

  const subject = `Absence — ${child.first_name} ${child.last_name} — ${v.date}`;
  const { data: thread, error: threadError } = await supabase
    .from("kg_threads")
    .insert({
      tenant_id: ctx.tenant.id,
      child_id: child.id,
      subject,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (threadError || !thread) return { ok: false, error: "generic" };

  const { error: messageError } = await supabase.from("kg_thread_messages").insert({
    thread_id: thread.id,
    tenant_id: ctx.tenant.id,
    sender_id: ctx.user.id,
    body: v.reason.trim(),
  });
  if (messageError) return { ok: false, error: "generic" };

  revalidatePath("/portal");
  // The absence thread is a real conversation — it must appear in the inbox.
  revalidatePath("/portal/messages");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

// ---------------------------------------------- activity enrollment request

const enrollmentSchema = z.object({
  childId: z.uuid(),
  activityId: z.uuid(),
});

/** Parents may insert 'requested' enrollment rows for their own children (RLS-enforced). */
export async function requestActivityEnrollment(input: z.infer<typeof enrollmentSchema>): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = enrollmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("kg_activity_enrollments").insert({
    tenant_id: ctx.tenant.id,
    activity_id: v.activityId,
    child_id: v.childId,
    status: "requested",
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "duplicate" };
    return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  }

  revalidatePath(`/portal/children/${v.childId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

/**
 * Withdraw an activity request the family has not been enrolled into yet.
 *
 * Safe by construction: policy `ae_del` only permits a parent to delete a row
 * for their own child while status = 'requested', so an approved enrollment
 * cannot be removed this way — the delete simply matches no rows. We check the
 * status here too so the parent gets a clear message instead of a silent no-op.
 */
export async function cancelActivityRequest(
  input: z.infer<typeof enrollmentSchema>
): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = enrollmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("kg_activity_enrollments")
    .delete()
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", v.childId)
    .eq("activity_id", v.activityId)
    .eq("status", "requested")
    .select("id");

  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  // Already approved (or already withdrawn) — the row is no longer the parent's to remove.
  if (!deleted || deleted.length === 0) return { ok: false, error: "forbidden" };

  revalidatePath(`/portal/children/${v.childId}`);
  return { ok: true };
}

// ------------------------------------------------------------- messaging
// The parent side of the same kg_threads / kg_thread_messages model the staff
// dashboard uses. RLS is what makes this safe: `tm_ins` requires
// kg_can_see_thread(thread_id) AND sender_id = auth.uid(), so a parent can only
// ever write into a conversation about their own child. Every action below
// re-checks tenant scope anyway, so a stray id from another tenant is rejected
// before it reaches the database.

const startConversationSchema = z.object({
  childId: z.uuid(),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(1).max(5000),
});

/** Opens a new conversation about one of my children, mirroring reportAbsence. */
export async function startConversation(
  input: z.infer<typeof startConversationSchema>
): Promise<ThreadResult> {
  const ctx = await getTenantContext();
  const parsed = startConversationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  // RLS only returns the child if the caller is its guardian (or staff).
  const { data: child } = await supabase
    .from("kg_children")
    .select("id")
    .eq("id", v.childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!child) return { ok: false, error: "forbidden" };

  const { data: thread, error: threadError } = await supabase
    .from("kg_threads")
    .insert({
      tenant_id: ctx.tenant.id,
      child_id: child.id,
      subject: v.subject,
      created_by: ctx.user.id,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (threadError || !thread) {
    return { ok: false, error: threadError?.code === "42501" ? "forbidden" : "generic" };
  }

  const { error: messageError } = await supabase.from("kg_thread_messages").insert({
    thread_id: thread.id,
    tenant_id: ctx.tenant.id,
    sender_id: ctx.user.id,
    body: v.body,
  });
  if (messageError) return { ok: false, error: "generic" };

  revalidatePath("/portal/messages");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true, id: thread.id as string };
}

const portalReplySchema = z.object({
  threadId: z.uuid(),
  body: z.string().trim().min(1).max(5000),
});

/** Posts a parent reply into an existing thread and bumps its activity time. */
export async function sendPortalMessage(
  input: z.infer<typeof portalReplySchema>
): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = portalReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  // Tenant scope + visibility check before writing: RLS returns nothing here
  // for a thread that belongs to another family.
  const { data: thread } = await supabase
    .from("kg_threads")
    .select("id")
    .eq("id", v.threadId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!thread) return { ok: false, error: "forbidden" };

  const { error } = await supabase.from("kg_thread_messages").insert({
    thread_id: v.threadId,
    tenant_id: ctx.tenant.id,
    sender_id: ctx.user.id,
    body: v.body,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };

  // Best effort: policy `th_upd` only allows staff or the thread's creator to
  // update a thread row, so this is a no-op (zero rows, no error) when a parent
  // replies to a staff-opened thread. The inbox therefore sorts on the newest
  // *message* timestamp rather than trusting this column alone.
  await supabase
    .from("kg_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", v.threadId)
    .eq("tenant_id", ctx.tenant.id);

  revalidatePath("/portal/messages");
  revalidatePath(`/portal/messages/${v.threadId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

// -------------------------------------------------- my own profile & contact
// The parent maintains their own identity rows. Two tables are involved and
// they are deliberately kept apart: `kg_guardians` is the kindergarten's
// contact file (the number an educator dials in an emergency), `kg_profiles`
// is the login account (display name, preferred language). Neither action
// ever accepts a row id from the client — scope always comes from auth.uid().

/** Trim first, then judge: a field the parent only tapped a space into is "empty". */
const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === "" || PHONE_RE.test(v));

/** Empty means "not provided"; anything else must look like an email address. */
const optionalEmail = z
  .string()
  .trim()
  .max(160)
  .refine((v) => v === "" || z.email().safeParse(v).success);

const guardianDetailsSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  firstNameAr: z.string().trim().max(80),
  lastNameAr: z.string().trim().max(80),
  phone: z.string().trim().regex(PHONE_RE),
  phoneAlt: optionalPhone,
  email: optionalEmail,
  address: z.string().trim().max(300),
  workplace: z.string().trim().max(160),
  nationalId: z.string().trim().max(40),
});

/** "" from an untouched optional input means NULL in the database, not an empty string. */
function orNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * The signed-in parent updates their own contact details — immediately, with
 * no approval queue (owner decision, 2026-08-27).
 *
 * Scope is `user_id = auth.uid()` AND the active tenant. No id is accepted
 * from the client, so this can only ever touch the caller's own rows — which
 * is precisely the set policy `g_upd` permits (`user_id = auth.uid()`).
 *
 * We update EVERY matching row on purpose. A parent who enrolled two children
 * normally has one `kg_guardians` row per registration, all sharing the same
 * `user_id`. Updating only one would leave a new phone number fresh on one
 * child's file and stale on the sibling's — the exact failure this page exists
 * to prevent, since staff call the number attached to the child in front of
 * them. `relationship` is never written here: the office owns it.
 */
export async function updateMyGuardianDetails(
  input: z.infer<typeof guardianDetailsSchema>
): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = guardianDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("kg_guardians")
    .update({
      first_name: v.firstName,
      last_name: v.lastName,
      first_name_ar: orNull(v.firstNameAr),
      last_name_ar: orNull(v.lastNameAr),
      phone: v.phone,
      phone_alt: orNull(v.phoneAlt),
      email: orNull(v.email),
      address: orNull(v.address),
      workplace: orNull(v.workplace),
      national_id: orNull(v.nationalId),
    })
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .select("id");

  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  // No row matched: this account has no guardian file in this kindergarten yet.
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  revalidatePath("/portal/profile");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

/* ------------------------------------------------------- my photo (door check)

   Staff compare this face with the adult standing at the door before handing a
   child over, so the parent maintains it themselves. Migration 0021 lets a
   guardian read+write exactly `t/{tenant}/guardians/{their own id}/…`.

   No guardian id is trusted from the client: we resolve the caller's own rows
   by `user_id = auth.uid()` and the uploaded path must sit under one of them.
   As with the details form, every row this account owns in the tenant gets the
   same photo — otherwise the sibling's file would still show nobody.
--------------------------------------------------------------------------- */

const GUARDIAN_PHOTO_RE =
  /^t\/([0-9a-f-]{36})\/guardians\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,120}$/;

/** Best-effort: an orphaned object is untidy, never a reason to fail the save. */
async function dropGuardianPhotos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: (string | null)[],
  keep: string | null
): Promise<void> {
  const stale = [...new Set(paths.filter((p): p is string => Boolean(p) && p !== keep))];
  if (stale.length === 0) return;
  try {
    await supabase.storage.from("kg-media").remove(stale);
  } catch {
    // the rows are already correct
  }
}

export async function updateMyGuardianPhoto(path: string): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = z.string().trim().max(400).safeParse(path);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const match = GUARDIAN_PHOTO_RE.exec(parsed.data);
  if (!match || match[1] !== ctx.tenant.id) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  const { data: mine } = await supabase
    .from("kg_guardians")
    .select("id, photo_path")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id);
  if (!mine || mine.length === 0) return { ok: false, error: "forbidden" };
  // The folder in the path must be one of MY guardian files, never a supplied id.
  if (!mine.some((g) => g.id === match[2])) return { ok: false, error: "forbidden" };

  const { data: updated, error } = await supabase
    .from("kg_guardians")
    .update({ photo_path: parsed.data })
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .select("id");
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  await dropGuardianPhotos(
    supabase,
    mine.map((g) => g.photo_path),
    parsed.data
  );
  revalidatePath("/portal/profile");
  return { ok: true };
}

export async function removeMyGuardianPhoto(): Promise<Result> {
  const ctx = await getTenantContext();
  const supabase = await createClient();

  const { data: mine } = await supabase
    .from("kg_guardians")
    .select("id, photo_path")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id);
  if (!mine || mine.length === 0) return { ok: false, error: "forbidden" };

  const { data: updated, error } = await supabase
    .from("kg_guardians")
    .update({ photo_path: null })
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .select("id");
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  await dropGuardianPhotos(
    supabase,
    mine.map((g) => g.photo_path),
    null
  );
  revalidatePath("/portal/profile");
  return { ok: true };
}

const portalAccountSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  phone: optionalPhone,
  locale: z.enum(["ar", "en", "fr"]),
});

/**
 * The account half: display name, account phone and preferred language.
 * `kg_profiles` is keyed by the auth user id and policy `pr_upd` restricts
 * writes to `id = auth.uid()`, so filtering on the context user is both the
 * scope and the whole authorisation story.
 */
export async function updateMyPortalAccount(
  input: z.infer<typeof portalAccountSchema>
): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = portalAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_profiles")
    .update({ full_name: v.fullName, phone: orNull(v.phone), locale: v.locale })
    .eq("id", ctx.user.id);
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };

  // Applies the language immediately (cookie + layout revalidation). The stored
  // `locale` is what the push dispatcher reads, so alerts follow this choice too.
  await setLocale(v.locale);
  revalidatePath("/portal/profile");
  return { ok: true };
}

// ------------------------------------------- pickup register & consents
// Two registers the family owns and the office reads. Both apply immediately
// (owner decision, 2026-08-27) — a grandmother added at 8pm can collect the
// child tomorrow morning. Migration 0016 already notifies staff and writes a
// kg_audit_log row on every parent-made pickup change, so nothing here has to
// re-implement that; these actions only have to be correctly scoped.

/**
 * Re-verifies that a child really belongs to the signed-in family.
 *
 * Two things are checked, and both matter:
 *
 * 1. The child is in the active tenant — that is the `tenant_id` these actions
 *    are about to stamp on a row, so it may not be taken on trust.
 * 2. The caller is a *guardian* of that child. RLS already gates
 *    `kg_authorized_pickups` and `kg_consents` on `kg_is_parent_of(child_id)`,
 *    but that predicate is also true for staff; the portal's own rule is
 *    narrower — these registers are edited here by the family, and from the
 *    dashboard by the office.
 *
 * Same guardian → link walk as `getMyChildren` in `data.ts`, kept to plain
 * filters so there is no embed resolution between a parent and their child's
 * safety data.
 */
async function isMyChild(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: TenantContext,
  childId: string
): Promise<boolean> {
  const { data: child } = await supabase
    .from("kg_children")
    .select("id")
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!child) return false;

  const { data: guardians } = await supabase
    .from("kg_guardians")
    .select("id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id);
  const guardianIds = (guardians ?? []).map((g) => g.id as string);
  if (guardianIds.length === 0) return false;

  const { data: link } = await supabase
    .from("kg_child_guardians")
    .select("child_id")
    .eq("child_id", childId)
    .in("guardian_id", guardianIds)
    .limit(1)
    .maybeSingle();
  return Boolean(link);
}

/** `pickupId: ""` creates; a uuid updates that row in place. */
const pickupSchema = z.object({
  childId: z.uuid(),
  pickupId: z.union([z.literal(""), z.uuid()]),
  name: z.string().trim().min(2).max(200),
  relationship: z.string().trim().max(120),
  phone: z.union([z.literal(""), z.string().trim().regex(PHONE_RE)]),
  nationalId: z.string().trim().max(40),
});

/**
 * Add or edit one authorised person on the child's pickup register.
 *
 * This list is the legal pickup-authorisation register under décret 19-253, so
 * an update is matched on `id` AND `child_id` AND `tenant_id`: an id from
 * another child's list can never be re-pointed at this one. A zero-row update
 * is reported as `forbidden` rather than silently succeeding, so the parent is
 * never told a name was saved when it was not.
 */
export async function savePickup(input: z.infer<typeof pickupSchema>): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = pickupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  if (!(await isMyChild(supabase, ctx, v.childId))) return { ok: false, error: "forbidden" };

  const fields = {
    name: v.name,
    relationship: orNull(v.relationship),
    phone: orNull(v.phone),
    national_id: orNull(v.nationalId),
  };

  if (v.pickupId) {
    const { data: updated, error } = await supabase
      .from("kg_authorized_pickups")
      .update(fields)
      .eq("id", v.pickupId)
      .eq("child_id", v.childId)
      .eq("tenant_id", ctx.tenant.id)
      .select("id");
    if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
    if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };
  } else {
    const { error } = await supabase.from("kg_authorized_pickups").insert({
      tenant_id: ctx.tenant.id,
      child_id: v.childId,
      ...fields,
    });
    if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  }

  revalidatePath(`/portal/children/${v.childId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const deletePickupSchema = z.object({ childId: z.uuid(), pickupId: z.uuid() });

/** Removes one authorised person. Scoped the same way `savePickup` updates. */
export async function deletePickup(input: z.infer<typeof deletePickupSchema>): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = deletePickupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  if (!(await isMyChild(supabase, ctx, v.childId))) return { ok: false, error: "forbidden" };

  const { data: deleted, error } = await supabase
    .from("kg_authorized_pickups")
    .delete()
    .eq("id", v.pickupId)
    .eq("child_id", v.childId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  // Already gone, or never this child's to begin with — say so instead of
  // reporting a removal that did not happen.
  if (!deleted || deleted.length === 0) return { ok: false, error: "forbidden" };

  revalidatePath(`/portal/children/${v.childId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

// The consent vocabulary is shared with the staff dashboard on purpose: both
// sides read and write the same `kg_consents.consent_type` strings, so it has
// exactly one definition (`children/types.ts`) and no chance to drift.
const consentSchema = z.object({
  childId: z.uuid(),
  consentType: z.enum(CONSENT_TYPES),
  granted: z.boolean().nullable(),
});

/**
 * Answers one consent — granted, refused, or back to not-yet-answered.
 *
 * `kg_consents` is unique on (child_id, consent_type), so an upsert is the
 * whole story: policies `con_ins` and `con_upd` both admit a parent, and no
 * delete policy exists for them — an unanswered consent stays in the register
 * as `granted = null` rather than vanishing from it. Clearing the answer
 * clears `decided_by` / `decided_at` too, so the register never claims someone
 * decided something they did not.
 */
export async function setConsent(input: z.infer<typeof consentSchema>): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  if (!(await isMyChild(supabase, ctx, v.childId))) return { ok: false, error: "forbidden" };

  const answered = v.granted !== null;
  const { error } = await supabase.from("kg_consents").upsert(
    {
      tenant_id: ctx.tenant.id,
      child_id: v.childId,
      consent_type: v.consentType,
      granted: v.granted,
      decided_by: answered ? ctx.user.id : null,
      decided_at: answered ? new Date().toISOString() : null,
    },
    { onConflict: "child_id,consent_type" }
  );
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };

  revalidatePath(`/portal/children/${v.childId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

// ------------------------------------------- health record & allergies (parent)
// Owner decision (2026-08-27): a family maintains its own child's safety data
// and the edit lands IMMEDIATELY — a newly diagnosed allergy has to protect the
// child tonight, not after an approval queue clears. Migration 0016 is what
// makes that safe: every write below fires a DB trigger that notifies staff and
// writes a kg_audit_log row, so nothing here has to do it in application code.
//
// kg_children is untouched on purpose: name and date of birth come from the
// birth certificate and feed the décret 19-253 registers, so no action here
// ever offers a field that writes to it.

/** Trimmed free text that stores as NULL when the parent leaves it empty. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/**
 * One line of a jsonb list column. `source` carries the original JSON of an
 * entry that was an object rather than a string; `serializeHealthList` writes
 * it back untouched when the label still matches, so a parent saving the form
 * cannot flatten a richer seeded entry they never edited.
 */
const healthListItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  source: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 2000)
    .nullable()
    .default(null),
});

const childHealthSchema = z.object({
  childId: z.uuid(),
  medicalConditions: z.array(healthListItemSchema).max(50),
  medications: z.array(healthListItemSchema).max(50),
  vaccinations: z.array(healthListItemSchema).max(50),
  dietaryRestrictions: optionalText(500),
  specialNeeds: optionalText(500),
  doctorName: optionalText(120),
  doctorPhone: optionalText(40),
  emergencyNotes: optionalText(2000),
});

/** Creates or replaces the child's single kg_child_health row (PK = child_id). */
export async function upsertChildHealth(
  input: z.input<typeof childHealthSchema>
): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = childHealthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  // Same guard as reportAbsence: RLS only returns the child to its guardian.
  const { data: child } = await supabase
    .from("kg_children")
    .select("id")
    .eq("id", v.childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!child) return { ok: false, error: "forbidden" };

  // The row may not exist yet — the health file is optional at enrollment.
  const { error } = await supabase.from("kg_child_health").upsert(
    {
      child_id: child.id,
      medical_conditions: serializeHealthList(v.medicalConditions),
      medications: serializeHealthList(v.medications),
      vaccinations: serializeHealthList(v.vaccinations),
      dietary_restrictions: v.dietaryRestrictions,
      special_needs: v.specialNeeds,
      doctor_name: v.doctorName,
      doctor_phone: v.doctorPhone,
      emergency_notes: v.emergencyNotes,
      // The default only applies on insert; an update must move it itself.
      updated_at: new Date().toISOString(),
    },
    { onConflict: "child_id" }
  );
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };

  revalidatePath(`/portal/children/${v.childId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const allergySchema = z.object({
  childId: z.uuid(),
  /** null → create, uuid → update. */
  allergyId: z.uuid().nullable().default(null),
  allergen: z.string().trim().min(1).max(200),
  severity: z.enum(["mild", "moderate", "severe"]),
  reaction: optionalText(300),
  actionPlan: optionalText(2000),
});

/** Adds a new allergy or rewrites one of this child's existing ones. */
export async function saveAllergy(input: z.input<typeof allergySchema>): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = allergySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  // Same guard as reportAbsence: RLS only returns the child to its guardian.
  const { data: child } = await supabase
    .from("kg_children")
    .select("id")
    .eq("id", v.childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!child) return { ok: false, error: "forbidden" };

  const fields = {
    allergen: v.allergen,
    severity: v.severity,
    reaction: v.reaction,
    action_plan: v.actionPlan,
  };

  if (v.allergyId) {
    const { data: updated, error } = await supabase
      .from("kg_child_allergies")
      .update(fields)
      .eq("id", v.allergyId)
      .eq("child_id", child.id)
      .eq("tenant_id", ctx.tenant.id)
      .select("id");
    if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
    // The row belongs to another child (or is already gone) — not ours to edit.
    if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };
  } else {
    const { error } = await supabase.from("kg_child_allergies").insert({
      tenant_id: ctx.tenant.id,
      child_id: child.id,
      ...fields,
    });
    // 23505 is kg_child_allergies_unique (0061): this allergen is already on
    // the child's list. It is a normal thing for a parent to do, not a fault.
    if (error) {
      if (error.code === "23505") return { ok: false, error: "duplicate" };
      return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
    }
  }

  revalidatePath(`/portal/children/${v.childId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const deleteAllergySchema = z.object({ childId: z.uuid(), allergyId: z.uuid() });

/** Removes one allergy. The UI confirms first — this is a safety-relevant act. */
export async function deleteAllergy(
  input: z.infer<typeof deleteAllergySchema>
): Promise<Result> {
  const ctx = await getTenantContext();
  const parsed = deleteAllergySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  // Same guard as reportAbsence: RLS only returns the child to its guardian.
  const { data: child } = await supabase
    .from("kg_children")
    .select("id")
    .eq("id", v.childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!child) return { ok: false, error: "forbidden" };

  const { data: deleted, error } = await supabase
    .from("kg_child_allergies")
    .delete()
    .eq("id", v.allergyId)
    .eq("child_id", child.id)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  // Nothing matched: another family's row, or already removed elsewhere.
  if (!deleted || deleted.length === 0) return { ok: false, error: "forbidden" };

  revalidatePath(`/portal/children/${v.childId}`);
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

// ------------------------------------------- enrolling another child (sibling)
// Owner decision (2026-08-27): a family that is already with the kindergarten
// does NOT get a second admissions path. A sibling becomes an ordinary
// kg_applications row, so it lands in the same /applications pipeline staff
// already work — same stages, same waitlist, same approval RPC, same "new
// application" notification. Nothing here writes to kg_children: the office
// creates the child record when it approves, exactly as for a walk-in family.
//
// The whole write is `kg_submit_sibling_application` (migration 0017). It
// authorises on membership rather than an enrolment-link token, and builds the
// guardian payload from the caller's OWN kg_guardians row, so the sibling links
// back to the same family instead of to re-typed contact details.

/** `no_guardian_record` deserves its own message: it is fixable, but not by the parent. */
type SiblingError = ActionError | "noGuardianRecord";
type SiblingResult = { ok: true } | { ok: false; error: SiblingError };

const siblingAllergySchema = z.object({
  allergen: z.string().trim().min(1).max(200),
  severity: z.enum(["mild", "moderate", "severe"]),
  reaction: z.string().trim().max(300),
  actionPlan: z.string().trim().max(2000),
});

const siblingSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  firstNameAr: z.string().trim().max(80),
  lastNameAr: z.string().trim().max(80),
  dob: z.string().regex(DATE_RE),
  gender: z.enum(["male", "female"]),
  /** "A+" … "O-" or "" — the form offers a closed list, this is the width guard. */
  bloodType: z.string().trim().max(3),
  photoPath: z.string().trim().max(300),
  allergies: z.array(siblingAllergySchema).max(20),
  dietaryRestrictions: z.string().trim().max(500),
  doctorName: z.string().trim().max(120),
  doctorPhone: z.string().trim().max(40),
});

/**
 * Today in Africa/Algiers (UTC+1).
 *
 * `data.ts` has the same helper, but that module is `server-only` and this one
 * is imported by client components for its action references — so the four
 * lines are repeated rather than pulling a server-only module into that graph.
 * A UTC date would be wrong for the first hour of every Algerian day: a parent
 * entering a birthday at 00:30 would see it refused as "in the future".
 */
function algiersDateToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * The signed-in parent applies for another child.
 *
 * Authorisation lives in the RPC (membership of the tenant + an existing
 * guardian row), which is the only place that can enforce it: this action
 * cannot be trusted to have checked, so it does not pretend to. What it owns
 * is shaping the two jsonb payloads exactly as kg_approve_application will
 * later read them, and turning the RPC's two named exceptions into messages a
 * parent can act on.
 */
export async function submitSiblingApplication(
  input: z.infer<typeof siblingSchema>
): Promise<SiblingResult> {
  const ctx = await getTenantContext();
  const parsed = siblingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  // The picker caps its calendar at today; re-checked here because a birth date
  // in the future would travel straight into the child's official file.
  if (v.dob > algiersDateToday()) return { ok: false, error: "invalid" };

  // The photo went from the browser into the caller's own storage prefix. Any
  // other path is refused rather than stored as a pointer to a file this
  // family does not own.
  if (v.photoPath && !v.photoPath.startsWith(`u/${ctx.user.id}/`)) {
    return { ok: false, error: "invalid" };
  }

  // Key-for-key what kg_approve_application reads out of `child` / `health`.
  const child = {
    first_name: v.firstName,
    last_name: v.lastName,
    first_name_ar: orNull(v.firstNameAr),
    last_name_ar: orNull(v.lastNameAr),
    dob: v.dob,
    gender: v.gender,
    blood_type: orNull(v.bloodType),
    photo_path: orNull(v.photoPath),
    notes: null,
  };

  const health = {
    allergies: v.allergies.map((a) => ({
      allergen: a.allergen,
      severity: a.severity,
      reaction: orNull(a.reaction),
      action_plan: orNull(a.actionPlan),
    })),
    // The short wizard does not ask for these three, but approval copies them
    // into kg_child_health verbatim — send the empty lists it expects rather
    // than leaving the keys absent.
    medical_conditions: [],
    medications: [],
    vaccinations: [],
    dietary_restrictions: orNull(v.dietaryRestrictions),
    special_needs: null,
    doctor_name: orNull(v.doctorName),
    doctor_phone: orNull(v.doctorPhone),
    emergency_notes: null,
  };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_submit_sibling_application", {
    p_tenant: ctx.tenant.id,
    p_child: child,
    p_health: health,
    // Activities are chosen per child once enrolled, from the child's own page.
    p_activity_ids: [],
  });

  if (error) {
    if (error.message.includes("no_guardian_record")) {
      return { ok: false, error: "noGuardianRecord" };
    }
    if (error.message.includes("forbidden")) return { ok: false, error: "forbidden" };
    return { ok: false, error: "generic" };
  }

  // The new request has to show up in the parent's own list straight away.
  revalidatePath("/portal/children");
  revalidatePath("/portal");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

// ------------------------------------------------- my child's photo (parent)
// The one column of kg_children a family may write. `ch_upd` stays educator-only
// — name and date of birth come from the birth certificate — so migration 0023
// exposes exactly this single write through `kg_set_child_photo`, which checks
// the caller, pins the path to the child's own folder, and notifies the office
// itself. Nothing here writes a notification: the RPC already did.

/** `not_found` earns its own message: the file is gone, retrying will not help. */
type ChildPhotoError = ActionError | "notFound";
type ChildPhotoResult = { ok: true } | { ok: false; error: ChildPhotoError };

const childPhotoSchema = z.object({
  childId: z.uuid(),
  path: z.string().trim().min(1).max(400),
});

/** The RPC raises its complaints by name; each one needs different words. */
function mapChildPhotoError(message: string): ChildPhotoError {
  if (message.includes("invalid_path")) return "invalid";
  if (message.includes("not_found")) return "notFound";
  if (message.includes("forbidden")) return "forbidden";
  return "generic";
}

/** Best-effort: an orphaned object is untidy, never a reason to fail the save. */
async function dropChildPhoto(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previous: string | null | undefined,
  next: string | null,
  prefix: string
): Promise<void> {
  if (!previous || previous === next || !previous.startsWith(prefix)) return;
  try {
    await supabase.storage.from("kg-media").remove([previous]);
  } catch {
    // the row is already correct
  }
}

export async function setMyChildPhoto(input: z.input<typeof childPhotoSchema>): Promise<ChildPhotoResult> {
  const ctx = await getTenantContext();
  const parsed = childPhotoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, path } = parsed.data;

  // The RPC checks this too, but refusing here means a crafted path never
  // reaches the database — and this is the exact prefix storage lets us write.
  const prefix = `t/${ctx.tenant.id}/children/${childId}/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.endsWith("/")) {
    return { ok: false, error: "invalid" };
  }

  const supabase = await createClient();
  // Read the file we are about to supersede before the row forgets it.
  const { data: before } = await supabase
    .from("kg_children")
    .select("photo_path")
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { error } = await supabase.rpc("kg_set_child_photo", {
    p_child: childId,
    p_path: path,
  });
  if (error) return { ok: false, error: mapChildPhotoError(error.message) };

  await dropChildPhoto(supabase, before?.photo_path, path, prefix);

  revalidatePath(`/portal/children/${childId}`);
  revalidatePath("/portal/children");
  revalidatePath("/portal");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

/** Same RPC with a null path: clears the column and tells the office why. */
export async function removeMyChildPhoto(childId: string): Promise<ChildPhotoResult> {
  const ctx = await getTenantContext();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("kg_children")
    .select("photo_path")
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { error } = await supabase.rpc("kg_set_child_photo", {
    p_child: childId,
    p_path: null,
  });
  if (error) return { ok: false, error: mapChildPhotoError(error.message) };

  await dropChildPhoto(
    supabase,
    before?.photo_path,
    null,
    `t/${ctx.tenant.id}/children/${childId}/`
  );

  revalidatePath(`/portal/children/${childId}`);
  revalidatePath("/portal/children");
  revalidatePath("/portal");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}
