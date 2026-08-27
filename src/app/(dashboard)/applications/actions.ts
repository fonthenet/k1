"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { byWaitlistOrder, type WaitlistOrdered } from "@/components/modules/enroll/types";

const approveSchema = z.object({
  appId: z.uuid(),
  classId: z.uuid().nullable(),
  // Upper-cased for the same reason as `tagCodeText` in
  // `components/modules/children/actions.ts`: the kiosk upper-cases every code
  // it scans, so a tag stored in lower case would never match at the door.
  tagCode: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : v)),
});

export async function approveApplication(input: {
  appId: string;
  classId: string | null;
  tagCode: string | null;
}): Promise<{ childId?: string; error?: string }> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { error: "forbidden" };

  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_approve_application", {
    p_app: parsed.data.appId,
    p_class: parsed.data.classId,
    p_tag_code: parsed.data.tagCode || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/applications");
  revalidatePath(`/applications/${parsed.data.appId}`);
  return { childId: data as string };
}

/** Every stage a staff member sets by hand. `approved` is deliberately absent:
 *  enrolment goes through kg_approve_application on the detail page. */
const statusSchema = z.object({
  appId: z.uuid(),
  status: z.enum(["submitted", "under_review", "interview", "offered", "rejected", "waitlist"]),
  reviewNote: z.string().trim().max(2000).optional(),
  /** ISO instant, built client-side from the interview date-time picker. */
  interviewAt: z.iso.datetime().nullish(),
});

export type StageInput = z.infer<typeof statusSchema>;

export async function updateApplicationStatus(input: {
  appId: string;
  status: StageInput["status"];
  reviewNote?: string;
  interviewAt?: string | null;
}): Promise<{ error?: string }> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { error: "forbidden" };

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { appId, status, reviewNote, interviewAt } = parsed.data;

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status };
  if (status === "rejected" || status === "waitlist") {
    patch.reviewed_by = ctx.user.id;
    patch.reviewed_at = new Date().toISOString();
  }
  if (reviewNote !== undefined) {
    patch.review_note = reviewNote || null;
  }

  const { error } = await supabase
    .from("kg_applications")
    .update(patch)
    .eq("id", appId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { error: error.message };

  // Pipeline metadata lands in a second write: the stage move itself must never
  // be held hostage by the interview slot or the waitlist rank.
  const extras: Record<string, unknown> = {};
  if (status === "interview" && interviewAt) extras.interview_at = interviewAt;
  extras.waitlist_position =
    status === "waitlist" ? await nextWaitlistPosition(ctx.tenant.id) : null;

  await supabase
    .from("kg_applications")
    .update(extras)
    .eq("id", appId)
    .eq("tenant_id", ctx.tenant.id);

  revalidatePath("/applications");
  revalidatePath(`/applications/${appId}`);
  return {};
}

async function nextWaitlistPosition(tenantId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("kg_applications")
    .select("waitlist_position")
    .eq("tenant_id", tenantId)
    .eq("status", "waitlist");
  const rows = (data ?? []) as { waitlist_position: number | null }[];
  return rows.reduce((max, r) => Math.max(max, r.waitlist_position ?? 0), 0) + 1;
}

const reorderSchema = z.object({
  appId: z.uuid(),
  direction: z.enum(["up", "down"]),
});

/** Move one family up or down the waitlist, renumbering the lane 1…n so the
 *  positions stay contiguous however the rows arrived. */
export async function reorderWaitlist(input: {
  appId: string;
  direction: "up" | "down";
}): Promise<{ error?: string }> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { error: "forbidden" };

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_applications")
    .select("id, waitlist_position, created_at")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "waitlist");
  if (error) return { error: error.message };

  const rows = (data ?? []) as (WaitlistOrdered & { id: string })[];
  const ordered = [...rows].sort(byWaitlistOrder);

  const from = ordered.findIndex((r) => r.id === parsed.data.appId);
  const to = parsed.data.direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ordered.length) return { error: "invalid" };

  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);

  const writes = ordered
    .map((row, i) => ({ row, position: i + 1 }))
    .filter(({ row, position }) => row.waitlist_position !== position)
    .map(({ row, position }) =>
      supabase
        .from("kg_applications")
        .update({ waitlist_position: position })
        .eq("id", row.id)
        .eq("tenant_id", ctx.tenant.id)
    );

  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidatePath("/applications");
  return {};
}
