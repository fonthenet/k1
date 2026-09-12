"use client";

import { useTranslations } from "next-intl";
import { ClassChip } from "@/components/shared/class-chip";
import { ValueRange } from "@/components/shared/value-range";
import type { BusySlot } from "./room-state";

/**
 * The hover card of one block on the occupancy sheet (Classes › Salles).
 *
 * The sheet draws every booking of the building in one lane per room, so a
 * block may be a cours, a follow-up, an event or an activity: the card says
 * which, in the same anatomy as the timetable's LessonPreview — the title,
 * the clock, then one line of facts — so a director reads both sheets the
 * same way. A follow-up is named by the product's own noun, never by the
 * child, and its kind word is that noun (printing it twice says nothing).
 * Read-only by design: a pointer resting on a block must never change
 * anything, and the block itself is the link.
 */
export interface RoomOccupantPreviewProps {
  slot: BusySlot;
  /** The class the block belongs to, when the sheet knows its colour; falls back to the slot's own class name. */
  cls?: { name: string; color: string | null } | null;
}

export function RoomOccupantPreview({ slot, cls }: RoomOccupantPreviewProps) {
  const t = useTranslations("common");
  const tSessions = useTranslations("sessions");
  const isSession = slot.kind === "session";
  const title = isSession ? tSessions("title") : slot.title;
  const kind = isSession ? null : t(`rooms.kind.${slot.kind}`);
  const chip = cls ?? (slot.className ? { name: slot.className, color: null } : null);

  return (
    <div aria-hidden className="max-w-72">
      <bdi dir="auto" className="block min-w-0 text-start text-sm font-medium">
        {title}
      </bdi>
      {/* The lane already names the room and the sheet the day; only the clock is worth repeating. */}
      <p className="mt-0.5 text-xs text-muted-foreground">
        <ValueRange from={slot.start} to={slot.end} separator="–" className="tabular-nums" />
      </p>
      {(kind || chip) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {kind && <span>{kind}</span>}
          {chip && <ClassChip name={chip.name} color={chip.color} />}
        </div>
      )}
    </div>
  );
}
