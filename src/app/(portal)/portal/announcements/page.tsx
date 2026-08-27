import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone, Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { formatDate, formatTime } from "@/lib/format";
import type { Audience } from "@/lib/types";
import { getMyChildren } from "@/components/modules/portal/data";

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  class_id: string | null;
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
  const [{ data: annRows }, { data: classRows }] = await Promise.all([
    supabase
      .from("kg_announcements")
      .select("id, title, body, audience, class_id, pinned, publish_at")
      .eq("tenant_id", ctx.tenant.id)
      .lte("publish_at", nowIso)
      .order("pinned", { ascending: false })
      .order("publish_at", { ascending: false })
      .limit(100),
    supabase
      .from("kg_classes")
      .select("id, name, name_ar, color")
      .eq("tenant_id", ctx.tenant.id),
  ]);

  const classById = new Map(((classRows ?? []) as ClassRow[]).map((c) => [c.id, c]));

  // Parents see everything addressed to all/parents, plus their own children's classes.
  const announcements = ((annRows ?? []) as AnnouncementRow[]).filter(
    (a) =>
      a.audience === "all" ||
      a.audience === "parents" ||
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
            const audienceLabel =
              a.audience === "class" && cls
                ? locale === "ar" && cls.name_ar
                  ? cls.name_ar
                  : cls.name
                : t(`announcements.audience.${a.audience}`);
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
                    <h3 className="min-w-0 font-semibold leading-snug">{a.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant="outline"
                        className="font-semibold"
                        style={
                          a.audience === "class" && cls
                            ? { borderColor: cls.color, color: cls.color }
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
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
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
