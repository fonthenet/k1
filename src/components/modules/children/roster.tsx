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
import { AlertTriangle, Search } from "lucide-react";
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
        <div className="truncate text-xs text-muted-foreground" dir="auto">
          {secondary}
        </div>
      )}
    </div>
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
          {t("roster.count", { count: sorted.length })}
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
          <Card className="hidden overflow-hidden py-0 shadow-sm md:block">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&>th]:font-semibold">
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
                  {sorted.map((c) => (
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
                        <AllergyBadge child={c} />
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
            {sorted.map((c) => (
              <Card
                key={c.id}
                className="relative py-0 shadow-sm transition-shadow hover:shadow-md"
              >
                <CardContent className="flex items-center gap-3 p-3.5">
                  <ChildAvatar
                    firstName={c.first_name}
                    lastName={c.last_name}
                    photoUrl={c.photoUrl}
                    className="size-12"
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/children/${c.id}`} className="after:absolute after:inset-0">
                      <DualName child={c} locale={locale} />
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {ageFromDob(c.dob, locale)}
                      </span>
                      <ClassChip child={c} locale={locale} />
                      <AllergyBadge child={c} />
                    </div>
                  </div>
                  <Badge className={childStatusClasses(c.status)}>{t(`status.${c.status}`)}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
