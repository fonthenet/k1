"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import { badgeSettings } from "@/lib/badge-settings";
import type { CredentialKind, CredentialSubject } from "./types";

/** What the badges reader learns about a card it was shown. */
export type CardLookup =
  | { ok: false; error: "forbidden" | "invalid" | "generic" }
  | {
      ok: true;
      found: false;
      /** The value as the database would store it: upper-cased and trimmed. */
      value: string;
      expectedLength: number | null;
    }
  | {
      ok: true;
      found: true;
      value: string;
      /**
       * The number length the establishment set (0165), null when none: the
       * reader test compares it with the read and warns when they differ.
       */
      expectedLength: number | null;
      kind: CredentialKind;
      subjectType: CredentialSubject;
      /** Latin name; null when the person's row has gone. */
      name: string | null;
      /** Arabic name when the person has one — children and guardians do. */
      nameAr: string | null;
      label: string | null;
      lastUsedAt: string | null;
    };

interface PersonNames {
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
}

/**
 * Tells the director whose card just touched the test reader — without
 * touching the card's history.
 *
 * The kiosk resolves through kg_resolve_credential, which stamps
 * last_used_at: that is a real passage at the door. A test at the settings
 * desk is not, so this reads kg_credentials directly (admin-only by RLS) with
 * the same normalisation the database applies on the way in, and looks the
 * owner up by hand in the three tables a subject can live in.
 */
export async function lookupCard(raw: string): Promise<CardLookup> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = z.string().trim().min(1).max(64).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  // kg_normalize_credential: upper(trim(value)).
  const value = parsed.data.toUpperCase();
  const expectedLength = badgeSettings(ctx.tenant.settings).codeLength;

  const supabase = await createClient();
  const { data: cred, error } = await supabase
    .from("kg_credentials")
    .select("subject_type, subject_id, kind, label, last_used_at")
    .eq("tenant_id", ctx.tenant.id)
    .in("kind", ["rfid", "qr"])
    .eq("value", value)
    .eq("active", true)
    .maybeSingle();
  if (error) return { ok: false, error: "generic" };
  if (!cred) return { ok: true, found: false, value, expectedLength };

  const subjectType = cred.subject_type as CredentialSubject;
  let name: string | null = null;
  let nameAr: string | null = null;

  if (subjectType === "staff") {
    const { data: member } = await supabase
      .from("kg_memberships")
      .select("id, user_id, full_name")
      .eq("id", cred.subject_id)
      .maybeSingle();
    if (member) {
      const profiles = await fetchProfileNames(supabase, [member.user_id]);
      name = memberNameIn(member, profiles);
    }
  } else {
    const { data: person } = await supabase
      .from(subjectType === "child" ? "kg_children" : "kg_guardians")
      .select("first_name, last_name, first_name_ar, last_name_ar")
      .eq("id", cred.subject_id)
      .maybeSingle();
    if (person) {
      const p = person as PersonNames;
      name = `${p.first_name} ${p.last_name}`.trim();
      nameAr = p.first_name_ar && p.last_name_ar ? `${p.first_name_ar} ${p.last_name_ar}` : null;
    }
  }

  return {
    ok: true,
    found: true,
    value,
    expectedLength,
    kind: cred.kind as CredentialKind,
    subjectType,
    name,
    nameAr,
    label: cred.label ?? null,
    lastUsedAt: cred.last_used_at ?? null,
  };
}
