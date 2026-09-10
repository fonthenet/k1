// One family on the admissions board. Server-rendered; only the stage menu and
// the waitlist arrows are client components.

import Link from "next/link";
import { cache } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRightLeft,
  CalendarClock,
  CalendarDays,
  CopyCheck,
  Phone,
  Sparkles,
  Users,
} from "lucide-react";
import { ageFromDob, childDisplayName, formatDate, formatDZD, formatPhone, formatTime, initials, telHref } from "@/lib/format";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { ChildLink } from "@/components/shared/entity-link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StageMenu } from "./stage-menu";
import { WaitlistControls } from "./waitlist-controls";
import { applicantPhone } from "./types";
import {
  isTransferApplication,
  type ClassRef,
  type MatchingChild,
  type ReviewApplication,
  type StructureRef,
  type TransferSubject,
  type TransferSummary,
} from "./review-types";

/** `kg_applications.source` written by kg_submit_sibling_application (migration
 *  0017): an existing parent enrolling another child. Ordinary pipeline row —
 *  only the badge and the family context on the detail page set it apart. */
export const SIBLING_SOURCE = "sibling";

/** Gold chip marking an application that comes from a family already here. */
export async function SiblingBadge() {
  const t = await getTranslations("enroll");
  return (
    <Badge className="border-transparent bg-gold-muted font-medium text-gold-ink">
      <Users data-icon="inline-start" />
      {t("sibling.badge")}
    </Badge>
  );
}

/** The structure's name in the reader's script. */
function structureRefName(s: Pick<StructureRef, "name" | "name_ar">, locale: string): string {
  return locale === "ar" && s.name_ar ? s.name_ar : s.name;
}

/**
 * Which structure of the building a file is for: the structure's own colour
 * as a dot, its name, and the requested class after it when the family named
 * one. The colour is the one signal — the chip itself stays neutral, so a
 * board of twelve files reads as twelve files with a dot each, not as twelve
 * coloured badges competing with the status pills.
 *
 * Rendered only where the caller has checked the building has more than one
 * structure; on a single-structure crèche the word never appears.
 */
export function StructureChip({
  structure,
  cls,
  locale,
  className,
}: {
  structure: StructureRef;
  cls?: ClassRef | null;
  locale: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("max-w-full", className)}>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: structure.color }}
      />
      <span className="truncate">
        {structureRefName(structure, locale)}
        {cls && (
          <span className="text-muted-foreground"> · {structureRefName(cls, locale)}</span>
        )}
      </span>
    </Badge>
  );
}

/**
 * A transfer request is about a child who is ALREADY here, so the badge is a
 * door to that child's file — the reviewer's first question is "where are
 * they now?", and the answer lives on that page. The name is repeated on the
 * badge on purpose: in the pipeline the card title and the badge are the same
 * child, but on the child's own page and in a notification the badge stands
 * alone.
 */
export async function TransferBadge({
  childId,
  name,
}: {
  childId: string;
  name: string;
}) {
  const t = await getTranslations("enroll");
  return (
    <Badge asChild variant="tinted" className="bg-primary/10 text-primary">
      <Link href={`/children/${childId}`}>
        <ArrowRightLeft data-icon="inline-start" />
        {t("admin.transferBadge", { name })}
      </Link>
    </Badge>
  );
}

export async function ApplicationCard({
  app,
  canManage,
  waitlist,
  showStructure = false,
}: {
  app: ReviewApplication;
  canManage: boolean;
  /** Present in the waitlist lane: rank plus the reorder arrows. */
  waitlist?: { position: number; isFirst: boolean; isLast: boolean };
  /** The building runs more than one structure — the only case the chip means anything. */
  showStructure?: boolean;
}) {
  const t = await getTranslations("enroll");
  const locale = await getLocale();

  const child = app.child;
  const phone = applicantPhone(app);
  const activityCount = Array.isArray(app.activity_ids) ? app.activity_ids.length : 0;
  const displayName = childDisplayName(
    {
      first_name: child.first_name ?? "",
      last_name: child.last_name ?? "",
      first_name_ar: child.first_name_ar,
      last_name_ar: child.last_name_ar,
    },
    locale
  );
  const isSibling = app.source === SIBLING_SOURCE;
  const isTransfer = isTransferApplication(app);
  // 'sibling' and 'transfer' have their own badges; anything else in `source`
  // is a marketing channel and reads as plain text.
  const sourceKey = app.source && !isTransfer ? `source.${app.source}` : null;
  const sourceLabel = sourceKey ? (t.has(sourceKey) ? t(sourceKey) : app.source) : null;
  const hasInterviewSlot = app.status === "interview" && Boolean(app.interview_at);
  const plan = app.kg_fee_plans ?? null;
  const planName = plan ? (locale === "ar" && plan.name_ar ? plan.name_ar : plan.name) : null;
  const structure = showStructure ? (app.kg_structures ?? null) : null;
  const hasChips =
    hasInterviewSlot ||
    isSibling ||
    isTransfer ||
    Boolean(structure) ||
    Boolean(sourceLabel) ||
    activityCount > 0 ||
    Boolean(plan);

  return (
    <Card size="sm" className="transition-shadow hover:shadow-md">
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2.5">
          {waitlist ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-sm font-bold tabular-nums text-secondary-foreground">
              {waitlist.position}
            </span>
          ) : (
            <Avatar className="size-10 shrink-0">
              <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                {initials(child.first_name ?? "", child.last_name ?? "")}
              </AvatarFallback>
            </Avatar>
          )}

          <div className="min-w-0 flex-1">
            <Link
              href={`/applications/${app.id}`}
              className="block truncate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
            >
              {displayName}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {child.dob ? ageFromDob(child.dob, locale) : "—"}
            </p>
          </div>

          {waitlist && canManage && (
            <WaitlistControls
              appId={app.id}
              isFirst={waitlist.isFirst}
              isLast={waitlist.isLast}
            />
          )}
          {canManage && (
            <StageMenu
              appId={app.id}
              status={app.status}
              interviewAt={app.interview_at}
              variant="ghost"
              showLabel={false}
            />
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          {phone && (
            <a
              href={telHref(phone)}
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <Phone className="size-3.5 shrink-0" />
              <span dir="ltr" className="truncate">
                {formatPhone(phone)}
              </span>
            </a>
          )}
          <p className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" />
            <span className="truncate">
              {t("admin.submittedOn", { date: formatDate(app.created_at, locale) })}
            </span>
          </p>
        </div>

        {app.status === "rejected" && app.review_note && (
          <p className="line-clamp-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
            {app.review_note}
          </p>
        )}

        {hasChips && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* What the family asked to pay for — the first thing approval
                will confirm, so the first chip the reviewer sees. */}
            {plan && (
              <Badge className="border-transparent bg-primary/10 font-medium text-primary">
                {planName} · {formatDZD(plan.amount, locale)}
              </Badge>
            )}
            {/* A transfer is the one file where the first fact is not the
                tariff but the move itself: which child, and that they exist. */}
            {isTransfer && app.existing_child_id && (
              <TransferBadge childId={app.existing_child_id} name={displayName} />
            )}
            {structure && (
              <StructureChip structure={structure} cls={app.kg_classes} locale={locale} />
            )}
            {isSibling && <SiblingBadge />}
            {hasInterviewSlot && app.interview_at && (
              <Badge className="border-transparent bg-secondary font-medium text-secondary-foreground">
                <CalendarClock data-icon="inline-start" />
                {formatDate(app.interview_at, locale, { day: "numeric", month: "short" })} ·{" "}
                {formatTime(app.interview_at, locale)}
              </Badge>
            )}
            {!isSibling && sourceLabel && <Badge variant="outline">{sourceLabel}</Badge>}
            {activityCount > 0 && (
              <Badge variant="secondary">
                <Sparkles data-icon="inline-start" />
                {t("admin.activitiesCount", { count: activityCount })}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   The detail page: what the reviewer must know about the STRUCTURE before
   pressing approve. Three facts, each shown only when it is true:

   - which structure the family asked for (multi-structure buildings only);
   - on a transfer, where the child is today and where they want to go;
   - on an ordinary file, that a child with this name and birth date already
     exists — a family asking to change structure by filling the public form
     again, which approved as-is would create a second child with a second
     badge and a second admission fee.

   Server components with their own reads, so the page mounts one element and
   passes the row. `cache()` on the loaders means the page can also call them
   for the approve dialog's props without a second round trip.
--------------------------------------------------------------------------- */

/** The child a transfer is about, as they stand today. Null when not a transfer. */
export const loadTransferSubject = cache(
  async (app: Pick<ReviewApplication, "source" | "existing_child_id" | "tenant_id">) => {
    if (!isTransferApplication(app) || !app.existing_child_id) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, status, structure_id, class_id")
      .eq("id", app.existing_child_id)
      .eq("tenant_id", app.tenant_id)
      .maybeSingle();
    return (data as TransferSubject | null) ?? null;
  }
);

/** A class's name in the reader's script, from its id. Null when unplaced. */
const loadClassName = cache(async (classId: string | null, tenantId: string, locale: string) => {
  if (!classId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("kg_classes")
    .select("id, name, name_ar, structure_id")
    .eq("id", classId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const cls = data as ClassRef | null;
  return cls ? structureRefName(cls, locale) : null;
});

/**
 * The approve dialog's view of a transfer: names, not ids. The structure is
 * resolved from the building's active list; a child filed under a structure
 * that has since been closed reads as "no structure", which is the truth the
 * reviewer needs before moving them anywhere.
 */
export async function loadTransferSummary(
  app: Pick<ReviewApplication, "source" | "existing_child_id" | "tenant_id">
): Promise<TransferSummary | null> {
  const subject = await loadTransferSubject(app);
  if (!subject) return null;
  const [ctx, locale] = await Promise.all([requireStaff(), getLocale()]);
  const from = ctx.structures.find((s) => s.id === subject.structure_id) ?? null;
  return {
    childId: subject.id,
    fromStructureName: from ? structureRefName(from, locale) : null,
    fromClassName: await loadClassName(subject.class_id, app.tenant_id, locale),
  };
}

/**
 * The structure's identity in one tile: its colour behind its centre-type
 * glyph, the same pairing the sidebar switcher uses, so "the crèche" looks
 * like the crèche on every screen.
 */
function StructureTile({ structure, className }: { structure: StructureRef; className?: string }) {
  const { Icon } = centerTypeOption(structure.center_type);
  return (
    <span
      aria-hidden
      className={cn("grid size-8 shrink-0 place-items-center rounded-lg", className)}
      style={{ backgroundColor: `${structure.color}1f`, color: structure.color }}
    >
      <Icon className="size-4" />
    </span>
  );
}

export async function ApplicationStructureContext({ app }: { app: ReviewApplication }) {
  const ctx = await requireStaff();
  const [t, tChildren, locale] = await Promise.all([
    getTranslations("enroll"),
    getTranslations("children"),
    getLocale(),
  ]);
  const supabase = await createClient();

  const isTransfer = isTransferApplication(app);
  const requested: StructureRef | null =
    app.kg_structures ?? ctx.structures.find((s) => s.id === app.structure_id) ?? null;
  const requestedClass = app.kg_classes ?? null;
  const child = app.child;
  const displayName = childDisplayName(
    {
      first_name: child.first_name ?? "",
      last_name: child.last_name ?? "",
      first_name_ar: child.first_name_ar,
      last_name_ar: child.last_name_ar,
    },
    locale
  );

  // One of the two reads, never both: a transfer names its child by id, so
  // there is nothing to guess; an ordinary file is guessed against by name
  // and birth date. Guarded on the birth date because a null date matched
  // against `c.dob = null` is simply no rows, and a rpc call that can only
  // return nothing is a round trip for nothing.
  const [subject, matches] = await Promise.all([
    loadTransferSubject(app),
    !isTransfer && child.dob && child.first_name && child.last_name
      ? supabase
          .rpc("kg_find_matching_child", {
            p_tenant: ctx.tenant.id,
            p_first_name: child.first_name,
            p_last_name: child.last_name,
            p_dob: child.dob,
          })
          .then((r) => ((r.data ?? []) as MatchingChild[]).filter((m) => m.id !== app.created_child_id))
      : Promise.resolve([] as MatchingChild[]),
  ]);

  const subjectStructure = subject
    ? (ctx.structures.find((s) => s.id === subject.structure_id) ?? null)
    : null;
  const subjectClassName = subject
    ? await loadClassName(subject.class_id, app.tenant_id, locale)
    : null;

  // Where each duplicate candidate sits, in words. Up to three rows, so three
  // small reads at most — and in practice one.
  const matchRows = await Promise.all(
    matches.map(async (m) => ({
      ...m,
      structure: ctx.structures.find((s) => s.id === m.structure_id) ?? null,
      className: await loadClassName(m.class_id, app.tenant_id, locale),
      statusLabel: tChildren.has(`status.${m.status}`) ? tChildren(`status.${m.status}`) : m.status,
    }))
  );

  const showRequested = ctx.isMultiStructure && !!requested && !isTransfer;
  if (!showRequested && !isTransfer && matchRows.length === 0) return null;

  return (
    <div className="mb-4 space-y-3">
      {showRequested && requested && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">{t("admin.requestedStructure")}</span>
          <StructureChip structure={requested} cls={requestedClass} locale={locale} />
        </p>
      )}

      {isTransfer && subject && (
        // The requested structure's own colour is the one signal on this
        // panel: the card is neutral, the tile says where the child is going.
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            {requested ? (
              <StructureTile structure={requested} />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <ArrowRightLeft className="size-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1 space-y-1.5 text-sm">
              <p className="font-semibold">{t("admin.transferTitle")}</p>
              <p className="text-muted-foreground">
                {t.rich("admin.transferSentence", {
                  child: () => (
                    <ChildLink id={subject.id}>{childDisplayName(subject, locale)}</ChildLink>
                  ),
                  from: () => (
                    <span className="font-medium text-foreground">
                      {subjectStructure
                        ? structureRefName(subjectStructure, locale)
                        : t("admin.noStructure")}
                      {subjectClassName && ` · ${subjectClassName}`}
                    </span>
                  ),
                  to: () => (
                    <span className="font-medium text-foreground">
                      {requested ? structureRefName(requested, locale) : t("admin.noStructure")}
                      {requestedClass && ` · ${structureRefName(requestedClass, locale)}`}
                    </span>
                  ),
                })}
              </p>
              {app.note && (
                <div className="rounded-lg bg-muted/60 px-2.5 py-1.5">
                  <span className="text-muted-foreground">{t("admin.transferNote")}</span>
                  {/* The family's own words on their own line, so the writing
                      direction comes from the note and not from the label. */}
                  <p dir="auto" className="text-start">{app.note}</p>
                </div>
              )}
              {subject.status !== "enrolled" && (
                <p className="text-xs text-muted-foreground">
                  {t("admin.transferNotEnrolled", {
                    status: tChildren.has(`status.${subject.status}`)
                      ? tChildren(`status.${subject.status}`)
                      : subject.status,
                  })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isTransfer && !subject && (
        <p className="text-sm text-muted-foreground">{t("admin.transferChildMissing")}</p>
      )}

      {matchRows.length > 0 && (
        // Gold, not red: this is a decision to make, not a fault to fix. The
        // usual reading is a family that filled the public form again to ask
        // for the other structure — and the right answer is a transfer.
        <div className="flex items-start gap-3 rounded-xl bg-gold-muted/60 p-4 text-sm ring-1 ring-gold/25">
          <CopyCheck className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="font-semibold text-gold-ink">{t("admin.duplicateTitle")}</p>
            <ul className="space-y-1">
              {matchRows.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <ChildLink id={m.id}>
                    {childDisplayName({ first_name: m.first_name, last_name: m.last_name }, locale)}
                  </ChildLink>
                  <span className="text-muted-foreground">
                    {[
                      m.structure ? structureRefName(m.structure, locale) : null,
                      m.className,
                      m.statusLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              {t("admin.duplicateHint", { name: displayName })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
