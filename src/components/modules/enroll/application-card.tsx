// What the reviewer must know about the STRUCTURE before pressing approve.
//
// The board itself is a table (app/(dashboard)/applications/page.tsx) and no
// longer draws a card per file; what is left here is the record page's
// context — server components with their own reads, so the page mounts one
// element and passes the row. `cache()` on the loaders means the page can
// also call them for the approve dialog's props without a second round trip.
//
// Two facts, each shown only when it is true:
//
// - on a transfer, where the child is today and where they want to go;
// - on an ordinary file, that a child with this name and birth date already
//   exists — a family asking to change structure by filling the public form
//   again, which approved as-is would create a second child with a second
//   badge and a second admission fee.

import { cache } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRightLeft } from "lucide-react";
import { childDisplayName } from "@/lib/format";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { ChildLink } from "@/components/shared/entity-link";
import { SectionCard } from "@/components/shared/section-card";
import { StructureMark } from "@/components/shared/structure-mark";
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
 *  only the source word and the family context on the detail page set it apart. */
export const SIBLING_SOURCE = "sibling";

/** The structure's name in the reader's script. */
export function structureRefName(s: Pick<StructureRef, "name" | "name_ar">, locale: string): string {
  return locale === "ar" && s.name_ar ? s.name_ar : s.name;
}

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

  if (!isTransfer && matchRows.length === 0) return null;

  const place = (structure: StructureRef | null, className: string | null) =>
    [structure ? structureRefName(structure, locale) : t("admin.noStructure"), className]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="mb-4 space-y-4">
      {isTransfer && subject && (
        <SectionCard
          icon={ArrowRightLeft}
          tone={1}
          title={t("admin.transferTitle")}
          hint={t("admin.transferHint")}
          contentClassName="gap-3"
        >
          {/* Today and tomorrow as two marks in one sentence: the structure's
              own dot is the only colour, and the child's name is the door to
              where they are now. */}
          <p className="text-sm text-muted-foreground">
            {t.rich("admin.transferSentence", {
              child: () => (
                <ChildLink id={subject.id}>{childDisplayName(subject, locale)}</ChildLink>
              ),
              from: () => (
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  {subjectStructure ? (
                    <StructureMark
                      structure={{
                        name: place(subjectStructure, subjectClassName),
                        color: subjectStructure.color,
                      }}
                    />
                  ) : (
                    place(null, subjectClassName)
                  )}
                </span>
              ),
              to: () => (
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  {requested ? (
                    <StructureMark
                      structure={{
                        name: place(
                          requested,
                          requestedClass ? structureRefName(requestedClass, locale) : null
                        ),
                        color: requested.color,
                      }}
                    />
                  ) : (
                    place(null, requestedClass ? structureRefName(requestedClass, locale) : null)
                  )}
                </span>
              ),
            })}
          </p>
          {app.note && (
            <div className="text-sm">
              <span className="text-xs text-muted-foreground">{t("admin.transferNote")}</span>
              {/* The family's own words on their own line, so the writing
                  direction comes from the note and not from the label. */}
              <bdi dir="auto" className="block text-start">
                {app.note}
              </bdi>
            </div>
          )}
          {subject.status !== "enrolled" && (
            <p className="text-sm text-gold-ink">
              {t("admin.transferNotEnrolled", {
                status: tChildren.has(`status.${subject.status}`)
                  ? tChildren(`status.${subject.status}`)
                  : subject.status,
              })}
            </p>
          )}
        </SectionCard>
      )}

      {isTransfer && !subject && (
        <p className="text-sm text-muted-foreground">{t("admin.transferChildMissing")}</p>
      )}

      {matchRows.map((m) => (
        // Gold, not red: this is a decision to make, not a fault to fix. The
        // usual reading is a family that filled the public form again to ask
        // for the other structure — and the right answer is a transfer. One
        // sentence with the door in it, not a panel.
        <p
          key={m.id}
          className="rounded-lg bg-gold-muted px-3 py-2 text-sm text-gold-ink"
        >
          {t.rich("admin.duplicateSentence", {
            child: () => (
              <ChildLink id={m.id} className="font-medium">
                {childDisplayName({ first_name: m.first_name, last_name: m.last_name }, locale)}
              </ChildLink>
            ),
            where: [
              m.structure ? structureRefName(m.structure, locale) : null,
              m.className,
              m.statusLabel,
            ]
              .filter(Boolean)
              .join(" · "),
          })}
        </p>
      ))}
    </div>
  );
}
