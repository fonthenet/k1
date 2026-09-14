import Link from "next/link";
import { ArrowLeft, IdCard } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PrintButton } from "@/components/modules/dashboard/print-button";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, signedMediaUrl } from "@/lib/tenant";
import { childDisplayName, initials, initialsFromName } from "@/lib/format";
import { memberName } from "@/lib/member-names";
import { cn } from "@/lib/utils";
import type { KgRole } from "@/lib/types";
import { BadgeFace, type BadgeFaceData } from "@/components/modules/children/badge-face";
import { printScopeOf } from "@/components/modules/settings/print-badges-scope";

/** Two columns of four CR80 cards fill an A4 sheet inside 12 mm margins. */
const PER_SHEET = 8;
const BADGES_PATH = "/settings/badges";

/**
 * Print rules, the print-sheets idiom: the page's chrome is hidden through
 * visibility, the sheets become plain paper, and every sheet but the last
 * breaks the page. Colour is forced on — the band and the avatar tints are
 * background graphics a printer strips by default, and a badge without its
 * class colour has lost the one thing that sorts a stack.
 */
const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  body * { visibility: hidden !important; }
  #print-area, #print-area * { visibility: visible !important; }
  #print-area {
    position: absolute; top: 0; left: 0; right: 0;
    margin: 0 !important; padding: 0 !important; max-width: none !important;
  }
  #print-area [data-sheet] {
    margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important;
    border: none !important; border-radius: 0 !important; box-shadow: none !important;
    break-after: page;
  }
  #print-area [data-sheet]:last-child { break-after: auto; }
  #print-area, #print-area * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

type ChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  photo_path: string | null;
  tag_code: string;
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
  staff_code: string;
};

type ProfileRow = { id: string; full_name: string | null; avatar_url: string | null };

/**
 * The other script for a two-script name: Latin under Arabic, Arabic under
 * Latin. Null when there is no second script — and when the "other" string
 * is the very same name, which happens when an Arabic name was typed into
 * the Latin fields too; a badge must not say the name twice.
 */
function otherScriptName(
  p: { first_name: string; last_name: string; first_name_ar: string | null; last_name_ar: string | null },
  locale: string
): string | null {
  if (!p.first_name_ar || !p.last_name_ar) return null;
  const latin = `${p.first_name} ${p.last_name}`.trim();
  const arabic = `${p.first_name_ar} ${p.last_name_ar}`.trim();
  if (latin === arabic) return null;
  return locale === "ar" ? latin : arabic;
}

/** One uuid from the query string, or nothing: a repeated or malformed value narrows nothing. */
function idParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/**
 * The badges sheet: every person of one kind who holds a printed code, eight
 * CR80 cards to an A4 page, cut along the hairlines. Admin only — the same
 * rule as the single guardian and staff badges, because a door credential
 * is the office's business.
 *
 * The children's sheet can be narrowed to a structure or a class so a stack
 * comes out already sorted for one desk; the cards are ordered by class and
 * then by surname for the same reason. Parents and the team print whole.
 * Whoever has no code yet is simply absent — a badge without a QR would be
 * a badge the door cannot read.
 */
export default async function PrintBadgesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[]; structure?: string | string[]; class?: string | string[] }>;
}) {
  const [sp, ctx, locale] = await Promise.all([searchParams, requireAdmin(), getLocale()]);
  const scope = printScopeOf(sp.scope);
  const [t, tc, tStaff] = await Promise.all([
    getTranslations("settings.badges"),
    getTranslations("common"),
    getTranslations("staff"),
  ]);
  const supabase = await createClient();
  const tid = ctx.tenant.id;
  const collator = new Intl.Collator(locale);
  const establishment = ctx.tenant.name;

  let faces: BadgeFaceData[] = [];

  if (scope === "children") {
    const structureId = idParam(sp.structure);
    const classId = idParam(sp.class);
    let query = supabase
      .from("kg_children")
      .select(
        "id, first_name, last_name, first_name_ar, last_name_ar, photo_path, tag_code, kg_classes(name, name_ar, color)"
      )
      .eq("tenant_id", tid)
      .eq("status", "enrolled")
      .not("tag_code", "is", null)
      .order("last_name")
      .order("first_name");
    if (structureId) query = query.eq("structure_id", structureId);
    if (classId) query = query.eq("class_id", classId);
    const { data } = await query;
    const children = ((data ?? []) as unknown as ChildRow[]).slice();
    const className = (c: ChildRow) =>
      c.kg_classes ? (locale === "ar" && c.kg_classes.name_ar ? c.kg_classes.name_ar : c.kg_classes.name) : null;
    // By class, then the database's surname order (the sort is stable). A
    // child not yet placed in a class prints last.
    children.sort((a, b) => {
      const ka = className(a);
      const kb = className(b);
      if (ka === kb) return 0;
      if (ka === null) return 1;
      if (kb === null) return -1;
      return collator.compare(ka, kb);
    });
    faces = await Promise.all(
      children.map(async (c) => ({
        name: childDisplayName(c, locale),
        altName: otherScriptName(c, locale),
        initials: initials(c.first_name, c.last_name),
        photoUrl: await signedMediaUrl(c.photo_path),
        code: c.tag_code,
        establishment,
        klass: c.kg_classes ? { name: className(c)!, color: c.kg_classes.color } : null,
        line: null,
      }))
    );
  } else if (scope === "guardians") {
    // The adults of the enrolled children, one card each however many
    // siblings they collect; the children's first names are the muted line
    // the door staff read before handing a child over.
    const { data: childRows } = await supabase
      .from("kg_children")
      .select("id, first_name, first_name_ar")
      .eq("tenant_id", tid)
      .eq("status", "enrolled");
    const children = (childRows ?? []) as { id: string; first_name: string; first_name_ar: string | null }[];
    const firstNameById = new Map(
      children.map((c) => [c.id, locale === "ar" && c.first_name_ar ? c.first_name_ar : c.first_name])
    );
    const { data: linkRows } = children.length
      ? await supabase
          .from("kg_child_guardians")
          .select(
            "child_id, guardian_id, kg_guardians!inner(id, first_name, last_name, first_name_ar, last_name_ar, photo_path, tag_code, tenant_id)"
          )
          .eq("kg_guardians.tenant_id", tid)
          .in("child_id", children.map((c) => c.id))
      : { data: [] as unknown[] };
    const guardians = new Map<string, GuardianLinkRow["kg_guardians"] & { childIds: string[] }>();
    for (const link of (linkRows ?? []) as unknown as GuardianLinkRow[]) {
      if (!link.kg_guardians?.tag_code) continue;
      const g = guardians.get(link.guardian_id) ?? { ...link.kg_guardians, childIds: [] };
      g.childIds.push(link.child_id);
      guardians.set(link.guardian_id, g);
    }
    const sorted = [...guardians.values()].sort((a, b) =>
      collator.compare(childDisplayName(a, locale), childDisplayName(b, locale))
    );
    faces = await Promise.all(
      sorted.map(async (g) => ({
        name: childDisplayName(g, locale),
        altName: otherScriptName(g, locale),
        initials: initials(g.first_name, g.last_name),
        photoUrl: await signedMediaUrl(g.photo_path),
        code: g.tag_code!,
        establishment,
        klass: null,
        line:
          g.childIds
            .map((id) => firstNameById.get(id))
            .filter((n): n is string => !!n)
            .sort(collator.compare)
            .join(" · ") || null,
      }))
    );
  } else {
    const { data: memberRows } = await supabase
      .from("kg_memberships")
      .select("id, user_id, full_name, role, job_title, staff_code")
      .eq("tenant_id", tid)
      .eq("status", "active")
      .neq("role", "parent")
      .not("staff_code", "is", null);
    const members = (memberRows ?? []) as MemberRow[];
    const userIds = members.map((m) => m.user_id).filter((id): id is string => !!id);
    const { data: profileRows } = userIds.length
      ? await supabase.from("kg_profiles").select("id, full_name, avatar_url").in("id", userIds)
      : { data: [] as ProfileRow[] };
    const profileById = new Map(((profileRows ?? []) as ProfileRow[]).map((p) => [p.id, p]));
    faces = members
      .map((m) => {
        const profile = m.user_id ? profileById.get(m.user_id) : undefined;
        const name = memberName(m, profile?.full_name) ?? m.job_title ?? "—";
        return {
          name,
          altName: null,
          initials: initialsFromName(name),
          photoUrl: profile?.avatar_url ?? null,
          code: m.staff_code,
          establishment,
          klass: null,
          line: m.job_title || tStaff(`roles.${m.role}`),
        };
      })
      .sort((a, b) => collator.compare(a.name, b.name));
  }

  const sheets: BadgeFaceData[][] = [];
  for (let i = 0; i < faces.length; i += PER_SHEET) sheets.push(faces.slice(i, i + PER_SHEET));

  if (faces.length === 0) {
    return (
      <div>
        <PageHeader title={t("print.title")} />
        <EmptyState
          icon={<IdCard />}
          title={t("print.empty")}
          description={t("print.emptyHint")}
          action={
            <Button asChild variant="outline">
              <Link href={BADGES_PATH}>{t("title")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const arabic = locale === "ar";

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>

      {/* Screen-only toolbar: back to the register, how much paper this is, print. */}
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={BADGES_PATH}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("title")}
        </Link>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("print.count", { count: faces.length })}
          {" · "}
          {t("print.sheets", { count: sheets.length })}
        </span>
        <PrintButton label={tc("actions.print")} />
      </div>

      <div id="print-area" dir={arabic ? "rtl" : "ltr"} lang={locale} className="space-y-6">
        {sheets.map((cards, i) => (
          <section
            key={i}
            data-sheet
            className={cn(
              "mx-auto grid w-[210mm] min-h-[297mm] grid-cols-2 content-start justify-center gap-x-[8mm] gap-y-[6mm] rounded-xl border border-border bg-white p-[12mm] text-black shadow-sm",
              arabic && "font-[family-name:var(--font-cairo)]"
            )}
          >
            {cards.map((face, j) => (
              <BadgeFace key={j} data={face} variant="compact" className="justify-self-center" />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
