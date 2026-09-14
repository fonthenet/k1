"use client";

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronsDownUp, ChevronsUpDown, IdCard, MoreHorizontal, ScanLine, Search, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClassChip } from "@/components/shared/class-chip";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureGroupRow } from "@/components/shared/structure-group-row";
import type { StructureMarkData } from "@/components/shared/structure-mark";
import { formatDate, formatTime, intlLocale } from "@/lib/format";
import { useWedgeCapture } from "@/lib/tag-scan";
import { cn } from "@/lib/utils";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { revokeCard } from "@/components/modules/credentials/actions";
import { IssueCardDialog } from "@/components/modules/credentials/issue-card-dialog";
import { IssuedPinDialog } from "@/components/modules/credentials/issued-pin-dialog";
import type { CredentialSubject } from "@/components/modules/credentials/types";
import {
  issueByScan,
  issueGuardianPin,
  issueStaffPin,
  revokeGuardianPin,
  revokeStaffPin,
  type IssuedGuardianPin,
  type IssuedStaffPin,
  type PinError,
} from "./badges-actions";
import type { BadgeCard, BadgePerson } from "./badges-data";

/** The path every write from this page refreshes. */
const PATH = "/settings/badges";
/** Personne · Code imprimé · Code PIN · Cartes · Dernier passage · overflow. */
const COLUMNS = 6;
/** The roster's head style: sentence case, muted, never uppercase. */
const HEAD = "text-sm font-medium text-muted-foreground";
/** The three bands of the register, in the order the door meets them. */
const GROUPS: readonly CredentialSubject[] = ["child", "guardian", "staff"];
/** What the overflow can do to a PIN: the first when there is none, the other two when there is one. */
type PinAction = "generate" | "reset" | "remove";
/**
 * How the rows are banded. By family — a child, their siblings and their
 * adults in one block, the way the director meets them at the door; by
 * structure and class — a class's children with their parents, for handing
 * cards out class by class; by kind of person — the three bands the door
 * distinguishes.
 */
type GroupBy = "family" | "structure" | "type";
/** The four heads that sort. The PIN column is a yes/no and does not. */
type SortKey = "name" | "code" | "cards" | "lastPass";
type SortDir = "asc" | "desc";
type SortState = { key: SortKey; dir: SortDir };
/** Adults only: a child never holds a PIN, so either narrowing leaves the children out. */
type PinFilter = "all" | "with" | "without";

/** A band of the register: its own rows, then its sub-bands. */
interface RegisterGroup {
  key: string;
  /** Tinted band when a structure; the muted band otherwise. */
  structure: StructureMarkData | null;
  label: ReactNode;
  people: BadgePerson[];
  subgroups: RegisterGroup[];
}

function groupSize(g: RegisterGroup): number {
  return g.people.length + g.subgroups.reduce((n, sg) => n + groupSize(sg), 0);
}
function groupWithoutCard(g: RegisterGroup): number {
  return (
    g.people.filter((p) => p.cards.length === 0).length +
    g.subgroups.reduce((n, sg) => n + groupWithoutCard(sg), 0)
  );
}

/**
 * The order of a column. A person with nothing in the column — no printed
 * code, no card to pass — sits at the end whichever way the column is
 * sorted: there is nothing to rank them by. Ties fall back to the name.
 */
function compareBy({ key, dir }: SortState, collator: Intl.Collator) {
  const sign = dir === "asc" ? 1 : -1;
  const passRank = (p: BadgePerson): number | null =>
    p.cards.length === 0 ? null : p.lastUsedAt ? new Date(p.lastUsedAt).getTime() : 0;
  const primary = (a: BadgePerson, b: BadgePerson): number => {
    switch (key) {
      case "name":
        return sign * collator.compare(a.name, b.name);
      case "code":
        if (!a.code || !b.code) return a.code ? -1 : b.code ? 1 : 0;
        return sign * collator.compare(a.code, b.code);
      case "cards":
        return sign * (a.cards.length - b.cards.length);
      case "lastPass": {
        // Never passed ranks before the oldest pass: the card that has not
        // worked yet is the one to look at.
        const ra = passRank(a);
        const rb = passRank(b);
        if (ra === null || rb === null) return ra !== null ? -1 : rb !== null ? 1 : 0;
        return sign * (ra - rb);
      }
    }
  };
  return (a: BadgePerson, b: BadgePerson) => primary(a, b) || collator.compare(a.name, b.name);
}

/**
 * "il y a 2 j" / "2 days ago" / "قبل يومين" — the last pass, as a distance.
 *
 * `now` comes from the server render rather than Date.now() so the label the
 * server sent and the one the browser hydrates agree to the millisecond; a
 * register refreshing every action would otherwise warn on every load. Latin
 * digits are forced for Arabic, as everywhere else in the product.
 */
function relativePass(iso: string, now: number, locale: string): string {
  const f = new Intl.RelativeTimeFormat(`${intlLocale(locale)}-u-nu-latn`, {
    numeric: "auto",
    style: "short",
  });
  const minutes = Math.round(Math.max(0, now - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return f.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return f.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return f.format(-days, "day");
  if (days < 30) return f.format(-Math.round(days / 7), "week");
  const months = Math.round(days / 30);
  if (months < 12) return f.format(-months, "month");
  return f.format(-Math.round(months / 12), "year");
}

export interface BadgesRegisterProps {
  rows: BadgePerson[];
  /** Every active structure of the establishment; under two, no filter and no sub-groups. */
  structures: Structure[];
  /** Server time at render, for the relative "last pass" labels. */
  now: number;
  /** True once a live card exists — before that a band has no "without a card" count. */
  usesCards: boolean;
  title: string;
  description: string;
  /** The stat strip and the reader card, rendered between the header and the register. */
  above?: React.ReactNode;
  /** One outline action beside the page's primary — the print dialog's button. */
  headerAction?: React.ReactNode;
}

/**
 * Who holds a card and who does not, and the one way to hand cards out fast.
 *
 * The page's primary arms a scan mode: the director clicks a person, passes
 * a card over the reader, the card is theirs; the selection clears and she
 * clicks the next one. The header lives in this client component only so
 * that button and the mode it drives share one state — the stat strip and
 * the reader card come in as a slot from the server.
 */
export function BadgesRegister({
  rows,
  structures,
  now,
  usesCards,
  title,
  description,
  above,
  headerAction,
}: BadgesRegisterProps) {
  const t = useTranslations("settings.badges");
  const tCred = useTranslations("credentials");
  const tStaff = useTranslations("staff");
  const tChildren = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [structureFilter, setStructureFilter] = useState("all");
  const [withoutOnly, setWithoutOnly] = useState(false);
  const [pinFilter, setPinFilter] = useState<PinFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("family");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [armed, setArmed] = useState(false);
  const [selected, setSelected] = useState<BadgePerson | null>(null);
  const [issuing, setIssuing] = useState<BadgePerson | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const [pinConfirm, setPinConfirm] = useState<{ person: BadgePerson; action: PinAction } | null>(null);
  const [guardianPin, setGuardianPin] = useState<{ person: BadgePerson; pin: IssuedGuardianPin } | null>(null);
  const [staffPin, setStaffPin] = useState<{ person: BadgePerson; pin: IssuedStaffPin } | null>(null);
  const [pending, startTransition] = useTransition();

  const multiStructure = structures.length > 1;

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    return rows.filter((p) => {
      // A structure narrows the children and, through them, their parents:
      // a director handing cards to the préscolaire's families does not want
      // the crèche's ninety parents in between. The team has no structure
      // here and stays whole.
      if (
        structureFilter !== "all" &&
        p.subjectType !== "staff" &&
        !p.structureIds.includes(structureFilter)
      )
        return false;
      if (withoutOnly && p.cards.length > 0) return false;
      if (pinFilter !== "all" && (p.subjectType === "child" || p.hasPin !== (pinFilter === "with"))) return false;
      if (!q) return true;
      return [p.name, p.altName ?? "", p.code ?? "", ...p.children.map((c) => c.name)].some((v) =>
        v.toLocaleLowerCase(locale).includes(q)
      );
    });
  }, [rows, query, structureFilter, withoutOnly, pinFilter, locale]);

  const groups = useMemo<RegisterGroup[]>(() => {
    const collator = new Intl.Collator(locale);
    const cmp = compareBy(sort, collator);
    const sorted = (people: BadgePerson[]) => [...people].sort(cmp);
    const staff = sorted(visible.filter((p) => p.subjectType === "staff"));
    const staffGroup: RegisterGroup[] = staff.length
      ? [{ key: "staff", structure: null, label: t("groups.staff"), people: staff, subgroups: [] }]
      : [];
    const mark = (s: Structure): StructureMarkData => ({ name: structureName(s, locale), color: s.color });

    if (groupBy === "family") {
      // One block per household, children before their adults, the blocks
      // in the order of their first row — so sorting by "cards, none first"
      // brings the families without one to the top.
      const fams = new Map<string, { name: string | null; children: BadgePerson[]; guardians: BadgePerson[] }>();
      for (const p of visible) {
        if (p.subjectType === "staff") continue;
        const id = p.familyId ?? p.key;
        const f = fams.get(id) ?? { name: p.familyName, children: [], guardians: [] };
        (p.subjectType === "child" ? f.children : f.guardians).push(p);
        fams.set(id, f);
      }
      const familyGroups = [...fams.entries()].map(([id, f]) => {
        const people = [...sorted(f.children), ...sorted(f.guardians)];
        const name = f.name ?? people[0].name;
        return { key: `family:${id}`, structure: null, label: t("groups.family", { name }), people, subgroups: [], name };
      });
      familyGroups.sort((a, b) => cmp(a.people[0], b.people[0]) || collator.compare(a.name, b.name));
      return [...familyGroups, ...staffGroup];
    }

    if (groupBy === "structure") {
      // A class's children with their parents. A parent stands under each
      // class one of their children is in — read from the whole register,
      // not the filtered rows, so "without a card" still shows a parent
      // under their child's class when the child holds one.
      type Bucket = { children: BadgePerson[]; guardians: Map<string, BadgePerson> };
      const placeOf = new Map<string, string>();
      const classMeta = new Map<string, { name: string; color: string }>();
      for (const p of rows) {
        if (p.subjectType !== "child") continue;
        placeOf.set(p.id, `${p.structureIds[0] ?? ""}|${p.classId ?? ""}`);
        if (p.classId && p.klass) classMeta.set(p.classId, p.klass);
      }
      const buckets = new Map<string, Bucket>();
      const bucket = (place: string): Bucket => {
        const b: Bucket = buckets.get(place) ?? { children: [], guardians: new Map() };
        buckets.set(place, b);
        return b;
      };
      for (const p of visible) {
        if (p.subjectType === "child") bucket(placeOf.get(p.id)!).children.push(p);
        else if (p.subjectType === "guardian") {
          const places = new Set(p.children.map((c) => placeOf.get(c.id)).filter((x): x is string => !!x));
          if (places.size === 0) places.add("|");
          for (const place of places) bucket(place).guardians.set(p.key, p);
        }
      }
      const classGroups = (structureId: string): RegisterGroup[] => {
        const out: { name: string | null; group: RegisterGroup }[] = [];
        for (const [place, b] of buckets) {
          const [sid, cid] = place.split("|");
          if (sid !== structureId) continue;
          const klass = cid ? classMeta.get(cid) : undefined;
          out.push({
            name: klass?.name ?? null,
            group: {
              key: `class:${place}`,
              structure: null,
              label: klass ? <ClassChip name={klass.name} color={klass.color} /> : t("groups.noClass"),
              people: [...sorted(b.children), ...sorted([...b.guardians.values()])],
              subgroups: [],
            },
          });
        }
        // The classes by name; the children not yet placed in one last.
        out.sort((a, b) =>
          a.name === null || b.name === null ? (a.name === null ? 1 : -1) : collator.compare(a.name, b.name)
        );
        return out.map((x) => x.group);
      };
      const structureIds = [...structures.map((s) => s.id), ""];
      const byStructure: RegisterGroup[] = [];
      for (const sid of structureIds) {
        const classes = classGroups(sid);
        if (classes.length === 0) continue;
        if (!multiStructure) {
          byStructure.push(...classes);
          continue;
        }
        const structure = structures.find((s) => s.id === sid);
        byStructure.push({
          key: `structure:${sid || "building"}`,
          structure: structure ? mark(structure) : null,
          label: tc("structures.all"),
          people: [],
          subgroups: classes,
        });
      }
      return [...byStructure, ...staffGroup];
    }

    // By kind of person: the three bands, the children in their structures.
    const byKind = new Map<CredentialSubject, BadgePerson[]>(GROUPS.map((g) => [g, []]));
    for (const p of visible) byKind.get(p.subjectType)!.push(p);
    return GROUPS.flatMap((kind): RegisterGroup[] => {
      const people = byKind.get(kind)!;
      if (people.length === 0) return [];
      if (kind === "child" && multiStructure) {
        return [
          {
            key: kind,
            structure: null,
            label: t(`groups.${kind}`),
            people: [],
            subgroups: childrenByStructure(people, structures).map(({ structure, children }) => ({
              key: `${kind}:${structure?.id ?? "building"}`,
              structure: structure ? mark(structure) : null,
              label: tc("structures.all"),
              people: sorted(children),
              subgroups: [],
            })),
          },
        ];
      }
      return [{ key: kind, structure: null, label: t(`groups.${kind}`), people: sorted(people), subgroups: [] }];
    });
  }, [visible, rows, groupBy, sort, structures, multiStructure, locale, t, tc]);

  const topKeys = groups.map((g) => g.key);
  const anyCollapsed = topKeys.some((k) => collapsed.has(k));
  function toggleGroup(key: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setCollapsed(anyCollapsed ? new Set() : new Set(topKeys));
  }
  function toggleSort(key: SortKey) {
    setSort((cur) => ({ key, dir: cur.key === key && cur.dir === "asc" ? "desc" : "asc" }));
  }

  const renderGroup = (g: RegisterGroup, depth: number): ReactNode => {
    const folded = collapsed.has(g.key);
    const without = usesCards ? groupWithoutCard(g) : 0;
    return (
      <Fragment key={g.key}>
        <StructureGroupRow
          structure={g.structure}
          label={g.label}
          count={groupSize(g)}
          trailing={without > 0 ? t("groups.withoutCard", { count: without }) : undefined}
          collapsed={folded}
          onToggle={() => toggleGroup(g.key)}
          colSpan={COLUMNS}
          className={depth > 0 ? "[&>td]:ps-6" : undefined}
        />
        {!folded &&
          g.people.map((p) => (
            <PersonRow
              // A parent stands under each class of theirs, so the band is
              // part of the key; the selection is still the person's.
              key={`${g.key}/${p.key}`}
              person={p}
              now={now}
              armed={armed}
              selected={selected?.key === p.key}
              pending={pending}
              roleLabel={p.role ? tStaff(`roles.${p.role}`) : null}
              showClass={groupBy !== "structure"}
              onSelect={() => setSelected((cur) => (cur?.key === p.key ? null : p))}
              onIssue={() => openIssue(p)}
              onRevoke={revoke}
              onPin={(action) => askPin(p, action)}
            />
          ))}
        {!folded && g.subgroups.map((sg) => renderGroup(sg, depth + 1))}
      </Fragment>
    );
  };

  // The listener is attached only while the mode is on, and steps aside
  // while the issue dialog is open: a burst typed into that dialog's field
  // is the dialog's. The hook keeps the latest handler itself, so this one
  // may simply close over the current selection.
  const scanning = armed && !issueOpen;
  useWedgeCapture((value: string) => {
    if (!selected) {
      toast(t("scan.selectFirst"));
      return;
    }
    const person = selected;
    startTransition(async () => {
      const res = await issueByScan({
        subjectType: person.subjectType,
        subjectId: person.id,
        value,
      });
      if (res.ok) {
        toast.success(
          t.rich("scan.issuedTo", {
            name: () => (
              <bdi dir="auto" className="font-semibold">
                {person.name}
              </bdi>
            ),
          })
        );
        setSelected(null);
        router.refresh();
      } else {
        toast.error(tCred(`errors.${res.error}`));
      }
    });
  }, scanning);

  function arm() {
    // The reader test's field may hold the focus; a burst typed into a field
    // is that field's, so the focus has to leave it before scan mode can
    // hear anything.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setArmed(true);
    setSelected(null);
  }
  function disarm() {
    setArmed(false);
    setSelected(null);
  }

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") disarm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  function openIssue(person: BadgePerson) {
    setIssuing(person);
    setOpening((n) => n + 1);
    setIssueOpen(true);
  }

  function revoke(card: BadgeCard) {
    startTransition(async () => {
      const res = await revokeCard({ id: card.id, path: PATH });
      if (res.ok) {
        toast.success(tCred("toasts.revoked"));
        router.refresh();
      } else {
        toast.error(tCred(`errors.${res.error}`));
      }
    });
  }

  function pinFail(error: PinError) {
    toast.error(tChildren(error === "forbidden" ? "toasts.forbidden" : "toasts.error"));
  }

  /**
   * A PIN is a column of its own for both kinds of person — a parent's comes
   * from kg_issue_guardian_pin, which leaves the printed tag alone — so a
   * first PIN is issued on the click; only replacing or removing one asks,
   * with the consequence in one sentence.
   */
  function askPin(person: BadgePerson, action: PinAction) {
    if (action === "generate") runPin(person, action);
    else setPinConfirm({ person, action });
  }

  function runPin(person: BadgePerson, action: PinAction) {
    startTransition(async () => {
      if (person.subjectType === "guardian") {
        const childIds = person.children.map((c) => c.id);
        if (action === "remove") {
          const res = await revokeGuardianPin(person.id, childIds);
          if (!res.ok) {
            pinFail(res.error);
            return;
          }
          toast.success(t("pin.removed"));
        } else {
          const res = await issueGuardianPin(person.id, childIds);
          if (!res.ok) {
            pinFail(res.error);
            return;
          }
          setGuardianPin({ person, pin: res.data });
        }
      } else if (person.subjectType === "staff") {
        if (action === "remove") {
          const res = await revokeStaffPin(person.id);
          if (!res.ok) {
            pinFail(res.error);
            return;
          }
          toast.success(t("pin.removed"));
        } else {
          const res = await issueStaffPin(person.id);
          if (!res.ok) {
            pinFail(res.error);
            return;
          }
          setStaffPin({ person, pin: res.data });
        }
      }
      router.refresh();
    });
  }

  const empty = rows.length === 0;

  return (
    <div>
      <PageHeader title={title} description={description}>
        {headerAction}
        {armed ? (
          <Button variant="outline" onClick={disarm} aria-pressed>
            <X data-icon="inline-start" aria-hidden />
            {t("scan.stop")}
          </Button>
        ) : (
          <Button onClick={arm} disabled={empty}>
            <ScanLine data-icon="inline-start" aria-hidden />
            {t("scan.start")}
          </Button>
        )}
      </PageHeader>

      <div className="space-y-6">
        {above}

        {empty ? (
          <EmptyState icon={<IdCard />} title={t("empty")} description={t("emptyHint")} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
              <div className="relative min-w-52 flex-1">
                <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("filter.search")}
                  className="ps-8"
                  aria-label={t("filter.search")}
                />
              </div>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
                <SelectTrigger className="w-44" aria-label={t("groupBy.label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="family">{t("groupBy.family")}</SelectItem>
                  <SelectItem value="structure">{t(multiStructure ? "groupBy.structure" : "groupBy.klass")}</SelectItem>
                  <SelectItem value="type">{t("groupBy.type")}</SelectItem>
                </SelectContent>
              </Select>
              {multiStructure && (
                <Select value={structureFilter} onValueChange={setStructureFilter}>
                  <SelectTrigger className="w-40" aria-label={t("filter.structure")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("filter.allStructures")}</SelectItem>
                    {structures.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {structureName(s, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/* A filter, not a status: on, it wears the selection's mark —
                  the primary border — and no fill, so the count chip beside
                  it stays the only tinted thing in the bar. */}
              <Button
                variant="outline"
                aria-pressed={withoutOnly}
                onClick={() => setWithoutOnly((v) => !v)}
                className="rounded-full aria-pressed:border-primary aria-pressed:text-primary"
              >
                {t("filter.withoutCard")}
              </Button>
              <Select value={pinFilter} onValueChange={(v) => setPinFilter(v as PinFilter)}>
                <SelectTrigger
                  className={cn("w-40 rounded-full", pinFilter !== "all" && "border-primary text-primary")}
                  aria-label={t("filter.pin.label")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter.pin.all")}</SelectItem>
                  <SelectItem value="with">{t("filter.pin.with")}</SelectItem>
                  <SelectItem value="without">{t("filter.pin.without")}</SelectItem>
                </SelectContent>
              </Select>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
                {t("filter.count", { count: visible.length })}
              </span>
            </div>

            {armed && (
              <p
                role="status"
                className="flex items-center gap-2 px-1 text-sm font-medium text-gold-ink"
              >
                <ScanLine className="size-4 shrink-0" aria-hidden />
                <span>
                  {selected
                    ? t.rich("scan.passCard", {
                        name: () => <bdi dir="auto">{selected.name}</bdi>,
                      })
                    : t("scan.selectPerson")}
                </span>
                <span className="ms-auto text-xs font-normal text-muted-foreground">
                  {t("scan.escape")}
                </span>
              </p>
            )}

            {visible.length === 0 ? (
              <EmptyState icon={<Search />} title={t("noMatch")} description={t("noMatchHint")} />
            ) : (
              <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
                <CardContent className="overflow-x-auto p-0">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <SortHead column="name" sort={sort} onSort={toggleSort}>
                          {t("columns.person")}
                        </SortHead>
                        <SortHead column="code" sort={sort} onSort={toggleSort}>
                          {t("columns.code")}
                        </SortHead>
                        <TableHead className={HEAD}>{t("pin.column")}</TableHead>
                        <SortHead column="cards" sort={sort} onSort={toggleSort}>
                          {t("columns.cards")}
                        </SortHead>
                        <SortHead column="lastPass" sort={sort} onSort={toggleSort}>
                          {t("columns.lastPass")}
                        </SortHead>
                        {/* The fold-all control sits over the column of the
                            bands' chevrons, not in the filter bar — there it
                            was one orphan button on a second line. */}
                        <TableHead className="w-12 text-end">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={toggleAll}
                            aria-label={t(anyCollapsed ? "groups.expandAll" : "groups.collapseAll")}
                            title={t(anyCollapsed ? "groups.expandAll" : "groups.collapseAll")}
                            className="text-muted-foreground"
                          >
                            {anyCollapsed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
                          </Button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{groups.map((g) => renderGroup(g, 0))}</TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Keyed on each opening so the field starts empty for every person:
          a number half-typed for one parent must not be waiting when the
          dialog opens for the next. */}
      {issuing && (
        <IssueCardDialog
          key={`${issuing.key}:${opening}`}
          subjectType={issuing.subjectType}
          subjectId={issuing.id}
          open={issueOpen}
          onOpenChange={setIssueOpen}
          path={PATH}
          personName={issuing.name}
        />
      )}

      {/* The consequence of a PIN action, stated once before it is written.
          Radix closes the dialog on the action itself; the transition it
          starts keeps its own copy of the person. */}
      <AlertDialog
        open={pinConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPinConfirm(null);
        }}
      >
        <AlertDialogContent>
          {pinConfirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t.rich(`pin.confirm.${pinConfirm.person.subjectType}.${pinConfirm.action}.title`, {
                    name: () => <bdi dir="auto">{pinConfirm.person.name}</bdi>,
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t.rich(
                    `pin.confirm.${pinConfirm.person.subjectType}.${pinConfirm.action}.description`,
                    { b: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong> }
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">{tc("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="min-h-11"
                  onClick={() => runPin(pinConfirm.person, pinConfirm.action)}
                >
                  {t(`pin.${pinConfirm.action}`)}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* The PIN, shown once, in the register's own words for both kinds of
          person; the printed code beside it is the one they already hold. */}
      <IssuedPinDialog
        issued={guardianPin ? { pinCode: guardianPin.pin.pinCode, code: guardianPin.pin.tagCode } : null}
        onClose={() => setGuardianPin(null)}
        title={t("pin.issued.title")}
        description={
          guardianPin
            ? t.rich("pin.issued.description", {
                name: () => <bdi dir="auto">{guardianPin.person.name}</bdi>,
              })
            : null
        }
        warning={t("pin.issued.warning")}
        codeLabel={tChildren("guardians.credentials.tagLabel")}
        printHref={
          guardianPin?.pin.tagCode && guardianPin.person.children[0]
            ? `/children/${guardianPin.person.children[0].id}/guardian/${guardianPin.person.id}/badge`
            : null
        }
      />
      <IssuedPinDialog
        issued={staffPin ? { pinCode: staffPin.pin.pinCode, code: staffPin.pin.staffCode } : null}
        onClose={() => setStaffPin(null)}
        title={t("pin.issued.title")}
        description={
          staffPin
            ? t.rich("pin.issued.description", {
                name: () => <bdi dir="auto">{staffPin.person.name}</bdi>,
              })
            : null
        }
        warning={t("pin.issued.warning")}
        codeLabel={tStaff("local.staffCode")}
        printHref={staffPin?.pin.staffCode ? `/staff/${staffPin.person.id}/badge` : null}
      />
    </div>
  );
}

/**
 * The children of the register in the building's own order of structures,
 * with a trailing group for a child not yet placed in one (approved, no
 * class) — they belong to the whole building until they do.
 */
function childrenByStructure(children: BadgePerson[], structures: Structure[]) {
  const groups = structures.map((s) => ({ structure: s as Structure | null, children: [] as BadgePerson[] }));
  const byId = new Map(groups.map((g) => [g.structure!.id, g]));
  const building = { structure: null as Structure | null, children: [] as BadgePerson[] };
  for (const c of children) {
    const g = c.structureIds[0] ? byId.get(c.structureIds[0]) : undefined;
    (g ?? building).children.push(c);
  }
  const out = groups.filter((g) => g.children.length > 0);
  if (building.children.length > 0) out.push(building);
  return out;
}

/**
 * A head that sorts its column: the whole head is the button, the arrow
 * says which way, and the head's `aria-sort` says it to a screen reader.
 * An idle head shows its two-way arrow only under the pointer.
 */
function SortHead({
  column,
  sort,
  onSort,
  children,
}: {
  column: SortKey;
  sort: SortState;
  onSort: (column: SortKey) => void;
  children: ReactNode;
}) {
  const active = sort.key === column;
  return (
    <TableHead
      className={cn(HEAD, "p-0")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "group flex h-10 w-full cursor-pointer items-center gap-1 px-2 text-start outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
          active && "text-foreground"
        )}
      >
        {children}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <ArrowDown className="size-3.5 shrink-0" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}

function PersonRow({
  person: p,
  now,
  armed,
  selected,
  pending,
  roleLabel,
  showClass,
  onSelect,
  onIssue,
  onRevoke,
  onPin,
}: {
  person: BadgePerson;
  now: number;
  armed: boolean;
  selected: boolean;
  pending: boolean;
  roleLabel: string | null;
  /** Off when the band above already names the class. */
  showClass: boolean;
  onSelect: () => void;
  onIssue: () => void;
  onRevoke: (card: BadgeCard) => void;
  onPin: (action: PinAction) => void;
}) {
  const t = useTranslations("settings.badges");
  const tCred = useTranslations("credentials");
  const locale = useLocale();

  const name = (
    <bdi dir="auto" className="truncate text-start font-semibold text-foreground">
      {p.name}
    </bdi>
  );

  return (
    <TableRow
      tabIndex={armed ? 0 : undefined}
      onClick={armed ? onSelect : undefined}
      onKeyDown={
        armed
          ? (e) => {
              // Space only: Enter is how the reader ends its burst, and a
              // burst typed while this row has the focus must not toggle it.
              if (e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      className={cn(
        "relative h-14 transition-colors hover:bg-primary/5",
        armed && "cursor-pointer",
        // Selected = the 2px primary border and nothing else. An outline
        // rather than a ring: table rows have no box of their own for a
        // shadow to hug, and an outline follows the row's cells.
        selected && "outline-2 -outline-offset-2 outline-primary"
      )}
    >
      <TableCell>
        {/* Outside scan mode the row is the door to the record; inside it a
            click selects, so the link steps aside rather than fight it. */}
        {p.href && !armed ? (
          <Link href={p.href} className="flex items-center gap-3 after:absolute after:inset-0">
            <PersonAvatar person={p} />
            <PersonText person={p} name={name} roleLabel={roleLabel} showClass={showClass} />
          </Link>
        ) : (
          <span className="flex items-center gap-3">
            <PersonAvatar person={p} />
            <PersonText person={p} name={name} roleLabel={roleLabel} showClass={showClass} />
          </span>
        )}
      </TableCell>
      <TableCell>
        {p.code ? (
          <span dir="ltr" className="font-mono text-xs tracking-wider text-muted-foreground">
            {p.code}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {/* The fact and nothing but the fact: a PIN exists or it does not.
            Its value was shown once, when it was handed over. */}
        {p.hasPin ? t("pin.set") : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {p.cards.length === 0 ? (
          p.familyWithoutCard ? (
            <StatusPill tone="attention">{t("familyWithoutCard")}</StatusPill>
          ) : (
            <span className="text-muted-foreground">{t("noCard")}</span>
          )
        ) : (
          <span className="tabular-nums">{t("cardCount", { count: p.cards.length })}</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {p.cards.length === 0 ? (
          "—"
        ) : p.lastUsedAt ? (
          <span title={`${formatDate(p.lastUsedAt, locale)} · ${formatTime(p.lastUsedAt, locale)}`}>
            {relativePass(p.lastUsedAt, now, locale)}
          </span>
        ) : (
          tCred("neverUsed")
        )}
      </TableCell>
      <TableCell className="text-end">
        {/* Above the row-wide link, and its clicks kept to itself: the menu
            portals its items but React still bubbles their clicks up to the
            row, which in scan mode would select whoever's card is being
            revoked. */}
        <span className="relative z-10 inline-flex" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("more")} disabled={pending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onIssue}>{tCred("scan.title")}</DropdownMenuItem>
              {/* Adults only: a child is recognised by a card or a printed
                  code, never by a number to remember. */}
              {p.subjectType !== "child" && (
                <>
                  <DropdownMenuSeparator />
                  {p.hasPin ? (
                    <>
                      <DropdownMenuItem onSelect={() => onPin("reset")}>{t("pin.reset")}</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => onPin("remove")}>
                        {t("pin.remove")}
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onSelect={() => onPin("generate")}>{t("pin.generate")}</DropdownMenuItem>
                  )}
                </>
              )}
              {p.cards.length > 0 && <DropdownMenuSeparator />}
              {p.cards.map((card) => (
                <DropdownMenuItem key={card.id} variant="destructive" onSelect={() => onRevoke(card)}>
                  {tCred("revoke")}
                  <span className="text-muted-foreground" aria-hidden>
                    ·
                  </span>
                  <span dir="ltr" className="font-mono text-xs">
                    {card.value}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </TableCell>
    </TableRow>
  );
}

function PersonAvatar({ person: p }: { person: BadgePerson }) {
  return (
    <Avatar className="size-10 ring-1 ring-border">
      {p.photoUrl && <AvatarImage src={p.photoUrl} alt="" />}
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
        {p.initials}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Name, then what places the person: a child's class, a parent's children,
 * a colleague's role. The other script sits muted underneath, as on the
 * roster.
 */
function PersonText({
  person: p,
  name,
  roleLabel,
  showClass,
}: {
  person: BadgePerson;
  name: React.ReactNode;
  roleLabel: string | null;
  showClass: boolean;
}) {
  // `items-start`: each line is sized to its own text, so the other script
  // sits under the name rather than at the far end of whatever width the
  // chips beside the name gave the column.
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {name}
        {showClass && p.klass && <ClassChip name={p.klass.name} color={p.klass.color} />}
        {p.children.map((c) => (
          <Badge key={c.id} variant="outline" className="bg-muted/50 font-normal">
            <bdi dir="auto">{c.name}</bdi>
          </Badge>
        ))}
      </span>
      {(p.altName || roleLabel) && (
        <span className="text-start text-xs text-muted-foreground" dir="auto">
          {p.altName ?? roleLabel}
        </span>
      )}
    </span>
  );
}
