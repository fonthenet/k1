import "server-only";

import { createClient } from "@/lib/supabase/server";
import { signedMediaUrl, type TenantContext } from "@/lib/tenant";
import { childDisplayName, initials, initialsFromName } from "@/lib/format";
import { memberName } from "@/lib/member-names";
import type { KgRole } from "@/lib/types";
import type { CredentialSubject } from "@/components/modules/credentials/types";

/**
 * The badges register, composed on the server.
 *
 * Every person the door can open for — enrolled children, the adults linked
 * to them, the active team — with the proximity cards each one holds and
 * whether a PIN is set. Six reads: children with their class, the guardian
 * links with the guardian rows embedded, the team, the team's profiles, every
 * live card of the establishment, and the holders of a live PIN. The joins
 * happen here so the client receives flat rows and never learns a table name.
 *
 * The whole building, always. The rail's switcher narrows registers the
 * office reads through a structure, but a card opens the front door of the
 * building, not of a structure, and a director handing out cards must see the
 * family she is talking to whichever tab she left open. The page offers its
 * own structure filter instead.
 */

export interface BadgeCard {
  id: string;
  /** The reader's number, normalised by the database (upper, trimmed). */
  value: string;
  label: string | null;
  lastUsedAt: string | null;
}

export interface BadgePerson {
  /** `${subjectType}:${id}` — the one key a row and a selection share. */
  key: string;
  subjectType: CredentialSubject;
  id: string;
  /** In the reader's script. */
  name: string;
  /** The other script, muted under the name; null when there is none. */
  altName: string | null;
  initials: string;
  photoUrl: string | null;
  /** The value printed on the badge: kg_children.tag_code or kg_memberships.staff_code. */
  code: string | null;
  /** The record page; a guardian has none of their own and opens their first child's. */
  href: string | null;
  /** A child's structure, a guardian's children's structures, nothing for the team. */
  structureIds: string[];
  /** A child's class; null for a child not yet placed and for every adult. */
  classId: string | null;
  klass: { name: string; color: string } | null;
  /**
   * The household: a child, their siblings and the adults linked to any of
   * them share one id — two children with one parent in common are one
   * family, whatever their surnames. Null for the team.
   */
  familyId: string | null;
  /** The family's surname(s) in the reader's script — "Amrani", or "Amrani · Benali" when the children's differ. */
  familyName: string | null;
  /** A guardian's children, for the chips after the name. */
  children: { id: string; name: string }[];
  role: KgRole | null;
  cards: BadgeCard[];
  /**
   * Whether a PIN is live for this person — never the PIN itself. The
   * register only ever learns that one exists: the code is shown once, when
   * it is handed over, and a screen glanced at over a shoulder must not be a
   * second showing. Children hold no PIN, so theirs is always false.
   */
  hasPin: boolean;
  /** The most recent pass over any of this person's cards. */
  lastUsedAt: string | null;
  /**
   * A child whose family holds no card at all — not the child, not one of
   * the adults. The one place the page asks the director to look, and only
   * once the establishment has started using cards.
   */
  familyWithoutCard: boolean;
}

export interface BadgeStats {
  children: { withCard: number; total: number };
  /** The adults also count their PINs: a parent without a smartphone or a card still gets in with one. */
  guardians: { withCard: number; total: number; withPin: number };
  staff: { withCard: number; total: number };
  /** Live cards passed over the reader in the last seven days. */
  usedThisWeek: number;
}

export interface BadgesData {
  rows: BadgePerson[];
  stats: BadgeStats;
  /** True once at least one live card exists — before that nobody is "without". */
  usesCards: boolean;
  /**
   * When the register was read, in ms. The relative "last pass" labels are
   * computed from this on the server and again in the browser, and only one
   * clock keeps the two renders identical.
   */
  generatedAt: number;
}

type ChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  photo_path: string | null;
  tag_code: string | null;
  structure_id: string | null;
  class_id: string | null;
  kg_classes: { name: string; name_ar: string | null; color: string } | null;
};

type GuardianLinkRow = {
  child_id: string;
  guardian_id: string;
  kg_guardians: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    photo_path: string | null;
    tag_code: string | null;
  };
};

type MemberRow = {
  id: string;
  user_id: string | null;
  full_name: string | null;
  role: KgRole;
  job_title: string | null;
  staff_code: string | null;
};

type ProfileRow = { id: string; full_name: string | null; avatar_url: string | null };

type CredentialLite = {
  id: string;
  subject_type: CredentialSubject;
  subject_id: string;
  value: string;
  label: string | null;
  last_used_at: string | null;
};

/** A live PIN, reduced to whose it is. The value column is never in the select. */
type PinHolder = { subject_type: CredentialSubject; subject_id: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The other script for a two-script name: Latin under Arabic, Arabic under Latin. */
function otherScriptName(
  p: { first_name: string; last_name: string; first_name_ar: string | null; last_name_ar: string | null },
  locale: string
): string | null {
  if (locale === "ar") {
    return p.first_name_ar && p.last_name_ar ? `${p.first_name} ${p.last_name}` : null;
  }
  return p.first_name_ar && p.last_name_ar ? `${p.first_name_ar} ${p.last_name_ar}` : null;
}

function latestUse(cards: BadgeCard[]): string | null {
  let latest: string | null = null;
  for (const c of cards) if (c.lastUsedAt && (!latest || c.lastUsedAt > latest)) latest = c.lastUsedAt;
  return latest;
}

export async function loadBadgesData(ctx: TenantContext, locale: string): Promise<BadgesData> {
  const supabase = await createClient();
  const tid = ctx.tenant.id;

  const [{ data: childRows }, { data: memberRows }, { data: credentialRows }, { data: pinRows }] =
    await Promise.all([
      supabase
        .from("kg_children")
        .select(
          "id, first_name, last_name, first_name_ar, last_name_ar, photo_path, tag_code, structure_id, class_id, kg_classes(name, name_ar, color)"
        )
        .eq("tenant_id", tid)
        .eq("status", "enrolled")
        .order("last_name")
        .order("first_name"),
      supabase
        .from("kg_memberships")
        .select("id, user_id, full_name, role, job_title, staff_code")
        .eq("tenant_id", tid)
        .eq("status", "active")
        .neq("role", "parent")
        .order("created_at"),
      // Admin RLS: the page is behind requireAdmin, so this read is allowed.
      // Only live cards — a revoked one is history and has no bearing on who
      // can open the door today.
      supabase
        .from("kg_credentials")
        .select("id, subject_type, subject_id, value, label, last_used_at")
        .eq("tenant_id", tid)
        .eq("kind", "rfid")
        .eq("active", true)
        .order("issued_at"),
      // The PINs, as a bare list of holders. The same table, but a separate
      // read so the value column stays out of the select: the cards' numbers
      // are printed on the register, a PIN must never be.
      supabase
        .from("kg_credentials")
        .select("subject_type, subject_id")
        .eq("tenant_id", tid)
        .eq("kind", "pin")
        .eq("active", true),
    ]);

  const children = (childRows ?? []) as unknown as ChildRow[];
  const members = (memberRows ?? []) as MemberRow[];
  const credentials = (credentialRows ?? []) as CredentialLite[];
  const pinHolders = new Set(
    ((pinRows ?? []) as PinHolder[]).map((p) => `${p.subject_type}:${p.subject_id}`)
  );

  // The adults of the enrolled children only. A guardian whose every child
  // has left is still a row in kg_guardians, and the database would still
  // let a card be issued to them, but they are nobody's parent at the door
  // any more and would only pad the register.
  const childIds = children.map((c) => c.id);
  const userIds = members.map((m) => m.user_id).filter((id): id is string => !!id);
  const [{ data: linkRows }, { data: profileRows }] = await Promise.all([
    childIds.length
      ? supabase
          .from("kg_child_guardians")
          .select(
            "child_id, guardian_id, kg_guardians!inner(id, first_name, last_name, first_name_ar, last_name_ar, photo_path, tag_code, tenant_id)"
          )
          .eq("kg_guardians.tenant_id", tid)
          .in("child_id", childIds)
      : Promise.resolve({ data: [] as unknown[] }),
    userIds.length
      ? supabase.from("kg_profiles").select("id, full_name, avatar_url").in("id", userIds)
      : Promise.resolve({ data: [] as ProfileRow[] }),
  ]);
  const links = (linkRows ?? []) as unknown as GuardianLinkRow[];
  const profileById = new Map(((profileRows ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  // Cards by their holder, in issue order.
  const cardsBySubject = new Map<string, BadgeCard[]>();
  for (const c of credentials) {
    const key = `${c.subject_type}:${c.subject_id}`;
    const list = cardsBySubject.get(key) ?? [];
    list.push({ id: c.id, value: c.value, label: c.label, lastUsedAt: c.last_used_at });
    cardsBySubject.set(key, list);
  }
  const cardsOf = (subjectType: CredentialSubject, id: string) =>
    cardsBySubject.get(`${subjectType}:${id}`) ?? [];

  // One guardian may be linked to several children; collapse the links into
  // one row per adult carrying every child's name.
  const childById = new Map(children.map((c) => [c.id, c]));
  const guardians = new Map<string, GuardianLinkRow["kg_guardians"] & { childIds: string[] }>();
  const guardianIdsByChild = new Map<string, string[]>();
  for (const link of links) {
    if (!link.kg_guardians) continue;
    const g = guardians.get(link.guardian_id) ?? { ...link.kg_guardians, childIds: [] };
    g.childIds.push(link.child_id);
    guardians.set(link.guardian_id, g);
    const ids = guardianIdsByChild.get(link.child_id) ?? [];
    ids.push(link.guardian_id);
    guardianIdsByChild.set(link.child_id, ids);
  }

  const usesCards = credentials.length > 0;

  // Families: the connected components of the child–guardian links. A
  // guardian joins their children into one household; a child nobody is
  // linked to is a household of one. The family's name is its children's
  // surnames in the reader's script, distinct, in the roster's order.
  const familyRoot = new Map<string, string>();
  const find = (k: string): string => {
    let r = familyRoot.get(k) ?? k;
    while (r !== (familyRoot.get(r) ?? r)) r = familyRoot.get(r) ?? r;
    familyRoot.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) familyRoot.set(ra, rb);
  };
  for (const c of children) familyRoot.set(`child:${c.id}`, `child:${c.id}`);
  for (const g of guardians.values()) for (const cid of g.childIds) union(`guardian:${g.id}`, `child:${cid}`);
  const familyNames = new Map<string, string[]>();
  for (const c of children) {
    const root = find(`child:${c.id}`);
    const surname = locale === "ar" && c.last_name_ar ? c.last_name_ar : c.last_name;
    const names = familyNames.get(root) ?? [];
    if (!names.includes(surname)) names.push(surname);
    familyNames.set(root, names);
  }
  const familyOf = (key: string) => {
    const root = find(key);
    return { familyId: root, familyName: (familyNames.get(root) ?? []).join(" · ") || null };
  };

  const childPeople: BadgePerson[] = await Promise.all(
    children.map(async (c) => {
      const cards = cardsOf("child", c.id);
      const familyHasCard =
        cards.length > 0 ||
        (guardianIdsByChild.get(c.id) ?? []).some((gid) => cardsOf("guardian", gid).length > 0);
      return {
        key: `child:${c.id}`,
        subjectType: "child",
        id: c.id,
        name: childDisplayName(c, locale),
        altName: otherScriptName(c, locale),
        initials: initials(c.first_name, c.last_name),
        photoUrl: await signedMediaUrl(c.photo_path),
        code: c.tag_code,
        href: `/children/${c.id}`,
        structureIds: c.structure_id ? [c.structure_id] : [],
        classId: c.class_id,
        ...familyOf(`child:${c.id}`),
        klass: c.kg_classes
          ? {
              name: locale === "ar" && c.kg_classes.name_ar ? c.kg_classes.name_ar : c.kg_classes.name,
              color: c.kg_classes.color,
            }
          : null,
        children: [],
        role: null,
        cards,
        hasPin: false,
        lastUsedAt: latestUse(cards),
        familyWithoutCard: usesCards && !familyHasCard,
      };
    })
  );

  const guardianPeople: BadgePerson[] = await Promise.all(
    [...guardians.values()].map(async (g) => {
      const cards = cardsOf("guardian", g.id);
      const kids = g.childIds
        .map((id) => childById.get(id))
        .filter((c): c is ChildRow => !!c)
        .map((c) => ({ id: c.id, name: childDisplayName(c, locale) }));
      const structureIds = [
        ...new Set(
          g.childIds
            .map((id) => childById.get(id)?.structure_id)
            .filter((id): id is string => !!id)
        ),
      ];
      return {
        key: `guardian:${g.id}`,
        subjectType: "guardian",
        id: g.id,
        name: childDisplayName(g, locale),
        altName: otherScriptName(g, locale),
        initials: initials(g.first_name, g.last_name),
        photoUrl: await signedMediaUrl(g.photo_path),
        code: g.tag_code,
        href: kids[0] ? `/children/${kids[0].id}` : null,
        structureIds,
        classId: null,
        ...familyOf(`guardian:${g.id}`),
        klass: null,
        children: kids,
        role: null,
        cards,
        hasPin: pinHolders.has(`guardian:${g.id}`),
        lastUsedAt: latestUse(cards),
        familyWithoutCard: false,
      };
    })
  );

  const staffPeople: BadgePerson[] = members.map((m) => {
    const profile = m.user_id ? profileById.get(m.user_id) : undefined;
    const name = memberName(m, profile?.full_name) ?? m.job_title ?? "—";
    const cards = cardsOf("staff", m.id);
    return {
      key: `staff:${m.id}`,
      subjectType: "staff",
      id: m.id,
      name,
      altName: null,
      initials: initialsFromName(name),
      photoUrl: profile?.avatar_url ?? null,
      code: m.staff_code,
      href: `/staff/${m.id}`,
      structureIds: [],
      classId: null,
      familyId: null,
      familyName: null,
      klass: null,
      children: [],
      role: m.role,
      cards,
      hasPin: pinHolders.has(`staff:${m.id}`),
      lastUsedAt: latestUse(cards),
      familyWithoutCard: false,
    };
  });

  // Guardians and the team sort by the name the reader sees; the children
  // arrive ordered by the database on their Latin surname, which is the
  // order the roster uses too.
  const collator = new Intl.Collator(locale);
  guardianPeople.sort((a, b) => collator.compare(a.name, b.name));
  staffPeople.sort((a, b) => collator.compare(a.name, b.name));

  const withCard = (people: BadgePerson[]) => people.filter((p) => p.cards.length > 0).length;
  const generatedAt = Date.now();
  const weekAgo = generatedAt - WEEK_MS;
  const stats: BadgeStats = {
    children: { withCard: withCard(childPeople), total: childPeople.length },
    guardians: {
      withCard: withCard(guardianPeople),
      total: guardianPeople.length,
      withPin: guardianPeople.filter((p) => p.hasPin).length,
    },
    staff: { withCard: withCard(staffPeople), total: staffPeople.length },
    usedThisWeek: credentials.filter(
      (c) => c.last_used_at && new Date(c.last_used_at).getTime() >= weekAgo
    ).length,
  };

  return { rows: [...childPeople, ...guardianPeople, ...staffPeople], stats, usesCards, generatedAt };
}
