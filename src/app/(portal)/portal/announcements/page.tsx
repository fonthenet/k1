import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone, Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
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
        <div className="grid gap-3">
          {announcements.map((a) => {
            const cls = a.class_id ? classById.get(a.class_id) : undefined;
            const structure = a.structure_id ? structureById.get(a.structure_id) : undefined;
            // The badge names the class or the structure it was written for,
            // in the reader's script, and borrows that thing's own colour —
            // the one signal a family already knows it by.
            const audienceLabel =
              a.audience === "class" && cls
                ? locale === "ar" && cls.name_ar
                  ? cls.name_ar
                  : cls.name
                : a.audience === "structure" && structure
                  ? structureName(structure, locale)
                  : t(`announcements.audience.${a.audience}`);
            const audienceColor =
              a.audience === "class" && cls
                ? cls.color
                : a.audience === "structure" && structure
                  ? structure.color
                  : null;
            return (
              <Card
                key={a.id}
                className={
                  a.pinned ? "bg-gold-muted/50 shadow-sm ring-gold/25" : "shadow-sm"
                }
              >
                <CardContent className="flex gap-3">
                  {a.pinned && (
                    <span
                      aria-label={t("announcements.pinned")}
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-foreground"
                    >
                      <Pin className="size-4" />
                    </span>
                  )}
                  <div className="grid min-w-0 flex-1 gap-2">
                    <h3 className="min-w-0 font-semibold leading-snug text-start" dir="auto">{a.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant="outline"
                        className="font-semibold"
                        style={
                          audienceColor
                            ? { borderColor: audienceColor, color: audienceColor }
                            : undefined
                        }
                      >
                        {audienceLabel}
                      </Badge>
                      <span className="tabular-nums">
                        {formatDate(a.publish_at, locale)} · {formatTime(a.publish_at, locale)}
                      </span>
                    </div>
                    {a.body && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground text-start" dir="auto">
                        {a.body}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
