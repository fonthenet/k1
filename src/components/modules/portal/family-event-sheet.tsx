"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EventSheet } from "@/components/modules/comms/event-sheet";
import type { EventDetail } from "@/components/modules/comms/types";
import { respondToEvent } from "./actions";
import type { FamilyEvent, FamilyResponse } from "./calendar-data";

/**
 * The event as the family reads it: D's card in D's bottom sheet, with the
 * RSVP block underneath ("J'y serai" / "Absent", a word for the team) and
 * "Ajouter à mon agenda", which builds the .ics in the browser. The sheet is
 * the one door an event has on the portal — the agenda row, the month's
 * pill and the notification's deep link all open it.
 *
 * The write happens here (respondToEvent, one row per person — decision 8)
 * and so do the two toasts: "Réponse enregistrée", or the portal's error
 * toast when the database refused the row — the event started between the
 * render and the tap, or the family is no longer in its audience. The card
 * itself never toasts and never reads a clock: the "not started" gate takes
 * the server's `now`.
 */
export function FamilyEventSheet({
  event,
  myResponse,
  open,
  onOpenChange,
  onAnswered,
  now,
  locale,
  tenantName,
}: {
  event: FamilyEvent | null;
  myResponse: FamilyResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Told after the database accepted an answer, so the caller's copy of it moves too. */
  onAnswered: (eventId: string, response: FamilyResponse) => void;
  /** Server ISO — gates the RSVP buttons. */
  now: string;
  locale: string;
  /** The establishment's name, the calendar name inside the .ics. */
  tenantName: string;
}) {
  const t = useTranslations("portal.calendar.event");
  const ta = useTranslations("comms.audience");
  const tc = useTranslations("common");

  // The audience as a phrase: the class's name, the structure's (drawn as
  // the mark by the card), or the audience word for everyone / the parents.
  const detail: EventDetail | null = event
    ? {
        ...event,
        audienceLabel:
          event.audience === "class" && event.className
            ? event.className
            : event.audience === "structure" && event.structure
              ? event.structure.name
              : ta(event.audience),
      }
    : null;

  async function respond(response: "going" | "not_going", note: string) {
    if (!event) return;
    const res = await respondToEvent(event.id, response, note);
    if (res.ok) {
      onAnswered(event.id, { response, note: note || null });
      toast.success(t("answered"));
    } else {
      toast.error(tc("toasts.error"));
    }
  }

  return (
    <EventSheet
      event={detail}
      open={open}
      onOpenChange={onOpenChange}
      locale={locale}
      audience="family"
      canEdit={false}
      myResponse={myResponse}
      onRespond={respond}
      now={now}
      calendarName={tenantName}
    />
  );
}
