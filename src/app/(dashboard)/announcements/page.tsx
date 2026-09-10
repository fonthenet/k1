import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, Megaphone, Pin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  AnnouncementDialog,
  DeleteAnnouncementButton,
} from "@/components/modules/comms/announcement-actions";
import { audienceClasses, type AnnouncementRow, type ClassOption } from "@/components/modules/comms/types";
import { WhatsAppIcon } from "@/components/modules/comms/whatsapp-icon";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

export default async function AnnouncementsPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const supabase = await createClient();

  const [{ data: annRows, error }, { data: classRows }, { data: structureRows }] =
    await Promise.all([
      // Scoped to the structure PLUS the building: a water cut is addressed to
      // the address, and must not vanish because someone is reading the école.
      scoped(
        supabase
          .from("kg_announcements")
          .select(
            "id, title, body, audience, class_id, structure_id, pinned, publish_at, created_by, created_at"
          )
          .eq("tenant_id", ctx.tenant.id)
          .order("pinned", { ascending: false })
          .order("publish_at", { ascending: false })
          .limit(100),
        ctx
      ),
      // Not narrowed: this list only feeds the announcement dialog, and a
      // notice for a crèche class must still be writable while reading the
      // école. Scope what you read, never what you do.
      supabase
        .from("kg_classes")
        .select("id, name, name_ar")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      // The structures of the establishment (0125), so a notice can be
      // addressed to one of them. A crèche running a single structure never
      // sees the option.
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active")
        .eq("tenant_id", ctx.tenant.id)
        .order("sort_order")
        .order("name"),
    ]);
  if (error) throw new Error(error.message);

  const announcements = (annRows ?? []) as AnnouncementRow[];
  const classes: ClassOption[] = classRows ?? [];
  const classById = new Map(classes.map((c) => [c.id, c]));
  const structures = (structureRows ?? []) as Structure[];
  const structureById = new Map(structures.map((s) => [s.id, s]));

  const authorIds = [...new Set(announcements.map((a) => a.created_by).filter(Boolean))] as string[];
  const { data: profileRows } = authorIds.length
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", authorIds)
    : { data: [] as { id: string; full_name: string }[] };
  const authorById = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  // Server component: this renders once per request, so a per-request clock is
  // exactly right — "is this announcement still scheduled?" has to be answered
  // against the moment the page was asked for. The purity rule is aimed at
  // client renders that can repeat.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div>
      <PageHeader title={t("announcements.title")} description={t("announcements.description")}>
        <AnnouncementDialog announcement={null} classes={classes} structures={structures} />
      </PageHeader>

      {announcements.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title={t("announcements.empty")}
          description={t("announcements.emptyDescription")}
          action={
            <AnnouncementDialog announcement={null} classes={classes} structures={structures} />
          }
        />
      ) : (
        <div className="grid gap-4">
          {announcements.map((a) => {
            const cls = a.class_id ? classById.get(a.class_id) : undefined;
            const str = a.structure_id ? structureById.get(a.structure_id) : undefined;
            // The badge says who was addressed, so a class and a structure name
            // themselves rather than repeating the word for their kind.
            const audienceLabel =
              a.audience === "class" && cls
                ? locale === "ar" && cls.name_ar
                  ? cls.name_ar
                  : cls.name
                : a.audience === "structure" && str
                  ? structureName(str, locale)
                  : t(`audience.${a.audience}`);
            const author = a.created_by ? authorById.get(a.created_by) : null;
            const scheduled = Date.parse(a.publish_at) > now;
            const shareUrl = `https://wa.me/?text=${encodeURIComponent(`${a.title}\n\n${a.body}`)}`;

            return (
              <Card
                key={a.id}
                className={cn(
                  "border border-border py-0 shadow-sm ring-0 transition-shadow hover:shadow-md",
                  // Pinned items are the one place gold outranks green.
                  a.pinned && "border-gold/45 bg-gold/5"
                )}
              >
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.pinned && (
                          <span
                            aria-hidden
                            className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-gold text-gold-foreground"
                          >
                            <Pin className="size-3.5" />
                          </span>
                        )}
                        <h3 className="text-base font-semibold text-foreground">{a.title}</h3>
                        <Badge className={audienceClasses(a.audience)}>
                          {/* The structure's own colour, the same dot the staff
                              list gives it — the badge itself stays neutral so
                              the two readings do not compete. */}
                          {str && a.audience === "structure" && (
                            <span
                              className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
                              style={{ backgroundColor: str.color }}
                              aria-hidden
                            />
                          )}
                          {audienceLabel}
                        </Badge>
                        {scheduled && (
                          <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                            <CalendarClock data-icon="inline-start" />
                            {t("announcements.scheduled")}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {formatDate(a.publish_at, locale)} · {formatTime(a.publish_at, locale)}
                        {author ? ` · ${t("announcements.by", { name: author })}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button asChild variant="ghost" size="icon" aria-label={t("announcements.share")}>
                        <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                          <WhatsAppIcon className="size-4 text-success" />
                        </a>
                      </Button>
                      <AnnouncementDialog
                        announcement={a}
                        classes={classes}
                        structures={structures}
                      />
                      <DeleteAnnouncementButton announcementId={a.id} />
                    </div>
                  </div>
                  {a.body && (
                    <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                      {a.body}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
