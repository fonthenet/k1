import "server-only";

import { countUnreadMessages } from "../comms/queries";
import { getSupportSummary } from "../support/data";
import type { InboxSummary } from "./types";

/**
 * What the bubble needs before anybody opens it: how many conversations are
 * waiting, and whether this person has a support thread at all.
 *
 * It counts and it does not list. This runs in the dashboard layout, so it runs
 * on every page for every member of staff, and almost every one of those
 * renders is of a closed circle. Loading a hundred conversations to draw a
 * circle would be the most expensive thing on the page — the conversations load
 * when the panel is opened, and not before.
 *
 * The unit is the message: three from one parent is three things to read, not
 * one. The rows inside the panel carry their own counts so the badge is always
 * their sum — see `isMessageUnread`.
 */
export async function getInboxSummary(
  tenantId: string,
  userId: string,
  isAdmin: boolean
): Promise<InboxSummary> {
  const [familyUnread, support] = await Promise.all([
    countUnreadMessages(tenantId, userId),
    // Admins only — the vendor relationship is not an educator's business, and
    // the RPC returns null for anyone else anyway.
    isAdmin ? getSupportSummary(tenantId) : Promise.resolve(null),
  ]);

  // `getSupportSummary().unread` already counts messages, so it adds in whole.
  return {
    unread: familyUnread + (support?.unread ?? 0),
    supportThreadId: support?.threadId ?? null,
  };
}
