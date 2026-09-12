import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone, Pin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ClassChip } from "@/components/shared/class-chip";
import { EmptyState } from "@/components/shared/empty-state";
import { StructureMark } from "@/components/shared/structure-mark";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { formatDate, formatTime } from "@/lib/format";
import type { Audience } from "@/lib/types";
import { getMyChildren, getStructures } from "@/components/modules/portal/data";
import { structureName } from "@/components/modules/classes/class-types";

/** `structure` joined the enum in 0138; `@/lib/types` has not caught up yet. */
type PortalAudience = Audience | "structure";

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  audience: PortalAudience;
  class_id: string | null;
  structure_id: string | null;
  pinned: boolean;
  publish_at: string;
};

type ClassRow = { id: string; name: string; name_ar: string | null; color: string };

export default async function PortalAnnouncementsPage() {
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const locale = await getLocale();
  const supabase = await createClient();

  const children = await getMyChildren(supabase, ctx);
  const myClassIds = new Set(children.map((c) => c.class_id).filter((id): id is string => !!id));

  const nowIso = new Date().toISOString();
  const [{ data: annRows }, { data: classRows }, structures] = await Promise.all([
    supabase
      .from("kg_announcements")
      .select("id, title, body, audience, class_id, structure_id, pinned, publish_at")
      .eq("tenant_id", ctx.tenant.id)
      .lte("publish_at", nowIso)
      .order("pinned", { ascending: false })
      .order("publish_at", { ascending: false })
      .limit(100),
    supabase
      .from("kg_classes")
      .select("id, name, name_ar, color")
      .eq("tenant_id", ctx.tenant.id),
    getStructures(supabase, ctx),
  ]);

  const classById = new Map(((classRows ?? []) as ClassRow[]).map((c) => [c.id, c]));
  const structureById = new Map(structures.map((s) => [s.id, s]));

  // Parents see everything addressed to all/parents, plus their own children's
  // classes. A `structure` notice passes on trust: RLS (0138) already hands a
  // family only the notices of a structure one of its children is on.
  const announcements = ((annRows ?? []) as AnnouncementRow[]).filter(
    (a) =>
      a.audience === "all" ||
      a.audience === "parents" ||
      a.audience === "structure" ||
      (a.audience === "class" && !!a.class_id && myClassIds.has(a.class_id))
  );

  // Pinned first, then the rest, each newest first — the query's own order.
  // The two group rows only exist once something is pinned: with nothing
  // pinned the list is simply the notices, and a lone "recent" heading over
  // the whole list would be a heading that says nothing.
  const pinnedRows = announcements.filter((a) => a.pinned);
  const recentRows = announcements.filter((a) => !a.pinned);
  const sections = (
    [
      { key: "pinned", rows: pinnedRows },
      { key: "recent", rows: recentRows },
    ] as const
  ).filter((section) => section.rows.length > 0);

  // The audience as the one mark on a row: the class chip or the structure
  // mark a family already knows the thing by, or a muted word for everyone.
  const audience = (a: AnnouncementRow) => {
    const cls = a.class_id ? classById.get(a.class_id) : undefined;
    const structure = a.structure_id ? structureById.get(a.structure_id) : undefined;
    if (a.audience === "class" && cls) {
      return <ClassChip name={locale === "ar" && cls.name_ar ? cls.name_ar : cls.name} color={cls.color} />;
    }
    if (a.audience === "structure" && structure) {
      return (
        <StructureMark
          structure={{ name: structureName(structure, locale), color: structure.color }}
          className="text-xs"
        />
      );
    }
    return (
      <span className="text-xs text-muted-foreground">
        {t(`announcements.audience.${a.audience}`)}
      </span>
    );
  };

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("announcements.title")}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t("announcements.description")}
        </p>
      </div>

      {announcements.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title={t("announcements.empty")}
          description={t("announcements.emptyDescription")}
        />
      ) : (
        // One card, one list: a notice is a row, and "pinned" is a group row
        // above the pinned ones — never a gold card with a solid tile.
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <ul className="divide-y divide-border">
              {sections.map(({ key, rows }) => (
                <Fragment key={key}>
                  {pinnedRows.length > 0 && (
                    <li className="bg-muted/30 px-5 py-1.5 text-xs">
                      <span className="flex items-center gap-2">
                        {key === "pinned" && (
                          <Pin className="size-3.5 text-muted-foreground" aria-hidden />
                        )}
                        <span className="font-semibold">{t(`announcements.${key}`)}</span>
                        <span className="text-muted-foreground tabular-nums">{rows.length}</span>
                      </span>
                    </li>
                  )}
                  {rows.map((a) => (
                    <li key={a.id} className="grid gap-1.5 px-5 py-4">
                      <div className="flex items-baseline gap-3">
                        <h3 className="min-w-0 flex-1 font-semibold leading-snug">
                          <bdi dir="auto" className="text-start">{a.title}</bdi>
                        </h3>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDate(a.publish_at, locale)} · {formatTime(a.publish_at, locale)}
                        </span>
                      </div>
                      <div className="flex items-center">{audience(a)}</div>
                      {a.body && (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                          <bdi dir="auto" className="text-start">{a.body}</bdi>
                        </p>
                      )}
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
