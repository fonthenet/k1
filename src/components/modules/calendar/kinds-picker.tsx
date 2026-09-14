"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KINDS_COOKIE, serializeKindsCookie, type CalendarKind, type CalendarScope, type CalendarView } from "@/lib/calendar";
import { cn } from "@/lib/utils";

export interface KindsPickerProps {
  /** Every kind the role may tick, in the picker's order; each is always listed. */
  eligible: CalendarKind[];
  kinds: CalendarKind[];
  /** Per kind, inside the view's window, ticked or not — the digits after each name. */
  counts: Record<CalendarKind, number>;
  /** The scope in force, written back into the cookie beside the kinds. */
  scope: CalendarScope;
  /** The view whose slot of the cookie this picker owns. */
  view: CalendarView;
  /** The noun the lesson row takes (spec D12). */
  profile: "academic" | "therapy" | "other";
  /** After the cookie is written: the page re-reads itself. */
  onChange: (kinds: CalendarKind[]) => void;
}

/**
 * The cookie is written here, in the browser, and nowhere else (decision
 * 10): a preference about what to look at is not a write the server needs to
 * hear of, and a server action for it would be a round trip before the round
 * trip that actually redraws the page. Session-scoped (no Max-Age) and
 * limited to /calendar, so the choice lasts the working day and leaks into
 * no other page's cookies. The value is URL-encoded because a comma is not a
 * cookie octet; `cookies()` decodes it on the way back.
 */
export function writeKindsCookie(scope: CalendarScope, kinds: CalendarKind[], view: CalendarView) {
  // Only this view's slot changes; the month keeps its list when the week
  // unticks a row (lib/calendar.ts explains why the views do not share one).
  const previous = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${KINDS_COOKIE}=`))
    ?.slice(KINDS_COOKIE.length + 1);
  const value = encodeURIComponent(
    serializeKindsCookie(scope, kinds, view, previous ? decodeURIComponent(previous) : undefined),
  );
  document.cookie = `${KINDS_COOKIE}=${value}; Path=/calendar; SameSite=Lax`;
}

/**
 * "Afficher": one popover of checkbox rows with counts. Every eligible kind
 * is listed even at zero (greyed), so a person is never left wondering
 * whether a kind exists; RLS decides what comes back. Applies on change,
 * like every filter of the product: there is nothing to submit. The
 * Mes cours / Tout track of a teacher sits beside it in the filter bar and
 * writes the same cookie.
 */
export function KindsPicker({ eligible, kinds, counts, scope, view, profile, onChange }: KindsPickerProps) {
  const t = useTranslations("comms.calendar");
  const id = useId();
  const ticked = new Set(kinds);

  function toggle(kind: CalendarKind, on: boolean) {
    const next = eligible.filter((k) => (k === kind ? on : ticked.has(k)));
    writeKindsCookie(scope, next, view);
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 font-normal">
          <span>{t("kinds.label")}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          {/* A ratio is an ltr island (brief A11), in every script. */}
          <span dir="ltr" className="tabular-nums text-muted-foreground">
            {kinds.length}/{eligible.length}
          </span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <ul className="grid gap-0.5" aria-label={t("kinds.label")}>
          {eligible.map((kind) => {
            const count = counts[kind] ?? 0;
            const rowId = `${id}-${kind}`;
            return (
              <li key={kind}>
                <label
                  htmlFor={rowId}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                    count === 0 && "text-muted-foreground",
                  )}
                >
                  <Checkbox id={rowId} checked={ticked.has(kind)} onCheckedChange={(v) => toggle(kind, v === true)} />
                  <span className="min-w-0 flex-1 truncate">{t(`kinds.${kind}`, { profile })}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">
                    {count}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
