"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { normalizeAllergen } from "@/lib/allergens";

/**
 * What a child's allergy actually does to them — picked, not typed.
 *
 * The same nine answers the mobile app offers (`components/health-editors.tsx`),
 * in the same order, under the same keys. Both apps write into the same
 * `kg_child_allergies.reaction` column, so the lists have to be one list: a
 * reaction recorded on a parent's phone and one recorded at the office desk
 * should be the same string, not two spellings of it.
 *
 * `other` stays open. A list that cannot say what happens to this particular
 * child is worse than an untidy record, and this is the field a nurse reads
 * first — so anything unlisted survives verbatim rather than being rounded to
 * the nearest entry.
 */
const REACTIONS = [
  "rash", "hives", "swelling", "breathing", "vomiting", "diarrhoea", "cough",
  "eyes", "anaphylaxis",
] as const;

/** Not a stored value — the sentinel that reveals the free-text box. */
const REACTION_OTHER = "other";

/**
 * Which list entry a stored reaction is, or null when it is somebody's words.
 *
 * The stored value is the LOCALIZED LABEL, not the key. That is what mobile
 * writes, and what every row typed by hand before either picker existed
 * contains, so matching on the label is the only test that recognises all
 * three at once. Storing keys instead would have meant rewriting live rows.
 *
 * Matched through `normalizeAllergen` rather than a locale compare: it also
 * rescues "Eruption cutanee" typed without its accents, which is how a French
 * reaction reaches us from a keyboard that has none.
 */
function reactionKeyFor(value: string, t: (key: string) => string): string | null {
  const v = normalizeAllergen(value);
  if (!v) return null;
  return REACTIONS.find((k) => normalizeAllergen(t(`reactions.${k}`)) === v) ?? null;
}

/**
 * Pick a reaction, or describe one.
 *
 * A dropdown, not the chip grid the allergen uses. The allergen is the safety
 * signal — it carries the destructive tint everywhere it appears, and it is
 * spent once. The reaction is optional, single-answer and sits directly under
 * a severity control that is already a `Select` (or a radio row) on all four
 * surfaces, so a select is this repo's own idiom for the question.
 *
 * The translator arrives as a prop, the way `allergenLabel` takes one: the
 * four call sites live in three different namespaces (`children.allergies`,
 * `enroll.health`, `portal.child.health`), each holding its own verbatim copy
 * of the vocabulary, so the component cannot pick a namespace for them. `t`
 * must resolve `t("reactions.<key>")` and `t("otherLabel")`.
 */
export function ReactionPicker({
  id,
  value,
  onChange,
  t,
  placeholder,
  className,
}: {
  /** Ties the trigger to its <Label> and gives the "other" box a stable id. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  t: (key: string) => string;
  placeholder?: string;
  className?: string;
}) {
  const listed = reactionKeyFor(value, t);

  // A row written on an Arabic phone, or before the list existed, opens on
  // "Other…" with its text intact — the list is never allowed to blank it.
  // `freeOpen` is separate so that choosing "Other…" and clearing the box does
  // not make the box disappear from under the cursor.
  const [freeOpen, setFreeOpen] = useState(() => value.trim().length > 0 && listed === null);
  const showFree = freeOpen || (value.trim().length > 0 && listed === null);

  return (
    <div className="grid gap-2">
      <Select
        // `undefined`, never "": Radix forbids an empty item value, and it is
        // what lets the placeholder show at all.
        value={showFree ? REACTION_OTHER : (listed ?? undefined)}
        onValueChange={(next) => {
          if (next === REACTION_OTHER) {
            setFreeOpen(true);
            onChange("");
            return;
          }
          setFreeOpen(false);
          // Store the label, not the key — see reactionKeyFor above.
          onChange(t(`reactions.${next}`));
        }}
      >
        {/* w-full rather than the trigger's default w-fit: the answers run
            from "Hives" to "Difficulty breathing", and a trigger that resizes
            under the pointer as you scroll the list is unusable on a phone. */}
        <SelectTrigger id={id} className={cn("w-full", className)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {REACTIONS.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`reactions.${k}`)}
            </SelectItem>
          ))}
          <SelectItem value={REACTION_OTHER}>{t("reactions.other")}</SelectItem>
        </SelectContent>
      </Select>

      {showFree && (
        // No dir="ltr" here: a reaction is prose in whichever language it was
        // written in, so an isolate would be wrong (unlike a time or a phone).
        <Input
          id={`${id}-other`}
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t("otherLabel")}
          placeholder={placeholder}
          autoComplete="off"
        />
      )}
    </div>
  );
}
