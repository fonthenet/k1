"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EventCard, type EventCardProps } from "./event-card";

export interface EventSheetProps extends Omit<EventCardProps, "event"> {
  /** Null while nothing is selected: the sheet stays closed and renders no card. */
  event: EventCardProps["event"] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The event's card in a sheet — the phone's reading surface, and the door
 * the family's calendar row and the notification's deep link open. Rises
 * from the bottom to the width of a phone, as the family's invoice sheet
 * does, so the two read as one product. The card carries the visible title;
 * the sheet's own title is for the screen reader only, so the name is not
 * said twice on screen.
 */
export function EventSheet({ event, open, onOpenChange, ...card }: EventSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl"
        aria-describedby={undefined}
      >
        {event && (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>{event.title}</SheetTitle>
            </SheetHeader>
            <div className="px-4 pt-6 pb-6">
              <EventCard event={event} {...card} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
