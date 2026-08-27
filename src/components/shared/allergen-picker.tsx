"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ALLERGENS, allergenKeyFor } from "@/lib/allergens";

/**
 * Choose one allergen, or write your own.
 *
 * This replaced a bare text box on all four places an allergy can be recorded
 * — the enrolment wizard, the sibling flow, the parent portal and the office.
 * A text box let three people write "Lait", "Milk" and "حليب" for the same
 * thing, and the kitchen's menu check only ever recognised one of them. A pick
 * stores one canonical value that every side agrees on, and reads back in
 * whichever language the person looking at it uses.
 *
 * "Other" stays, and stays free text: a list that cannot express a child's
 * actual allergy is more dangerous than an untidy one, so the tail is always
 * open. What is typed there is still matched by synonym, so "Milk" typed today
 * still meets a menu that says lait.
 *
 * Chips rather than a <select> because this is answered on a phone, often by a
 * parent in a hurry, and everything worth choosing should be visible at once —
 * a closed dropdown hides exactly the item somebody would otherwise not think
 * to record.
 */
export function AllergenPicker({
  id,
  value,
  onChange,
  autoFocusOther = false,
}: {
  /** Ties the group to its <Label> and gives the "other" input a stable id. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocusOther?: boolean;
}) {
  const t = useTranslations("common");

  // A value nobody offered means the row came from free text — show it in the
  // "other" box rather than silently dropping it on the next save.
  const unlisted = value.trim().length > 0 && allergenKeyFor(value) === null;
  const [otherOpen, setOtherOpen] = useState(unlisted);
  const showOther = otherOpen || unlisted;

  function pick(next: string) {
    setOtherOpen(false);
    onChange(next === value ? "" : next);
  }

  const groups = [
    { group: "food" as const, label: t("allergens.groupFood") },
    { group: "other" as const, label: t("allergens.groupOther") },
  ];

  return (
    <div className="grid gap-3" role="group" aria-labelledby={id}>
      {groups.map(({ group, label }) => (
        <div key={group} className="grid gap-1.5">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGENS.filter((a) => a.group === group).map((a) => {
              const active = !showOther && value === a.value;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => pick(a.value)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    // An allergy is a safety signal, not a preference: the
                    // chosen chip carries the same destructive tint it will
                    // have everywhere else it appears.
                    active
                      ? "border-transparent bg-destructive/10 text-destructive"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  {active && <Check className="size-3.5" aria-hidden />}
                  {t(`allergens.${a.key}`)}
                </button>
              );
            })}

            {group === "other" && (
              <button
                type="button"
                onClick={() => {
                  setOtherOpen(true);
                  if (!unlisted) onChange("");
                }}
                aria-pressed={showOther}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  showOther
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {showOther && <Check className="size-3.5" aria-hidden />}
                {t("allergens.other")}
              </button>
            )}
          </div>
        </div>
      ))}

      {showOther && (
        <Input
          id={`${id}-other`}
          className="h-11 text-base"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("allergens.otherPlaceholder")}
          aria-label={t("allergens.other")}
          autoComplete="off"
          autoFocus={autoFocusOther}
        />
      )}
    </div>
  );
}
