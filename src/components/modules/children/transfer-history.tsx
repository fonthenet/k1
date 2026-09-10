import { ArrowLeft, ArrowRight, Route } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClassLink } from "@/components/shared/entity-link";
import { formatDate } from "@/lib/format";
import type { ChildTransferRow } from "./types";

/**
 * The child's "parcours": every move between the structures (or rooms) of the
 * building, newest first, as kg_child_transfers records it.
 *
 * A list and not a timeline widget: the DAS register reads exit and entry
 * dates from these rows, so what matters is that each one states a date, a
 * from, a to and a who — the same four facts the inspector will ask for.
 * The origin is spelt out only when it is a parent's request; "staff" is
 * the default and a badge that says so on every row would say nothing.
 */
export async function TransferHistory({ rows }: { rows: ChildTransferRow[] }) {
  const t = await getTranslations("children");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  // The arrow reads in the direction of the page: from → to in French, and
  // to ← from in Arabic, where "from" sits on the right.
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Route className="size-4" />
          </span>
          {t("transfers.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("transfers.empty")}</p>
        ) : (
          <ol className="grid gap-3">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-1 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">
                    {formatDate(r.effective_date, locale)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Place
                      structure={r.from_structure}
                      cls={r.from_class}
                      locale={locale}
                      none={t("transfers.nowhere")}
                      whole={tc("structures.all")}
                    />
                    <Arrow className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <Place
                      structure={r.to_structure}
                      cls={r.to_class}
                      locale={locale}
                      none={t("transfers.nowhere")}
                      whole={tc("structures.all")}
                    />
                  </span>
                  {r.origin === "parent_request" && (
                    <Badge variant="secondary">{t("transfers.parentRequest")}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>
                    {r.movedBy
                      ? t("transfers.by", { name: r.movedBy })
                      : t("transfers.byUnknown")}
                  </span>
                  {r.reason && (
                    <span className="text-start" dir="auto">
                      {r.reason}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** "La crèche · Grande Section", with the structure's own dot. */
function Place({
  structure,
  cls,
  locale,
  none,
  whole,
}: {
  structure: ChildTransferRow["from_structure"];
  cls: ChildTransferRow["from_class"];
  locale: string;
  none: string;
  whole: string;
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
      {structure && (
        <span
          className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
          style={{ backgroundColor: structure.color }}
          aria-hidden
        />
      )}
      <span>{structureName}</span>
      {cls && className && (
        <span className="text-muted-foreground">
          · <ClassLink id={cls.id}>{className}</ClassLink>
        </span>
      )}
    </span>
  );
}
