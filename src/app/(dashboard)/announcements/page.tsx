import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone, Pin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { formatDate, formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ClassChip } from "@/components/shared/class-chip";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import {
  AnnouncementDialog,
  AnnouncementRowMenu,
} from "@/components/modules/comms/announcement-actions";
import { type AnnouncementRow, type ClassOption } from "@/components/modules/comms/types";
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
      // Pinned first, then newest — the order the register is read in, so no
      // group rows are needed to say it.
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
      // école. Scope what you read, never what you do. The colour is for the
      // class chip in the register — the one mark a class carries.
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, color")
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
        />
      ) : (
        /* One row per announcement, the way the classes page draws classes:
           the title is the door, the facts are columns, the two controls are
           lifted at the end. A card per notice made ten notices ten boxes of
           different heights with a tinted frame on the pinned ones — a pin
           glyph before the title says "pinned" once and costs nothing. */
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("announcements.columns.announcement")}</TableHead>
                  <TableHead>{t("announcements.form.audience")}</TableHead>
                  <TableHead>{t("announcements.form.publishAt")}</TableHead>
                  <TableHead>{t("announcements.columns.author")}</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">{t("announcements.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {announcements.map((a) => {
                  const cls = a.class_id ? classById.get(a.class_id) : undefined;
                  const str = a.structure_id ? structureById.get(a.structure_id) : undefined;
                  const author = a.created_by ? authorById.get(a.created_by) : null;
                  const scheduled = Date.parse(a.publish_at) > now;
                  const shareUrl = `https://wa.me/?text=${encodeURIComponent(`${a.title}\n\n${a.body}`)}`;

                  return (
                    <TableRow key={a.id} className="relative transition-colors hover:bg-primary/5 [&>td]:align-top">
                      <TableCell className="min-w-64 max-w-xl whitespace-normal">
                        {/* The title opens the editor and its overlay reaches
                            every cell, so the whole row is the door. */}
                        <AnnouncementDialog
                          announcement={a}
                          classes={classes}
                          structures={structures}
                          trigger={
                            <button
                              type="button"
                              className="flex items-center gap-1.5 rounded text-start font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                              {/* The glyph is decoration; the word is what a
                                  screen reader gets, since an inline svg with
                                  a label and no role is skipped by most. */}
                              {a.pinned && (
                                <>
                                  <Pin className="size-3.5 shrink-0 text-gold-ink" aria-hidden />
                                  <span className="sr-only">{t("announcements.pinned")}</span>
                                </>
                              )}
                              <bdi dir="auto">{a.title}</bdi>
                            </button>
                          }
                        />
                        {a.body && (
                          <bdi
                            dir="auto"
                            className="mt-0.5 line-clamp-2 text-start text-xs leading-relaxed text-muted-foreground"
                          >
                            {a.body}
                          </bdi>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {/* One mark for who was addressed: a structure or a
                            class names itself with its own colour; the rest
                            is a word. */}
                        {a.audience === "structure" && str ? (
                          <StructureMark
                            structure={{
                              name: structureName(str, locale),
                              color: str.color ?? "var(--primary)",
                            }}
                          />
                        ) : a.audience === "class" && cls ? (
                          <ClassChip
                            name={locale === "ar" && cls.name_ar ? cls.name_ar : cls.name}
                            color={cls.color}
                          />
                        ) : (
                          <span className="text-muted-foreground">{t(`audience.${a.audience}`)}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                        <span className="flex flex-wrap items-center gap-2">
                          <span>
                            {formatDate(a.publish_at, locale)} · {formatTime(a.publish_at, locale)}
                          </span>
                          {scheduled && (
                            <StatusPill tone="attention">{t("announcements.scheduled")}</StatusPill>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {author ? <bdi dir="auto">{author}</bdi> : "—"}
                      </TableCell>
                      <TableCell className="w-20">
                        <span className="relative z-10 flex items-center justify-end gap-0.5">
                          <Button
                            asChild
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground"
                            aria-label={t("announcements.share")}
                            title={t("announcements.share")}
                          >
                            <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                              <WhatsAppIcon className="size-4" />
                            </a>
                          </Button>
                          <AnnouncementRowMenu announcementId={a.id} />
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
