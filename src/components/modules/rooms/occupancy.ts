"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { readRoomOccupancy, type RoomOccupancy } from "./occupancy-data";

/**
 * The dialogs' way to ask who is in which room: the lesson editor for a
 * series or a refused day, the class dialog for the next twelve weeks, the
 * activity dialog for the same, the follow-up and event dialogs for their
 * day(s). One server action over the one reader, on the signed-in member's
 * own client, so the pre-check line and the database agree about the ledger.
 *
 * Accepted with or without an offset: the editors send `toISOString()` (a
 * "Z"), the Algiers helpers send "+01:00"; both are the same instant to the
 * RPC. The window is checked here as the RPC checks it, so a bad call is
 * refused before a round trip and never reaches the database as a 22023.
 */
const windowSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine((w) => Date.parse(w.to) > Date.parse(w.from))
  .refine((w) => Date.parse(w.to) - Date.parse(w.from) <= 120 * 24 * 60 * 60 * 1000);

export async function roomOccupancy(input: { from: string; to: string }): Promise<RoomOccupancy> {
  const ctx = await requireStaff();
  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) throw new Error("roomOccupancy: the window must be positive and at most 120 days");
  const [db, locale] = await Promise.all([createClient(), getLocale()]);
  return readRoomOccupancy(db, ctx, locale, parsed.data.from, parsed.data.to);
}
