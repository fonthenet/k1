import { ArrowRight, Route } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { SectionCard } from "@/components/shared/section-card";
import { StructureMark } from "@/components/shared/structure-mark";
import { formatDate } from "@/lib/format";
import type { ChildTransferRow } from "./types";

/**
 * The child's "parcours": every move between the structures (or rooms) of the
 * building, newest first, as kg_child_transfers records it.
 *
 * A divide-y list in the bill's anatomy — the date at the start in
 * tabular figures, then "from → to" in plain words, the by-line muted at the
 * end. The DAS register reads exit and entry dates from these rows, so what
 * matters is that each one states a date, a from, a to and a who. One colour
 * per row: the structure the child ARRIVED in carries its mark; the one they
 * left is plain text, and the classes are muted. The origin is spelt out
 * only when it is a parent's request; "staff" is the default and a badge
 * that says so on every row would say nothing.
 */
export async function TransferHistory({ rows }: { rows: ChildTransferRow[] }) {
  const t = await getTranslations("children");
  const tc = await getTranslations("common");
  const locale = await getLocale();

  return (
    <SectionCard icon={Route} tone={3} title={t("transfers.title")} contentClassName="gap-0">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("transfers.empty")}</p>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm first:pt-0 last:pb-0"
            >
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                {formatDate(r.effective_date, locale)}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                <Place
                  structure={r.from_structure}
                  cls={r.from_class}
                  locale={locale}
                  none={t("transfers.nowhere")}
                  whole={tc("structures.all")}
                />
                {/* The arrow reads in the direction of the page: from → to in
                    French, and the mirror of it in Arabic. */}
                <ArrowRight
                  className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180"
                  aria-hidden
                />
                <Place
                  structure={r.to_structure}
                  cls={r.to_class}
                  locale={locale}
                  none={t("transfers.nowhere")}
                  whole={tc("structures.all")}
                  marked
                />
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {/* The mover's name is person-typed: isolated in its own
                    run rather than interpolated into the sentence, so an
                    Arabic name after a French word (or the reverse) keeps
                    its letters in order. */}
                {r.movedBy ? (
                  <span>
                    {t("transfers.byLabel")} <bdi dir="auto">{r.movedBy}</bdi>
                  </span>
                ) : (
                  <span>{t("transfers.byUnknown")}</span>
                )}
                {r.origin === "parent_request" && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{t("transfers.parentRequest")}</span>
                  </>
                )}
                {r.reason && (
                  <>
                    <span aria-hidden>·</span>
                    <bdi dir="auto" className="text-start">
                      {r.reason}
                    </bdi>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/** "La crèche · Grande Section" — the destination carries the structure mark. */
function Place({
  structure,
  cls,
  locale,
  none,
  whole,
  marked = false,
}: {
  structure: ChildTransferRow["from_structure"];
  cls: ChildTransferRow["from_class"];
  locale: string;
  none: string;
  whole: string;
  marked?: boolean;
}) {
  if (!structure && !cls) return <span className="text-muted-foreground">{none}</span>;
  const structureName = structure
    ? locale === "ar" && structure.name_ar
      ? structure.name_ar
      : structure.name
    : whole;
  const className = cls ? (locale === "ar" && cls.name_ar ? cls.name_ar : cls.name) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {marked && structure ? (
        <StructureMark structure={{ name: structureName, color: structure.color }} />
      ) : (
        <span>{structureName}</span>
      )}
      {className && <span className="text-muted-foreground">· {className}</span>}
    </span>
  );
}
