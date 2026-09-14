import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { ageFromDob, childDisplayName, formatDZD, initials } from "@/lib/format";
import { algiersToday, monthLabel } from "@/components/modules/billing/dates";
import { getDuesByChild } from "@/components/modules/portal/dues";
import {
  classLabel,
  getDossierGaps,
  getMyChildren,
  getMyGuardianBadge,
  getStructures,
} from "@/components/modules/portal/data";
import { StructureMark } from "@/components/shared/structure-mark";
import { FactsLine } from "@/components/modules/portal/facts-line";
import { structureName } from "@/components/modules/classes/class-types";
import {
  getMyOpenApplications,
  PendingApplications,
} from "@/components/modules/portal/add-child-pending";
import { CheckinDialog } from "@/components/modules/portal/checkin-dialog";

export default async function PortalChildrenPage() {
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const tAdd = await getTranslations("portal.addChild");
  const locale = await getLocale();
  const supabase = await createClient();

  // The enrolled children and the requests still waiting on the office — a
  // family that has just applied for a sibling must see both on one screen.
  // The door badge is per guardian, so it is fetched once here and raised by
  // the one trigger in the header rather than by a button per child.
  const [children, badge, structures] = await Promise.all([
    getMyChildren(supabase, ctx),
    getMyGuardianBadge(supabase, ctx, locale),
    getStructures(supabase, ctx),
  ]);
  const applications = await getMyOpenApplications(supabase, ctx);
  // A family with a child on each side of the building tells them apart by
  // the structure; a family in an ordinary crèche never sees the word.
  const multiStructure = structures.length > 1;
  const structureById = new Map(structures.map((s) => [s.id, s]));
  // Same source as the home screen's summary line, so the two cannot disagree.
  const today = algiersToday();
  const dues = await getDuesByChild(
    supabase,
    ctx.tenant.id,
    children.map((c) => c.id),
    today
  );
  const photoUrls = await Promise.all(children.map((c) => signedMediaUrl(c.photo_path)));
  // Which children still owe the office a paper (0164). One summary read
  // under the family's RLS; a read that fails costs this one muted word on
  // the row, never the list. Empty until the establishment activates its
  // list (D14), so nothing here changes for a tenant that has not.
  const dossierGaps = await getDossierGaps(supabase, ctx.tenant.id).catch((e: unknown) => {
    console.error("[portal/children] dossier summary failed:", e);
    return [];
  });
  const incompleteDossier = new Set(
    dossierGaps.map((row) => row.child_id).filter((id): id is string => Boolean(id))
  );
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;
  const hasRows = children.length > 0 || applications.length > 0;

  return (
    <div className="grid gap-4">
      {/* One header row that must hold at 420px: the title, the way to the
          programmes, and the family's ONE door badge. The badge is issued
          per guardian — one code for every child — so it is raised once,
          here, with no child named, instead of once per card. */}
      <div className="flex items-center justify-between gap-1.5">
        <h2 className="whitespace-nowrap text-2xl font-bold tracking-tight">{t("children.title")}</h2>
        {children.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Tertiary: a see-more link with its chevron, not a button — the
                badge beside it is the row's one button. */}
            <Link
              href="/portal/learning"
              className="inline-flex min-h-11 items-center gap-1 text-sm text-primary hover:underline hover:underline-offset-4"
            >
              {t("learning.title")}
              <ForwardIcon className="size-4" aria-hidden />
            </Link>
            {/* Slightly tighter than the card trigger so that title, link and
                badge hold one line in French at 420px — "Mes enfants",
                "Programmes" and "Pointer l'arrivée" are the longest of the
                three languages. */}
            <CheckinDialog badge={badge} className="px-2.5" />
          </div>
        )}
      </div>

      {/* "Nobody is linked to your account" is only true when there is also no
          request in flight — a family whose first request is still being
          reviewed is not unlinked, it is waiting. The portal has no page
          primary, so the empty state carries the one action itself. */}
      {!hasRows ? (
        <EmptyState
          icon={<Baby />}
          title={t("home.emptyChildren")}
          description={t("home.emptyChildrenDescription")}
          action={
            <Button asChild>
              <Link href="/portal/children/new">
                <Plus data-icon="inline-start" />
                {tAdd("trigger")}
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* One register for the family: a row per child, and the requests
              still with the office as rows of the same list under their own
              group row. A card per child made two children look like two
              sections of the page and hid the third under a fold of
              buttons; a row reads the same at one child and at four. */}
          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardContent className="px-0">
              <ul className="divide-y divide-border">
                {children.map((child, i) => {
                  const name = childDisplayName(child, locale);
                  const secondaryName =
                    locale === "ar"
                      ? `${child.first_name} ${child.last_name}`
                      : child.first_name_ar && child.last_name_ar
                        ? `${child.first_name_ar} ${child.last_name_ar}`
                        : null;
                  const cls = classLabel(child, locale);
                  const structure =
                    multiStructure && child.structure_id
                      ? structureById.get(child.structure_id)
                      : undefined;
                  const due = dues.get(child.id);
                  // What the money is FOR. An amount on its own leaves a
                  // parent guessing whether it is the admission fee or the
                  // month — different conversations to have with the office.
                  const dueWhat = due
                    ? due.hasRegistration
                      ? t("children.due.admission")
                      : due.months.length > 0
                        ? monthLabel(due.months[0].slice(0, 7), locale)
                        : null
                    : null;
                  return (
                    <li
                      key={child.id}
                      className="relative flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-primary/5"
                    >
                      <Avatar className="size-10 shrink-0">
                        {photoUrls[i] && <AvatarImage src={photoUrls[i]!} alt={name} />}
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {initials(child.first_name, child.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        {/* The name is the door: its overlay covers the row,
                            and nothing else in the row is clickable. */}
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                          <Link
                            href={`/portal/children/${child.id}`}
                            className="font-medium after:absolute after:inset-0"
                          >
                            <bdi dir="auto">{name}</bdi>
                          </Link>
                          {secondaryName && (
                            <bdi dir="auto" className="truncate text-xs text-muted-foreground">
                              {secondaryName}
                            </bdi>
                          )}
                        </span>
                        {/* Where the child is, said once: the class as plain
                            text, the structure as the one coloured mark. */}
                        <FactsLine
                          className="mt-0.5"
                          facts={[
                            <span key="age">{ageFromDob(child.dob, locale)}</span>,
                            cls && <span key="class">{cls}</span>,
                            structure && (
                              <StructureMark
                                key="structure"
                                structure={{
                                  name: structureName(structure, locale),
                                  color: structure.color,
                                }}
                                className="text-xs"
                              />
                            ),
                          ]}
                        />
                      </span>
                      {/* Only ever shown when the answer is not "enrolled".
                          A pill reading "enrolled" on every row is noise; a
                          child who has been withdrawn, or is still on the
                          waiting list, is the whole point of showing it —
                          withdrawal silently kills the badge at the door. */}
                      {child.status !== "enrolled" && (
                        <StatusPill tone={child.status === "withdrawn" ? "danger" : "muted"}>
                          {t(`children.status.${child.status}`)}
                        </StatusPill>
                      )}
                      {due && (
                        <span className="flex shrink-0 flex-col items-end gap-0.5 text-end">
                          <span className="whitespace-nowrap text-sm font-medium tabular-nums">
                            {formatDZD(due.balance, locale)}
                          </span>
                          {dueWhat && (
                            <span className="text-xs text-muted-foreground">{dueWhat}</span>
                          )}
                          {/* Red only once the money is genuinely late —
                              owed inside its terms is a plain number. */}
                          {due.overdue && (
                            <StatusPill tone="danger">{t("payments.statuses.overdue")}</StatusPill>
                          )}
                        </span>
                      )}
                      {/* A file with a paper still to hand in: one muted
                          word, never a second coloured mark beside the
                          money — the child's own page says which paper. */}
                      {incompleteDossier.has(child.id) && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("dossier.incomplete")}
                        </span>
                      )}
                      <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </li>
                  );
                })}
                <PendingApplications rows={applications} structures={structures} />
              </ul>
            </CardContent>
          </Card>

          {/* Tertiary on purpose: the children are what this page is about,
              and enrolling another one is something a family does once every
              few years. */}
          <Link
            href="/portal/children/new"
            className="inline-flex w-fit items-center gap-1.5 px-1 text-sm text-primary hover:underline hover:underline-offset-4"
          >
            <Plus className="size-4" aria-hidden />
            {tAdd("trigger")}
          </Link>
        </>
      )}
    </div>
  );
}
