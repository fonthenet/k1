"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { School, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { groupClassesByStructure, structureLabel } from "@/lib/structure-groups";
import { cn } from "@/lib/utils";
import { ClassGlyph } from "@/components/modules/classes/class-icons";
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
 * asks when someone starts, leaves, or is moved across the building. The
 * dialog shows each class's current main educator so the director sees who
 * this person would be joining, and does not accidentally give a class two
 * heads: who leads a class is set from the class's own page.
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

  /** Structure heading: colour dot + name; only once the building has more than one. */
  const heading = (structure: (typeof myGroups)[number]["structure"]) =>
    single ? null : (
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {structure?.color && (
          // kg_structures.color is user data, hence the inline style.
          <span
            className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
            style={{ backgroundColor: structure.color }}
            aria-hidden
          />
        )}
        {structureLabel(structure, locale, whole)}
      </div>
    );

  return (
    <Card className="mb-6 border border-border shadow-sm ring-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <School className="size-4" />
          </span>
          {t("classes.title")}
          {myClasses.length > 0 && (
            <span className="tabular-nums text-muted-foreground">{myClasses.length}</span>
          )}
        </CardTitle>
        {canManage && (
          <CardAction>
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
                  <DialogTitle>{t("classes.dialogTitle", { name: memberName })}</DialogTitle>
                  <DialogDescription>{t("classes.dialogDescription")}</DialogDescription>
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
                          {!allSingle && (
                            <div className="bg-muted/40 px-3 py-1.5">{heading(g.structure)}</div>
                          )}
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
                                <ClassTile color={c.color} icon={c.icon} size="sm" />
                                <span className="min-w-0 flex-1">
                                  <span dir="auto" className="block truncate text-start text-sm font-medium">
                                    {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                                  </span>
                                  {/* Who leads it today — the person being
                                      added would work under them. When it is
                                      this very member, say so rather than
                                      printing their own name back. */}
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {leadsIt
                                      ? t("classes.youLead")
                                      : c.mainName
                                        ? t("classes.mainIs", { name: c.mainName })
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
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {myClasses.length === 0 ? (
          // No class is a legitimate answer for a cook or the director, so
          // this is a sentence, not an alarm.
          <p className="text-sm text-muted-foreground">{t("classes.empty")}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {myGroups.map((g) => (
              <div key={g.structure?.id ?? "building"} className="space-y-1.5">
                {heading(g.structure)}
                {g.classes.map((c) => (
                  <Link
                    key={c.id}
                    href={`/classes/${c.id}`}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-2.5 transition-colors hover:bg-primary/5",
                      mainOn.has(c.id) ? "border-gold/40 bg-gold/5" : "border-border"
                    )}
                  >
                    <ClassTile color={c.color} icon={c.icon} />
                    <span dir="auto" className="min-w-0 flex-1 truncate text-start text-sm font-semibold">
                      {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                    </span>
                    {mainOn.has(c.id) && (
                      <Badge className="shrink-0 border-transparent bg-gold font-medium text-gold-foreground">
                        <Star aria-hidden />
                        {t("classes.main")}
                      </Badge>
                    )}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The class's own colour as a tinted tile — the same treatment the classes pages use. */
function ClassTile({
  color,
  icon,
  size = "md",
}: {
  color: string;
  icon: string | null;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg text-foreground",
        size === "sm" ? "size-7" : "size-9"
      )}
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 20%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color} 45%, transparent)`,
      }}
      aria-hidden
    >
      <ClassGlyph icon={icon} className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}
