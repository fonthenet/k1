"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, Star, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setClassStaff } from "./actions";
import type { AssignedStaff } from "./class-types";

/** One class a person already teaches, as the dialog names it. */
export interface StaffPlace {
  classId: string;
  /** Locale-resolved class name. */
  className: string;
  isMain: boolean;
  /**
   * The structure the class sits in. Null when the crèche runs a single
   * structure and the word would be the same on every line. A class that
   * belongs to the whole building in a multi-structure building carries the
   * building's label with no colour — NULL is an answer, not a gap.
   */
  structure: { name: string; color: string | null } | null;
}

/** A member of staff the dialog can put on the class. */
export interface AssignableStaff {
  membershipId: string;
  name: string;
  subtitle: string | null;
  /** Every OTHER class this person is on — the answer to "is she free?". */
  elsewhere: StaffPlace[];
  /**
   * Structures the person is assigned to DIRECTLY (0141), without a class —
   * the cook, the secretary. Shown after the classes so the director sees
   * where someone works even when they teach nowhere.
   */
  structures?: { name: string; color: string }[];
}

/**
 * Tick the people who run a class, and star the one who leads it.
 *
 * The old control was a single-select that added one person per round trip
 * and said nothing about the person being added. That is how the demo crèche
 * ended up with the same educator leading two rooms on opposite sides of the
 * building: the director could not see, while choosing, that Leïla was
 * already main on Petite Section. Every row here carries that answer.
 *
 * The whole team is saved in one action (setClassStaff), so the dialog is a
 * form with a Save button rather than a list of live toggles — a director who
 * ticks the wrong person can untick before anything is written.
 */
export function AssignStaffDialog({
  classId,
  className,
  staff,
  assigned,
  trigger = "button",
}: {
  classId: string;
  /** Locale-resolved class name, for the title. */
  className: string;
  staff: AssignableStaff[];
  assigned: AssignedStaff[];
  /** "button" is the labelled card button; "icon" is the compact card-corner one. */
  trigger?: "button" | "icon";
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [main, setMain] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A member on the class who is no longer active is not in `staff` (the
  // pages list active people only), so the list cannot show a row for them.
  // They stay on the class untouched rather than being silently dropped the
  // first time the director edits the team — taking them off is done from
  // their own file, where their status is visible.
  const invisible = assigned
    .filter((a) => !staff.some((s) => s.membershipId === a.membershipId))
    .map((a) => a.membershipId);

  function reset() {
    setSelected(
      new Set(assigned.map((s) => s.membershipId).filter((id) => !invisible.includes(id)))
    );
    setMain(assigned.find((s) => s.isMain)?.membershipId ?? null);
    setQuery("");
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      // Nobody leads a class they are not on.
      if (main === id) setMain(null);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.subtitle ?? "").toLowerCase().includes(q)
    );
  }, [staff, query]);

  // The current team on top, so what is about to change is visible without
  // scrolling — the list is alphabetical below that line.
  const ordered = useMemo(() => {
    const was = new Set(assigned.map((s) => s.membershipId));
    return [...visible].sort(
      (a, b) => Number(was.has(b.membershipId)) - Number(was.has(a.membershipId))
    );
  }, [visible, assigned]);

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const res = await setClassStaff(classId, [...selected, ...invisible], main);
      if (res.ok) {
        toast.success(t("toasts.staffSaved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger === "icon" ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            aria-label={t("assignStaff.open")}
            title={t("assignStaff.open")}
          >
            <UserRoundPlus />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <UserRoundPlus data-icon="inline-start" />
            {t("assignStaff.open")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("assignStaff.title", { name: className })}</DialogTitle>
          <DialogDescription>{t("assignStaff.description")}</DialogDescription>
        </DialogHeader>

        {staff.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("assignStaff.empty")}
          </p>
        ) : (
          <>
            {staff.length > 6 && (
              <div className="relative">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("assignStaff.search")}
                  className="ps-8"
                />
              </div>
            )}
            <ScrollArea className="max-h-[50vh] rounded-md border">
              <div className="divide-y">
                {ordered.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("assignStaff.noMatch")}
                  </p>
                )}
                {ordered.map((s) => {
                  const checked = selected.has(s.membershipId);
                  const isMain = main === s.membershipId;
                  return (
                    <div
                      key={s.membershipId}
                      className={cn(
                        "flex items-start gap-3 px-3 py-2.5 transition-colors",
                        checked ? "bg-primary/5" : "hover:bg-muted/40"
                      )}
                    >
                      {/* A label around the checkbox, avatar and name so the
                          whole row toggles; the star sits outside it so
                          starring does not also untick. */}
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <Checkbox
                          className="mt-2.5"
                          checked={checked}
                          onCheckedChange={() => toggle(s.membershipId)}
                        />
                        <Avatar className="size-9 shrink-0 ring-1 ring-border">
                          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                            {initialsFromName(s.name) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span dir="auto" className="block text-start text-sm font-semibold text-pretty">
                            {s.name}
                          </span>
                          {s.subtitle && (
                            <span dir="auto" className="block truncate text-start text-xs text-muted-foreground">
                              {s.subtitle}
                            </span>
                          )}
                          {s.elsewhere.length > 0 && (
                            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                              <span>{t("assignStaff.alreadyOn")}</span>
                              {s.elsewhere.map((p) => (
                                <span
                                  key={p.classId}
                                  className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-foreground/80"
                                >
                                  {p.isMain && (
                                    <Star
                                      className="size-3 fill-current text-gold"
                                      aria-label={t("detail.staff.main")}
                                    />
                                  )}
                                  {p.className}
                                  {p.structure && (
                                    <>
                                      <span aria-hidden className="text-muted-foreground">
                                        ·
                                      </span>
                                      {/* kg_structures.color is user data,
                                          hence the inline style. No dot for
                                          the whole building. */}
                                      {p.structure.color && (
                                        <span
                                          className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
                                          style={{ backgroundColor: p.structure.color }}
                                          aria-hidden
                                        />
                                      )}
                                      <span className="text-muted-foreground">
                                        {p.structure.name}
                                      </span>
                                    </>
                                  )}
                                </span>
                              ))}
                            </span>
                          )}
                          {(s.structures?.length ?? 0) > 0 && (
                            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                              <span>{t("assignStaff.worksIn")}</span>
                              {s.structures!.map((st) => (
                                <span
                                  key={st.name}
                                  className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-foreground/80"
                                >
                                  <span
                                    className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
                                    style={{ backgroundColor: st.color }}
                                    aria-hidden
                                  />
                                  {st.name}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </label>
                      {checked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "mt-1 size-8 shrink-0",
                            isMain
                              ? "text-gold hover:text-gold"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                          aria-pressed={isMain}
                          aria-label={isMain ? t("detail.staff.main") : t("detail.staff.makeMain")}
                          title={isMain ? t("detail.staff.main") : t("detail.staff.makeMain")}
                          onClick={() => setMain(isMain ? null : s.membershipId)}
                        >
                          <Star className={cn(isMain && "fill-current")} />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {main === null && selected.size > 0
                ? t("assignStaff.noMainHint")
                : t("assignStaff.mainHint")}
            </p>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || staff.length === 0}>
            {t("assignStaff.submit", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
