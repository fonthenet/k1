"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, School } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SectionCard } from "@/components/shared/section-card";
import { StructureMark } from "@/components/shared/structure-mark";
import { groupClassesByStructure, structureLabel } from "@/lib/structure-groups";
import { cn } from "@/lib/utils";
import type { Structure } from "@/components/modules/classes/class-types";
import { setStaffClasses } from "./actions";

/**
 * A class as this card and its dialog know it. A type alias rather than an
 * interface on purpose: groupClassesByStructure's row type carries an index
 * signature, which an alias satisfies implicitly and an interface does not.
 */
export type StaffClassOption = {
  id: string;
  name: string;
  name_ar: string | null;
  structure_id: string | null;
  color: string;
  icon: string | null;
  /** Resolved name of the class's current main educator, null if none. */
  mainName: string | null;
  mainMembershipId: string | null;
};

/**
 * The classes one member of staff is on, grouped by structure, with the
 * dialog that changes the list.
 *
 * The classes page answers "who runs this class?"; this card answers the
 * other question — "what does Leïla teach?" — which is the one a director
 * asks when someone starts, leaves, or is moved across the building. One
 * divided list, one line per class: the class's dot and name, then the
 * single gold-ink word "Principal" when this person leads it. The group
 * rows name the structure, so where the person works is said by the
 * classes themselves and needs no card of its own.
 *
 * The dialog shows each class's current main educator so the director sees
 * who this person would be joining, and does not accidentally give a class
 * two heads: who leads a class is set from the class's own page.
 */
export function StaffClassesCard({
  membershipId,
  memberName,
  mine,
  classes,
  structures,
  canManage,
}: {
  membershipId: string;
  memberName: string;
  /** The classes this member is on today, with whether they lead each. */
  mine: { classId: string; isMain: boolean }[];
  /** Every class in the building. */
  classes: StaffClassOption[];
  structures: Structure[];
  canManage: boolean;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const mainOn = new Set(mine.filter((m) => m.isMain).map((m) => m.classId));
  const mineIds = new Set(mine.map((m) => m.classId));
  const myClasses = classes.filter((c) => mineIds.has(c.id));

  const { groups: myGroups, single } = groupClassesByStructure(myClasses, structures);
  // Its own `single`: the dialog lists every class in the building, so its
  // headings depend on the building's grouping, not on this one person's.
  const { groups: allGroups, single: allSingle } = groupClassesByStructure(classes, structures);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const res = await setStaffClasses(membershipId, [...selected]);
      if (res.ok) {
        toast.success(t("classes.saved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("errors.forbidden") : t("errors.generic"));
      }
    });
  }

  const whole = t("classes.wholeBuilding");
  const className = (c: StaffClassOption) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);

  /** Group row: the structure's inline mark; plain text for the whole building. */
  const groupRow = (structure: (typeof myGroups)[number]["structure"]) => (
    <div className="bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
      {structure ? (
        <StructureMark
          structure={{ name: structureLabel(structure, locale, whole), color: structure.color ?? "var(--primary)" }}
          className="text-xs"
        />
      ) : (
        whole
      )}
    </div>
  );

  return (
    <SectionCard
      icon={School}
      tone={0}
      title={
        <span className="flex items-center gap-2">
          {t("classes.title")}
          {myClasses.length > 0 && (
            <span className="font-normal tabular-nums text-muted-foreground" dir="ltr">
              {myClasses.length}
            </span>
          )}
        </span>
      }
      hint={t("classes.hint")}
      className={cn("mb-6", myClasses.length > 0 && "pb-0")}
      contentClassName={myClasses.length > 0 ? "px-0" : undefined}
      action={
        canManage ? (
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (v) setSelected(new Set(mineIds));
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <School data-icon="inline-start" />
                {t("classes.assign")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("classes.title")}</DialogTitle>
                {/* The name on its own line, never inside a sentence: a name
                    ending in a Latin token would scramble an Arabic title. */}
                <DialogDescription>
                  <bdi dir="auto" className="block text-start font-medium text-foreground">
                    {memberName}
                  </bdi>
                  {t("classes.dialogHint")}
                </DialogDescription>
              </DialogHeader>
              {classes.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("classes.noneInBuilding")}
                </p>
              ) : (
                <ScrollArea className="max-h-[50vh] rounded-md border">
                  <div className="divide-y">
                    {allGroups.map((g) => (
                      <div key={g.structure?.id ?? "building"} className="divide-y">
                        {!allSingle && groupRow(g.structure)}
                        {g.classes.map((c) => {
                          const checked = selected.has(c.id);
                          const leadsIt = c.mainMembershipId === membershipId;
                          return (
                            <label
                              key={c.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors",
                                checked ? "bg-primary/5" : "hover:bg-muted/40"
                              )}
                            >
                              <Checkbox checked={checked} onCheckedChange={() => toggle(c.id)} />
                              <span className="min-w-0 flex-1">
                                <bdi dir="auto" className="block truncate text-start text-sm font-medium">
                                  {className(c)}
                                </bdi>
                                {/* Who leads it today — the person being
                                    added would work under them. When it is
                                    this very member, say so rather than
                                    printing their own name back. */}
                                <span className="block truncate text-xs text-muted-foreground">
                                  {leadsIt
                                    ? t("classes.leadsIt")
                                    : c.mainName
                                      ? t("classes.leadIs", { name: c.mainName })
                                      : t("classes.noMain")}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  {tc("actions.cancel")}
                </Button>
                <Button onClick={submit} disabled={pending || classes.length === 0}>
                  {t("classes.submit", { count: selected.size })}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : undefined
      }
    >
      {myClasses.length === 0 ? (
        // No class is a legitimate answer for a cook or the director, so
        // this is a sentence, not an alarm.
        <p className="text-sm text-muted-foreground">{t("classes.empty")}</p>
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {myGroups.map((g) => (
            <div key={g.structure?.id ?? "building"} className="divide-y divide-border">
              {!single && groupRow(g.structure)}
              {g.classes.map((c) => (
                <Link
                  key={c.id}
                  href={`/classes/${c.id}`}
                  className="flex h-11 items-center gap-3 px-4 transition-colors hover:bg-primary/5"
                >
                  {/* kg_classes.color is user data, hence the inline style. */}
                  <span
                    className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                    style={{ backgroundColor: c.color }}
                    aria-hidden
                  />
                  <bdi dir="auto" className="min-w-0 flex-1 truncate text-start text-sm font-medium">
                    {className(c)}
                  </bdi>
                  {mainOn.has(c.id) && (
                    <span className="shrink-0 text-xs font-medium text-gold-ink">{t("classes.lead")}</span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
