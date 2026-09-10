"use client";

import { useLocale, useTranslations } from "next-intl";
import { DoorOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { RoomDialog } from "./room-dialog";
import { DeleteRoomButton } from "./delete-room-button";
import { roomFloorLabel, roomName, type Room } from "./class-types";

export interface RoomWithUsage extends Room {
  /** Classes currently sitting in this room. Deleting is refused above zero. */
  classCount: number;
  /** Names of those classes, so the card says WHICH — the reason anybody looks. */
  classNames: string[];
}

/**
 * The rooms a crèche has, as a thing you configure once.
 *
 * This lives beside the classes rather than in Settings because a room only
 * ever means something in relation to a class, and the person creating classes
 * on their first day is the person who needs to create the rooms.
 */
export function RoomsPanel({ rooms, isAdmin }: { rooms: RoomWithUsage[]; isAdmin: boolean }) {
  const t = useTranslations("classes");
  const locale = useLocale();

  if (rooms.length === 0) {
    return (
      <EmptyState
        icon={
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
            <DoorOpen />
          </span>
        }
        title={t("rooms.empty")}
        description={t("rooms.emptyDescription")}
        action={isAdmin ? <RoomDialog /> : undefined}
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rooms.map((r) => (
        <Card key={r.id} className="group/card">
          <CardContent>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold text-foreground">
                    {roomName(r, locale)}
                  </h3>
                  {!r.active && (
                    <Badge variant="tinted" className="bg-muted text-muted-foreground">
                      {t("rooms.inactive")}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[
                    r.capacity != null ? t("rooms.capacityValue", { count: r.capacity }) : null,
                    roomFloorLabel(r.floor, t),
                  ]
                    .filter(Boolean)
                    .join(" · ") || t("rooms.noDetails")}
                </p>
              </div>
              {isAdmin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <RoomDialog room={r} />
                  <DeleteRoomButton
                    roomId={r.id}
                    roomName={roomName(r, locale)}
                    classCount={r.classCount}
                  />
                </div>
              )}
            </div>

            {r.notes && <p className="mt-2 text-xs text-muted-foreground">{r.notes}</p>}

            <div className="mt-3 border-t border-border/60 pt-3">
              {r.classCount === 0 ? (
                <p className="text-xs text-muted-foreground">{t("rooms.noClasses")}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{t("rooms.usedBy")}</span>
                  {r.classNames.map((n) => (
                    <Badge key={n} variant="tinted" className="bg-primary/10 text-primary">
                      {n}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
