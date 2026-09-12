"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import {
  SortableHeader, compareValues, nextSort, type SortState,
} from "@/components/shared/sortable-header";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { formatDate, formatTime, initials } from "@/lib/format";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { MEMBER_STATUS_TONE, ROLE_BADGE, STAFF_ROLES } from "./maps";
import type { MemberStatus, StaffRole } from "./staff-types";
import { StructureFilter } from "./structure-filter";

/** One member as the table needs it — resolved on the server, plain data here. */
export interface TeamRow {
  id: string;
  name: string;
  jobTitle: string | null;
  code: string | null;
  avatarUrl: string | null;
  role: StaffRole;
  status: MemberStatus;
  hireDate: string | null;
  /** Structure ids, in the building's own order. */
  structureIds: string[];
  today: { kind: "present" | "left" | "none"; at: string | null };
}

type SortKey = "name" | "role" | "hired";

const ROLE_RANK = new Map(STAFF_ROLES.map((r, i) => [r, i]));

/**
 * The team, drawn like the children roster: one filter bar, one card, one
 * table, the row is the link.
 *
 * The structure filter stays in the URL (and falls back to the rail's
 * switcher) because it changes WHO is on the list; search and role are
 * client-side because they only narrow what is already there. The Statut
 * column is gone — nine identical "Actif" pills said nothing — and a status
 * shows only when it deviates, under the name, where the job title lives.
 */
export function TeamRoster({
  rows,
  structures,
  structureFilter,
  showStructureFilter,
}: {
  rows: TeamRow[];
  structures: Structure[];
  /** "all" or a structure id — already applied to `rows` by the server. */
  structureFilter: string;
  /** False once the rail's switcher has narrowed the page: one question, one control. */
  showStructureFilter: boolean;
}) {
  const t = useTranslations("staff");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | StaffRole>("all");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "role", dir: "asc" });

  const manyStructures = structures.length > 1;
  const byId = new Map(structures.map((s) => [s.id, s]));

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    const filtered = rows.filter((r) => {
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (!q) return true;
      return [r.name, r.jobTitle ?? "", r.code ?? ""].some((v) =>
        v.toLocaleLowerCase(locale).includes(q)
      );
    });
    const key = (r: TeamRow): string | number | null => {
      if (sort.key === "name") return r.name;
      if (sort.key === "hired") return r.hireDate;
      return ROLE_RANK.get(r.role) ?? 99;
    };
    return [...filtered].sort((a, b) => {
      const out = compareValues(key(a), key(b), sort.dir, locale);
      // Names break the tie so a role sort is stable and readable.
      return out !== 0 ? out : compareValues(a.name, b.name, "asc", locale);
    });
  }, [rows, query, roleFilter, sort, locale]);

  const onSort = (k: SortKey) => setSort((s) => nextSort(s, k));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("team.searchPlaceholder")}
            className="ps-8"
            aria-label={t("team.searchPlaceholder")}
          />
        </div>
        {manyStructures && showStructureFilter && (
          <StructureFilter value={structureFilter} structures={structures} />
        )}
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as "all" | StaffRole)}>
          <SelectTrigger className="w-44" aria-label={t("team.filterRole")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("team.allRoles")}</SelectItem>
            {STAFF_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {t(`roles.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("team.count", { count: visible.length })}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Users />} title={t("team.noMatch")} description={t("team.noMatchHint")} />
      ) : (
        <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <SortableHeader columnKey="name" sort={sort} onSort={onSort}>
                    {t("team.columns.member")}
                  </SortableHeader>
                  <SortableHeader columnKey="role" sort={sort} onSort={onSort}>
                    {t("team.columns.role")}
                  </SortableHeader>
                  {manyStructures && (
                    <TableHead className="text-muted-foreground">{t("team.columns.structure")}</TableHead>
                  )}
                  <SortableHeader columnKey="hired" sort={sort} onSort={onSort}>
                    {t("team.columns.hireDate")}
                  </SortableHeader>
                  <TableHead className="text-muted-foreground">{t("team.columns.today")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((m) => {
                  const parts = m.name.split(" ");
                  const statusTone = MEMBER_STATUS_TONE[m.status];
                  const mine = m.structureIds
                    .map((id) => byId.get(id))
                    .filter((s): s is Structure => !!s);
                  return (
                    <TableRow
                      key={m.id}
                      className="relative h-14 transition-colors hover:bg-primary/5"
                    >
                      <TableCell>
                        <Link
                          href={`/staff/${m.id}`}
                          className="flex items-center gap-3 after:absolute after:inset-0"
                        >
                          <Avatar className="size-10 ring-1 ring-border">
                            <AvatarImage src={m.avatarUrl ?? undefined} alt="" />
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {initials(parts[0] ?? "", parts[1] ?? "")}
                            </AvatarFallback>
                          </Avatar>
                          <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-2">
                              <bdi dir="auto" className="truncate text-start font-semibold text-foreground">
                                {m.name}
                              </bdi>
                              {statusTone && (
                                <StatusPill tone={statusTone}>{t(`memberStatus.${m.status}`)}</StatusPill>
                              )}
                            </span>
                            {(m.jobTitle || m.code) && (
                              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                {m.jobTitle && (
                                  <bdi dir="auto" className="truncate text-start">
                                    {m.jobTitle}
                                  </bdi>
                                )}
                                {m.code && (
                                  <span dir="ltr" className="font-mono tracking-wider">
                                    {m.code}
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge className={ROLE_BADGE[m.role]}>{t(`roles.${m.role}`)}</Badge>
                      </TableCell>
                      {manyStructures && (
                        <TableCell>
                          {/* Every structure at once is the whole building — say so
                              in words rather than listing the building back. No
                              structure at all is the same fact (a cook, the owner:
                              nothing ticked means the whole building) and gets the
                              same words; a blank cell would read as "works nowhere". */}
                          {mine.length === 0 || mine.length === structures.length ? (
                            <span className="text-sm text-muted-foreground">
                              {t("classes.wholeBuilding")}
                            </span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap">
                              {mine.map((s, i) => (
                                <span key={s.id} className="inline-flex items-center gap-1.5">
                                  {i > 0 && <span className="text-muted-foreground" aria-hidden>·</span>}
                                  <StructureMark
                                    structure={{ name: structureName(s, locale), color: s.color }}
                                  />
                                </span>
                              ))}
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {m.hireDate ? formatDate(m.hireDate, locale) : "—"}
                      </TableCell>
                      <TableCell>
                        {/* Empty when not clocked in: the one or two pills of the
                            people who are here are then visible at a glance. */}
                        {m.today.kind === "present" ? (
                          <StatusPill tone="success">
                            <span aria-hidden className="size-1.5 rounded-full bg-success" />
                            {t("clock.presentSince", { time: formatTime(m.today.at!, locale) })}
                          </StatusPill>
                        ) : m.today.kind === "left" ? (
                          <StatusPill tone="muted">
                            {t("clock.leftAt", { time: formatTime(m.today.at!, locale) })}
                          </StatusPill>
                        ) : null}
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
