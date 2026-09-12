"use client";

import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DoorOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClassChip } from "@/components/shared/class-chip";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import type { HomeClass } from "@/components/modules/rooms/room-state";
import type { RoomChoice } from "./class-types";
import { roomFloorLabel, roomName } from "./class-types";
import { RoomDialog } from "./room-dialog";
import type { RoomUsage } from "./delete-room-button";
import { RoomOccupancySheet, type RoomOccupancySheetProps } from "./room-occupancy-sheet";

export type { RoomUsage } from "./delete-room-button";

/**
 * A room as the rooms tab knows it: the picker's facts plus the floor and
 * the notes only this tab prints, the classes that live in it, the active
 * activities that meet in it, and the four usage counts of `kg_room_usage`
 * (0155) that decide whether it may be deleted and say why not.
 */
export interface RoomWithUsage extends RoomChoice {
  floor: string | null;
  notes: string | null;
  /** Classes whose home room this is, names locale-resolved. */
  classes: HomeClass[];
  /** Active activities held in the room, names locale-resolved. */
  activities: string[];
  usage: RoomUsage;
}

/**
 * The rooms a building has, and who is in them.
 *
 * Two cards. First the occupancy sheet — one lane per room, one day at a
 * time — because "is Salle 4 free at eleven?" is the question a director
 * asks before she books anything, and the pickers' one-line answer links
 * here for the whole picture. Then the table: a room is four facts (name,
 * capacity, floor, who uses it) and six rooms as six cards said the same in
 * three times the height. This lives beside the classes rather than in
 * Settings because a room only ever means something in relation to a class,
 * and the person creating classes on their first day is the person who needs
 * to create the rooms.
 */
export function RoomsPanel({
  rooms,
  isAdmin,
  sheet,
}: {
  rooms: RoomWithUsage[];
  isAdmin: boolean;
  /** The week's bookings and days for the occupancy sheet. */
  sheet: Omit<RoomOccupancySheetProps, "rooms">;
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const locale = useLocale();

  if (rooms.length === 0) {
    return (
      <EmptyState
        icon={<DoorOpen />}
        title={t("rooms.empty")}
        description={t("rooms.emptyDescription")}
      />
    );
  }

  return (
    <div className="grid gap-6">
      {/* The sheet reaches the card's edges: its own toolbar row sits under
          the header, and the grid scrolls inside it. */}
      <SectionCard
        icon={DoorOpen}
        tone={0}
        title={tc("rooms.occupancy")}
        hint={tc("rooms.occupancyHint")}
        contentClassName="gap-0 px-0 -mb-(--card-spacing)"
      >
        <RoomOccupancySheet {...sheet} rooms={rooms} />
      </SectionCard>

      <Card className="overflow-hidden py-0 shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent [&>th]:text-sm [&>th]:font-medium [&>th]:text-muted-foreground [&>th:first-child]:ps-4 [&>th:last-child]:pe-4">
                <TableHead>{t("rooms.columns.name")}</TableHead>
                <TableHead>{t("rooms.columns.capacity")}</TableHead>
                <TableHead>{t("rooms.columns.floor")}</TableHead>
                <TableHead>{t("rooms.columns.usedBy")}</TableHead>
                {isAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((r) => {
                // What uses the room, after the class chips: the activities
                // by name, then the bookings still ahead as one count. Each
                // part is separated by the one middle dot the product uses
                // for facts, and the whole cell is the answer to "can I
                // delete this?" — the same four counts the dialog refuses on.
                const tail = [
                  ...r.activities,
                  ...(r.usage.upcomingCount > 0
                    ? [t("rooms.inUseBookings", { count: r.usage.upcomingCount })]
                    : []),
                ];
                const empty = r.classes.length === 0 && tail.length === 0;
                return (
                  <TableRow
                    key={r.id}
                    className="h-14 last:border-b-0 [&>td:first-child]:ps-4 [&>td:last-child]:pe-4"
                  >
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <bdi className="font-semibold">{roomName(r, locale)}</bdi>
                        {/* In service is the expected state and carries no pill. */}
                        {!r.active && <StatusPill tone="muted">{t("rooms.inactive")}</StatusPill>}
                      </div>
                      {r.notes && (
                        <bdi className="block truncate text-xs text-muted-foreground text-start">
                          {r.notes}
                        </bdi>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {r.capacity != null ? tc("rooms.places", { count: r.capacity }) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {roomFloorLabel(r.floor, t) ?? "—"}
                    </TableCell>
                    <TableCell>
                      {empty ? (
                        <span className="text-sm text-muted-foreground">{t("rooms.noClasses")}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          {r.classes.map((c) => (
                            <ClassChip key={c.id} name={c.name} color={c.color} />
                          ))}
                          {tail.length > 0 && (
                            <span className="text-muted-foreground">
                              {r.classes.length > 0 && <span aria-hidden>· </span>}
                              {tail.map((part, i) => (
                                <Fragment key={`${part}-${i}`}>
                                  {i > 0 && <span aria-hidden> · </span>}
                                  {/* An activity's name is typed by a person; the count is ours. */}
                                  {i < r.activities.length ? <bdi dir="auto">{part}</bdi> : part}
                                </Fragment>
                              ))}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-end">
                        {/* The pencil is the row's only control; deleting is in
                            the dialog's footer, where a destructive action
                            belongs. */}
                        <RoomDialog
                          room={r}
                          usage={r.usage}
                          activeActivityCount={r.activities.length}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
