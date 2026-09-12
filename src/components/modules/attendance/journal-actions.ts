"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, type TenantContext } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { algiersToday } from "@/lib/algiers";
import { flushPush } from "@/app/actions/push";
import {
  EATEN_VALUES,
  JOURNAL_MOODS,
  journalPhotoPath,
  type EatenValue,
  type JournalMeal,
  type JournalNap,
  type JournalPhoto,
} from "@/lib/journal";
import type { AttendanceStatus } from "@/lib/types";
import type { ActionResult } from "./actions";
import { keepsJournal } from "./attendance-tabs";
import { isPresentish } from "./status-config";

/*
 * The Journal screen's writes to kg_daily_reports.
 *
 * Every write walks the same guard chain, in this order: the shape (zod), the
 * day (never a day that has not come), the caller (staff; an accountant reads
 * the journal and writes nothing — kg_is_educator is what the dr_all policy
 * asks, and the word "forbidden" is a better answer than a policy error), the
 * child (marked present or late, OR already holding a journal row, so a note
 * typed at ten survives a status corrected to "sick" at eleven), and the
 * class (a crèche, a préscolaire or a camp keeps a journal; an école does
 * not — spec §3.2).
 *
 * The write itself is insert-then-update, never one upsert: a bare row is
 * inserted `on conflict (child_id, date) do nothing` with `created_by` and
 * `published = false`, then the ONE field changes. An upsert would rewrite
 * `created_by` to the second educator who touched the row and, worse, could
 * flip `published` back to false on a journal the family already read.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** The two nap shapes journal.ts allows a screen to write. */
const napSchema = z.union([
  z.object({ start: timeStr, end: timeStr }).strict(),
  z.object({ slept: z.literal(false) }).strict(),
]);

/** One journal row as the guard reads it back. */
interface ReportRow {
  id: string;
  meals: unknown;
  nap: unknown;
  photos: unknown;
  published: boolean;
}

const REPORT_COLUMNS = "id, meals, nap, photos, published";

/** Nothing about a day that has not started; compared in Algiers like the register. */
const isFutureDate = (date: string) => date > algiersToday();

/** The roles kg_is_educator admits — the dr_all policy's own list. */
const WRITER_ROLES = new Set(["owner", "admin", "educator", "staff"]);

/** A Postgres error as the screen's vocabulary, else its message for the log. */
function dbError(e: { code?: string; message: string }): { ok: false; error: string } {
  if (e.code === "42501") return { ok: false, error: "forbidden" };
  if (e.code === "23514") return { ok: false, error: "invalid" };
  return { ok: false, error: e.message };
}

/** A structure's type, from the context's list — the tenant's when the class sets none. */
function centerTypeOf(ctx: TenantContext, structureId: string | null): string | null {
  const s = structureId ? ctx.structures.find((x) => x.id === structureId) : undefined;
  return s?.center_type ?? (ctx.tenant as { center_type?: string | null }).center_type ?? null;
}

/**
 * The guard chain after zod and the date: who is writing, about which child,
 * in which class. Returns the existing journal row (or null) so the write that
 * follows has the array it must patch without a second read.
 */
async function guardChild(
  supabase: Client,
  ctx: TenantContext,
  childId: string,
  date: string
): Promise<{ ok: true; existing: ReportRow | null } | { ok: false; error: string }> {
  if (!WRITER_ROLES.has(ctx.role)) return { ok: false, error: "forbidden" };

  const [childRes, attRes, reportRes] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id, class_id, structure_id, kg_classes(structure_id)")
      .eq("tenant_id", ctx.tenant.id)
      .eq("id", childId)
      .maybeSingle(),
    supabase
      .from("kg_attendance")
      .select("status")
      .eq("tenant_id", ctx.tenant.id)
      .eq("child_id", childId)
      .eq("date", date)
      .maybeSingle(),
    supabase
      .from("kg_daily_reports")
      .select(REPORT_COLUMNS)
      .eq("tenant_id", ctx.tenant.id)
      .eq("child_id", childId)
      .eq("date", date)
      .maybeSingle(),
  ]);
  const error = childRes.error ?? attRes.error ?? reportRes.error;
  if (error) return dbError(error);
  if (!childRes.data) return { ok: false, error: "forbidden" };

  const child = childRes.data as unknown as {
    class_id: string | null;
    structure_id: string | null;
    kg_classes: { structure_id: string | null } | null;
  };
  const existing = (reportRes.data as ReportRow | null) ?? null;
  const status = (attRes.data?.status ?? null) as AttendanceStatus | null;
  if (!isPresentish(status) && !existing) return { ok: false, error: "absent" };

  // The class decides, the child's own structure standing in for a child
  // with no class yet.
  const structureId = child.kg_classes?.structure_id ?? child.structure_id;
  if (!keepsJournal(centerTypeOf(ctx, structureId))) return { ok: false, error: "profile" };

  return { ok: true, existing };
}

/**
 * The bare row, if it does not exist yet. `ignoreDuplicates` is PostgREST's
 * `on conflict do nothing`, so a row already there keeps its author and its
 * publication.
 */
async function ensureRow(
  supabase: Client,
  ctx: TenantContext,
  childId: string,
  date: string
): Promise<ActionResult> {
  const { error } = await supabase
    .from("kg_daily_reports")
    .upsert(
      { tenant_id: ctx.tenant.id, child_id: childId, date, created_by: ctx.user.id, published: false },
      { onConflict: "child_id,date", ignoreDuplicates: true }
    );
  return error ? dbError(error) : { ok: true };
}

async function updateRow(
  supabase: Client,
  ctx: TenantContext,
  childId: string,
  date: string,
  patch: Record<string, unknown>
): Promise<ActionResult> {
  const { error } = await supabase
    .from("kg_daily_reports")
    .update(patch)
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", childId)
    .eq("date", date);
  return error ? dbError(error) : { ok: true };
}

/** The lunch line replaced (or removed) in a meals array, every other slot kept. */
function withLunch(meals: unknown, eaten: EatenValue | null): JournalMeal[] {
  const others = (Array.isArray(meals) ? meals : []).filter(
    (m): m is JournalMeal =>
      typeof m === "object" && m !== null && (m as { meal?: unknown }).meal !== "lunch"
  );
  return eaten ? [...others, { meal: "lunch", eaten }] : others;
}

const hasLunch = (meals: unknown) =>
  Array.isArray(meals) &&
  meals.some((m) => typeof m === "object" && m !== null && (m as { meal?: unknown }).meal === "lunch");

/** `end > start` on "HH:MM" strings — zero-padded, so text order is clock order. */
function napValue(nap: z.infer<typeof napSchema>): JournalNap | "invalid" {
  if ("slept" in nap) return { slept: false };
  return nap.end > nap.start ? { start: nap.start, end: nap.end } : "invalid";
}

/** Every screen that reads a journal: the staff Journal, the dashboard's
 *  line, the family's day page and home band. */
function revalidateJournal() {
  revalidatePath("/attendance/journal");
  revalidatePath("/dashboard");
  revalidatePath("/portal");
}

const fieldSchema = z.discriminatedUnion("field", [
  z.object({ childId: uuid, date: dateStr, field: z.literal("mood"), value: z.enum(JOURNAL_MOODS).nullable() }),
  z.object({ childId: uuid, date: dateStr, field: z.literal("meal"), value: z.enum(EATEN_VALUES).nullable() }),
  z.object({ childId: uuid, date: dateStr, field: z.literal("nap"), value: napSchema.nullable() }),
  z.object({ childId: uuid, date: dateStr, field: z.literal("notes"), value: z.string().trim().max(500).nullable() }),
]);

/** One cell of the Journal screen, saved on change. */
export async function setJournalField(input: {
  childId: string;
  date: string;
  field: "mood" | "meal" | "nap" | "notes";
  value: string | JournalNap | null;
}): Promise<ActionResult> {
  const parsed = fieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  const supabase = await createClient();
  const guard = await guardChild(supabase, ctx, childId, date);
  if (!guard.ok) return guard;

  let patch: Record<string, unknown>;
  switch (parsed.data.field) {
    case "mood":
      patch = { mood: parsed.data.value };
      break;
    case "meal":
      patch = { meals: withLunch(guard.existing?.meals, parsed.data.value) };
      break;
    case "nap": {
      const nap = parsed.data.value === null ? null : napValue(parsed.data.value);
      if (nap === "invalid") return { ok: false, error: "invalid" };
      patch = { nap };
      break;
    }
    case "notes":
      patch = { notes: parsed.data.value === "" ? null : parsed.data.value };
      break;
  }

  if (!guard.existing) {
    const created = await ensureRow(supabase, ctx, childId, date);
    if (!created.ok) return created;
  }
  const updated = await updateRow(supabase, ctx, childId, date, patch);
  if (!updated.ok) return updated;

  revalidateJournal();
  return { ok: true };
}

const bulkSchema = z.object({
  date: dateStr,
  childIds: z.array(uuid).min(1).max(300),
  patch: z.union([
    z.object({ meal: z.enum(EATEN_VALUES) }).strict(),
    z.object({ nap: napSchema }).strict(),
  ]),
});

/**
 * "Tout le monde a bien mangé": the same value stamped on every listed child
 * who has none yet. A row that already says "half" is never overwritten —
 * the button fills the blanks, it does not correct the room. Children the
 * guard chain would refuse one by one (away, an école class) are skipped
 * silently: the caller lists what its screen shows, and the count says how
 * many rows the stamp reached.
 */
export async function bulkJournal(input: {
  date: string;
  childIds: string[];
  patch: { meal: EatenValue } | { nap: JournalNap };
}): Promise<ActionResult> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { date, childIds, patch } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  if (!WRITER_ROLES.has(ctx.role)) return { ok: false, error: "forbidden" };
  const supabase = await createClient();

  const nap = "nap" in patch ? napValue(patch.nap) : null;
  if (nap === "invalid") return { ok: false, error: "invalid" };

  const [childrenRes, attRes, reportsRes] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id, structure_id, kg_classes(structure_id)")
      .eq("tenant_id", ctx.tenant.id)
      .in("id", childIds),
    supabase
      .from("kg_attendance")
      .select("child_id, status")
      .eq("tenant_id", ctx.tenant.id)
      .eq("date", date)
      .in("child_id", childIds),
    supabase
      .from("kg_daily_reports")
      .select(`child_id, ${REPORT_COLUMNS}`)
      .eq("tenant_id", ctx.tenant.id)
      .eq("date", date)
      .in("child_id", childIds),
  ]);
  const error = childrenRes.error ?? attRes.error ?? reportsRes.error;
  if (error) return dbError(error);

  const statusByChild = new Map(
    (attRes.data ?? []).map((a) => [a.child_id as string, a.status as AttendanceStatus])
  );
  const reportByChild = new Map(
    ((reportsRes.data ?? []) as unknown as (ReportRow & { child_id: string })[]).map((r) => [r.child_id, r])
  );

  // The same three questions guardChild asks, over the list at once.
  const targets: string[] = [];
  for (const raw of childrenRes.data ?? []) {
    const c = raw as unknown as {
      id: string;
      structure_id: string | null;
      kg_classes: { structure_id: string | null } | null;
    };
    const existing = reportByChild.get(c.id);
    if (!isPresentish(statusByChild.get(c.id)) && !existing) continue;
    if (!keepsJournal(centerTypeOf(ctx, c.kg_classes?.structure_id ?? c.structure_id))) continue;
    const filled = "meal" in patch ? hasLunch(existing?.meals) : existing?.nap != null;
    if (!filled) targets.push(c.id);
  }
  if (targets.length === 0) return { ok: true, count: 0 };

  const missing = targets.filter((id) => !reportByChild.has(id));
  if (missing.length > 0) {
    const { error: insError } = await supabase
      .from("kg_daily_reports")
      .upsert(
        missing.map((child_id) => ({
          tenant_id: ctx.tenant.id, child_id, date, created_by: ctx.user.id, published: false,
        })),
        { onConflict: "child_id,date", ignoreDuplicates: true }
      );
    if (insError) return dbError(insError);
  }

  // One update per row: the meals array differs per child (a breakfast line
  // may already be there), so a single statement cannot patch them all.
  const results = await Promise.all(
    targets.map((id) =>
      updateRow(
        supabase, ctx, id, date,
        "meal" in patch
          ? { meals: withLunch(reportByChild.get(id)?.meals, patch.meal) }
          : { nap }
      )
    )
  );
  const failed = results.find((r) => !r.ok);
  if (failed) return failed;

  revalidateJournal();
  return { ok: true, count: targets.length };
}

const publishSchema = z.object({ date: dateStr, childIds: z.array(uuid).min(1).max(300) });

/**
 * The journal goes to the families. `published = true` on the listed rows
 * that are still drafts; the 0012 trigger tells each family — at once, or
 * inside the evening send when that is still due (spec D4) — and the push
 * queue is flushed so the phone rings now rather than at the next sweep.
 */
export async function publishJournal(input: { date: string; childIds: string[] }): Promise<ActionResult> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { date, childIds } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  if (!WRITER_ROLES.has(ctx.role)) return { ok: false, error: "forbidden" };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("kg_daily_reports")
    .update({ published: true })
    .eq("tenant_id", ctx.tenant.id)
    .eq("date", date)
    .eq("published", false)
    .in("child_id", childIds)
    .select("id");
  if (error) return dbError(error);

  revalidateJournal();
  // Best effort, never part of this action's result.
  await flushPush();
  return { ok: true, count: data?.length ?? 0 };
}

/** Next's default body limit for a server action; the dialog resizes to fit under it. */
const MAX_PHOTO_BYTES = 1024 * 1024;

const photoFields = z.object({ childId: uuid, date: dateStr });

/**
 * One photo, one call. The dialog resizes each picture to 1280px client-side
 * and sends them one at a time, because a server action body is capped at
 * 1 MB. Consent is checked here again, not only on the screen: a photo of a
 * child whose family said no must never reach storage, whatever a stale tab
 * believed.
 */
export async function addJournalPhoto(formData: FormData): Promise<ActionResult & { path?: string }> {
  const parsed = photoFields.safeParse({ childId: formData.get("childId"), date: formData.get("date") });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_PHOTO_BYTES || !file.type.startsWith("image/")) {
    return { ok: false, error: "invalid" };
  }
  const { childId, date } = parsed.data;
  if (isFutureDate(date)) return { ok: false, error: "future" };

  const ctx = await requireStaff();
  const supabase = await createClient();
  const guard = await guardChild(supabase, ctx, childId, date);
  if (!guard.ok) return guard;

  const { data: consent, error: consentError } = await supabase
    .from("kg_consents")
    .select("granted")
    .eq("child_id", childId)
    .eq("consent_type", "photos")
    .maybeSingle();
  if (consentError) return dbError(consentError);
  if (consent?.granted !== true) return { ok: false, error: "consent" };

  const path = journalPhotoPath(ctx.tenant.id, childId, date, crypto.randomUUID());
  const { error: uploadError } = await supabase.storage
    .from("kg-media")
    .upload(path, file, { contentType: "image/jpeg", upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  if (!guard.existing) {
    const created = await ensureRow(supabase, ctx, childId, date);
    if (!created.ok) return created;
  }
  const photos = Array.isArray(guard.existing?.photos) ? (guard.existing.photos as JournalPhoto[]) : [];
  const updated = await updateRow(supabase, ctx, childId, date, {
    photos: [...photos, { path, at: new Date().toISOString() } satisfies JournalPhoto],
  });
  if (!updated.ok) return updated;

  revalidateJournal();
  return { ok: true, path };
}

const removePhotoSchema = z.object({ childId: uuid, date: dateStr, path: z.string().min(1).max(300) });

/** A photo taken out of the day: off the row first (what the family sees),
 *  then out of storage. */
export async function removeJournalPhoto(input: {
  childId: string;
  date: string;
  path: string;
}): Promise<ActionResult> {
  const parsed = removePhotoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, path } = parsed.data;

  const ctx = await requireStaff();
  // Only a path of this child's day: the row is the only thing that may name
  // what gets deleted, and a path from elsewhere in the bucket is refused
  // before any read.
  const prefix = journalPhotoPath(ctx.tenant.id, childId, date, "").replace(/\.jpg$/, "");
  if (!path.startsWith(prefix)) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const guard = await guardChild(supabase, ctx, childId, date);
  if (!guard.ok) return guard;
  if (!guard.existing) return { ok: false, error: "invalid" };

  const photos = Array.isArray(guard.existing.photos) ? (guard.existing.photos as JournalPhoto[]) : [];
  const updated = await updateRow(supabase, ctx, childId, date, {
    photos: photos.filter((p) => p.path !== path),
  });
  if (!updated.ok) return updated;

  // The file itself is the second step and its failure is not the user's: an
  // orphan in the bucket is invisible, a photo still on the row is not.
  await supabase.storage.from("kg-media").remove([path]);

  revalidateJournal();
  return { ok: true };
}
