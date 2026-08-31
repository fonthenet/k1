"use client";

import { useMemo, useState } from "react";
import {
  compareValues,
  nextSort,
  SortableHeader,
  type SortState,
} from "@/components/shared/sortable-header";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ageFromDob, childDisplayName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChildStatus } from "@/lib/types";
import { ChildAvatar } from "./child-avatar";
import {
  childStatusClasses,
  severityClasses,
  type ClassOption,
  type RosterChild,
} from "./types";

const STATUSES: ChildStatus[] = ["enrolled", "pending", "waitlist", "withdrawn", "alumni"];

function ClassChip({ child, locale }: { child: RosterChild; locale: string }) {
  const t = useTranslations("children");
  if (!child.className) {
    return <span className="text-sm text-muted-foreground">{t("roster.noClass")}</span>;
  }
  const name = locale === "ar" && child.classNameAr ? child.classNameAr : child.className;
  return (
    <Badge variant="outline" className="gap-1.5 bg-muted/50">
      {/* `classColor` is per-class user data from kg_classes.color — kept as a dot. */}
      <span
        className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: child.classColor ?? "var(--primary)" }}
        aria-hidden
      />
      {name}
    </Badge>
  );
}

function AllergyBadge({ child }: { child: RosterChild }) {
  const t = useTranslations("children");
  if (!child.worstAllergy || child.allergyCount === 0) return null;
  return (
    <Badge className={severityClasses(child.worstAllergy)}>
      <AlertTriangle aria-hidden />
      {t("allergyBadge", { count: child.allergyCount })}
    </Badge>
  );
}

/**
 * Enrolled, and charged no tuition.
 *
 * Gold rather than red: nobody is late — the crèche is simply not billing this
 * family yet, and somebody has to decide. Shown only to finance, because the
 * roster is read by educators all day and who is being charged is not their
 * business; the page sets the flag to false for everyone else.
 */
function NoFeePlanBadge({ child }: { child: RosterChild }) {
  const t = useTranslations("children");
  if (!child.noFeePlan) return null;
  return (
    <Badge className="border-gold/40 bg-gold-muted text-gold-ink" title={t("billing.noPlanHint")}>
      <AlertTriangle aria-hidden />
      {t("billing.noPlan")}
    </Badge>
  );
}

function DualName({ child, locale }: { child: RosterChild; locale: string }) {
  const primary = childDisplayName(child, locale);
  const secondary =
    locale === "ar"
      ? `${child.first_name} ${child.last_name}`
      : child.first_name_ar && child.last_name_ar
        ? `${child.first_name_ar} ${child.last_name_ar}`
        : null;
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold">{primary}</div>
      {secondary && (
        <div className="truncate text-xs text-muted-foreground text-start" dir="auto">
          {secondary}
        </div>
      )}
    </div>
  );
}

/** One child as a card — the mobile row, and every row of the former group. */
function ChildCard({ child, locale }: { child: RosterChild; locale: string }) {
  const t = useTranslations("children");
  return (
    <Card className="relative py-0 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-3.5">
        <ChildAvatar
          firstName={child.first_name}
          lastName={child.last_name}
          photoUrl={child.photoUrl}
          className="size-12"
        />
        <div className="min-w-0 flex-1">
          <Link href={`/children/${child.id}`} className="after:absolute after:inset-0">
            <DualName child={child} locale={locale} />
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{ageFromDob(child.dob, locale)}</span>
            <ClassChip child={child} locale={locale} />
            <AllergyBadge child={child} />
            <NoFeePlanBadge child={child} />
          </div>
        </div>
        <Badge className={childStatusClasses(child.status)}>{t(`status.${child.status}`)}</Badge>
      </CardContent>
    </Card>
  );
}

type SortKey = "child" | "age" | "klass" | "allergies" | "tag" | "status";

export function ChildrenRoster({
  rows,
  classes,
}: {
  rows: RosterChild[];
  classes: ClassOption[];
}) {
  const t = useTranslations("children");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Name ascending is the roster people expect to land on; every other order is
  // something they went looking for.
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "child", dir: "asc" });
  const [showFormer, setShowFormer] = useState(false);

  const onSort = (key: SortKey) => setSort((cur) => nextSort(cur, key));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((c) => {
      if (classFilter === "none" && c.class_id !== null) return false;
      if (classFilter !== "all" && classFilter !== "none" && c.class_id !== classFilter)
        return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        c.first_name,
        c.last_name,
        c.first_name_ar ?? "",
        c.last_name_ar ?? "",
        c.tag_code ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, classFilter, statusFilter]);

  const sorted = useMemo(() => {
    // Sorting reads what the ROW SHOWS, not what the database stores: the roster
    // displays Arabic names to an Arabic reader and a computed age rather than a
    // date of birth, so sorting the raw columns would order the list by values
    // nobody can see. Age is the exception that must not be sorted as text —
    // dob descending IS age ascending, and comparing "4 ans 5 mois" as a string
    // would put 10 before 2.
    const collated = filtered.map((c) => {
      const ar = locale === "ar" && c.first_name_ar && c.last_name_ar;
      return {
        row: c,
        child: ar ? `${c.first_name_ar} ${c.last_name_ar}` : `${c.first_name} ${c.last_name}`,
        age: -new Date(c.dob).getTime(),
        klass: (locale === "ar" && c.classNameAr ? c.classNameAr : c.className) ?? null,
        allergies: c.allergyCount,
        tag: c.tag_code,
        status: t(`status.${c.status}`),
      };
    });
    collated.sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.dir, locale));
    return collated.map((x) => x.row);
  }, [filtered, sort, locale, t]);

  // A withdrawn or archived child is still a record somebody has to reach —
  // they just should not be sitting alphabetically in the middle of the
  // register, nor counted as if they were still here. They get their own group
  // at the bottom, folded shut.
  //
  // Only when no status is being asked for: filtering ON "withdrawn" and then
  // hiding every withdrawn child would make the filter do nothing.
  const grouped = statusFilter === "all";
  const active = grouped ? sorted.filter((c) => c.status === "enrolled") : sorted;
  const former = grouped ? sorted.filter((c) => c.status !== "enrolled") : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("roster.searchPlaceholder")}
            className="ps-8"
            aria-label={t("roster.searchPlaceholder")}
          />
        </div>
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-44" aria-label={t("roster.filterClass")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("roster.allClasses")}</SelectItem>
            <SelectItem value="none">{t("roster.noClass")}</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {locale === "ar" && c.name_ar ? c.name_ar : c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" aria-label={t("roster.filterStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("roster.allStatuses")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("roster.count", { count: active.length })}
        </span>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
              <Search />
            </span>
          }
          title={t("roster.noMatch")}
          description={t("roster.noMatchDescription")}
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card
            className={cn(
              "hidden overflow-hidden py-0 shadow-sm md:block",
              active.length === 0 && "md:hidden"
            )}
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="[&>th]:font-semibold">
                    <SortableHeader columnKey="child" sort={sort} onSort={onSort}>
                      {t("roster.columns.child")}
                    </SortableHeader>
                    <SortableHeader columnKey="age" sort={sort} onSort={onSort}>
                      {t("roster.columns.age")}
                    </SortableHeader>
                    <SortableHeader columnKey="klass" sort={sort} onSort={onSort}>
                      {t("roster.columns.class")}
                    </SortableHeader>
                    <SortableHeader columnKey="allergies" sort={sort} onSort={onSort}>
                      {t("roster.columns.allergies")}
                    </SortableHeader>
                    <SortableHeader columnKey="tag" sort={sort} onSort={onSort}>
                      {t("roster.columns.tag")}
                    </SortableHeader>
                    <SortableHeader columnKey="status" sort={sort} onSort={onSort}>
                      {t("roster.columns.status")}
                    </SortableHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((c) => (
                    <TableRow key={c.id} className="relative transition-colors hover:bg-primary/5">
                      <TableCell>
                        <Link
                          href={`/children/${c.id}`}
                          className="flex items-center gap-3 after:absolute after:inset-0"
                        >
                          <ChildAvatar
                            firstName={c.first_name}
                            lastName={c.last_name}
                            photoUrl={c.photoUrl}
                            className="size-10"
                          />
                          <DualName child={c} locale={locale} />
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {ageFromDob(c.dob, locale)}
                      </TableCell>
                      <TableCell>
                        <ClassChip child={c} locale={locale} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <AllergyBadge child={c} />
                          <NoFeePlanBadge child={c} />
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.tag_code ? (
                          <span
                            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs tracking-wider text-muted-foreground"
                            dir="ltr"
                          >
                            {c.tag_code}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={childStatusClasses(c.status)}>
                          {t(`status.${c.status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {active.map((c) => (
              <ChildCard key={c.id} child={c} locale={locale} />
            ))}
          </div>

          {/* Former children — kept, reachable, and out of the register. */}
          {former.length > 0 && (
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setShowFormer((v) => !v)}
                aria-expanded={showFormer}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-start shadow-sm transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t("roster.former")}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t("roster.formerHint")}
                  </div>
                </div>
                <Badge className="bg-muted tabular-nums text-muted-foreground">
                  {former.length}
                </Badge>
                {/* Points down when shut, up when open — a vertical chevron
                    needs no RTL mirroring, unlike the back arrows. */}
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    showFormer && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
              {showFormer &&
                former.map((c) => <ChildCard key={c.id} child={c} locale={locale} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
