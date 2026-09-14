"use server";

import { getLocale } from "next-intl/server";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { fetchThreadItems } from "../comms/queries";
import { fetchThreadSenderRoles } from "../comms/sender-roles";
import { getSupportMessages, getSupportSummary } from "../support/data";
import { childDisplayName } from "@/lib/format";
import type { InboxChild, InboxKind, InboxMessage, InboxThread } from "./types";

/**
 * The conversations list, loaded the first time the panel is opened.
 *
 * Family threads come from the same helper the /messages page uses, so a row
 * here and a row there are the same row — same subject, same preview, same
 * unread verdict. The support thread is appended last and drawn under a rule:
 * it belongs to a different relationship, and sorting Rawdatik in among the
 * parents by recency would put the vendor above a mother waiting on an answer.
 */
export async function loadInboxThreads(): Promise<InboxThread[]> {
  const ctx = await requireStaff();
  const locale = await getLocale();

  const [items, support] = await Promise.all([
    fetchThreadItems(ctx.tenant.id, ctx.user.id, locale),
    ctx.isAdmin ? getSupportSummary(ctx.tenant.id) : Promise.resolve(null),
  ]);

  const threads: InboxThread[] = items.map((th) => ({
    kind: "family",
    id: th.id,
    subject: th.subject,
    childName: th.childName,
    childId: th.childId,
    preview: th.preview,
    lastMessageAt: th.lastMessageAt,
    unreadCount: th.unreadCount,
  }));

  if (!support) return threads;

  // One row, so one query: the newest line, for the preview.
  const supabase = await createClient();
  const { data: lastRow } = await supabase
    .from("kg_support_messages")
    .select("body, created_at")
    .eq("thread_id", support.threadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ body: string; created_at: string }>();

  threads.push({
    kind: "support",
    id: support.threadId,
    subject: null,
    childName: null,
    childId: null,
    preview: lastRow ? lastRow.body.replace(/\s+/g, " ").trim() || null : null,
    lastMessageAt: lastRow?.created_at ?? null,
    unreadCount: support.unread,
  });

  return threads;
}

/** One conversation, oldest first — the order a conversation is read in. */
export async function loadInboxMessages(
  kind: InboxKind,
  threadId: string
): Promise<InboxMessage[]> {
  const ctx = await requireStaff();

  if (kind === "support") {
    // RLS would refuse an educator anyway; refusing here as well means the
    // answer does not change if the policy ever loosens.
    if (!ctx.isAdmin) return [];
    const rows = await getSupportMessages(threadId);
    return rows.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      mine: !m.fromPlatform,
      authorName: null,
      authorRole: null,
    }));
  }

  const supabase = await createClient();
  const { data: msgRows } = await supabase
    .from("kg_thread_messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", threadId)
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: true })
    .limit(500);

  const messages = (msgRows ?? []) as {
    id: string;
    sender_id: string;
    body: string;
    created_at: string;
  }[];
  if (messages.length === 0) return [];

  // Names for the label above each bubble. A family thread has staff on one
  // side and parents on the other, and both sides may be several people, so
  // "who said this" is not answerable from the alignment alone.
  const senderIds = [...new Set(messages.map((m) => m.sender_id).filter((id) => id !== ctx.user.id))];
  const [{ data: profileRows }, roleById] = await Promise.all([
    senderIds.length
      ? supabase.from("kg_profiles").select("id, full_name").in("id", senderIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    fetchThreadSenderRoles(supabase, threadId),
  ]);
  const nameById = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    mine: m.sender_id === ctx.user.id,
    authorName: m.sender_id === ctx.user.id ? null : (nameById.get(m.sender_id) ?? null),
    authorRole: m.sender_id === ctx.user.id ? null : (roleById.get(m.sender_id) ?? null),
  }));
}

/**
 * The children a new conversation can be about, for the panel's composer.
 *
 * The same rows the /messages dialog offers, plus two things a floating
 * panel needs that a page does not: the class, because a search box over
 * fifty names is where two Adams get told apart; and whether the family can
 * actually read what is about to be written. RLS narrows the rows to what the
 * reader may see.
 */
export async function loadInboxChildren(): Promise<InboxChild[]> {
  const ctx = await requireStaff();
  const locale = await getLocale();
  const supabase = await createClient();
  const { data } = await supabase
    .from("kg_children")
    .select(
      "id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar), " +
        "kg_child_guardians(kg_guardians(user_id, first_name, last_name, first_name_ar, last_name_ar))"
    )
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "enrolled")
    .order("first_name");

  const rows = (data ?? []) as unknown as {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { name: string; name_ar: string | null } | null;
    kg_child_guardians: {
      kg_guardians: {
        user_id: string | null;
        first_name: string;
        last_name: string;
        first_name_ar: string | null;
        last_name_ar: string | null;
      } | null;
    }[];
  }[];

  // Families that can be reached come first: the list exists to send a
  // message, and a name nobody will read belongs at the end, said as such.
  return rows
    .map((c) => {
      const reachedBy = c.kg_child_guardians
        .map((g) => g.kg_guardians)
        .filter((g) => g?.user_id)
        .map((g) => childDisplayName(g!, locale));
      return {
        id: c.id,
        name: childDisplayName(c, locale),
        className: c.kg_classes
          ? locale === "ar" && c.kg_classes.name_ar
            ? c.kg_classes.name_ar
            : c.kg_classes.name
          : null,
        reachedBy,
        reachable: reachedBy.length > 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.reachable) - Number(a.reachable) || a.name.localeCompare(b.name, locale)
    );
}
