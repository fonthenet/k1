/**
 * What a parent may record at the door, worked out from today's register.
 *
 * kg_door_peek (0168) answers with each child's row for today — or nulls —
 * and the hand-over still open on them, if any. This turns that into the
 * ONE move each child has today, whether the parent may make it right now,
 * and which rows the screen ticks before a finger touches it, so the label
 * on the row, the state line under the name and the pre-selection are read
 * off a single computation and can never disagree.
 *
 * Since 0169 the direction is never asked. The child's state decides: not
 * arrived → an arrival; inside → a departure; already left → the day is
 * over, a fact and not a choice (a late return is the team's call at the
 * kiosk). The screen shows the move as a LABEL, and the register infers it
 * again at write time (`p_direction = 'auto'`). That inference protects the
 * register from a stale screen, not the parent: a label read at 08:00 and
 * tapped at 08:10, after the team recorded the child at the kiosk, would
 * have the register write the departure the parent never meant. So the
 * screen reads the register again before it writes and keeps a tick only
 * where the row still says the same move — `rereadTicks`, below.
 *
 * The register stays the authority. kg_checkin_self re-checks every rule —
 * opening hours, custody, the four duplicate reasons — and answers with
 * facts, never with a button a parent could press to force anything. What
 * is decided here is only what the screen offers first.
 *
 * The rules are the kiosk's (kiosk-client.tsx: `stillHere` → out, else in;
 * `localDuplicate` for the two-minute window), because a parent and a staff
 * member looking at the same child must be offered the same move.
 *
 * Pure, no React, no I/O — scripts/door-plan.test.mjs proves it.
 */

import { DOOR_CODE_TTL_S } from "@/lib/door-code";

/** The two directions the register writes. */
export type DoorDirection = "in" | "out";

/**
 * The move a child has today: an arrival, a departure, or none — `done`
 * means the child left today and the day is over from this screen's side.
 */
export type DoorMoveKind = DoorDirection | "done";

/** The per-child shape kg_door_peek returns — only the fields read here. */
export interface DoorPeekChild {
  id: string;
  /** kg_child_guardians.can_pickup for the calling parent. */
  can_pickup: boolean;
  check_in_at: string | null;
  check_out_at: string | null;
  /** The child's pending hand-over, if a departure was already asked for. */
  handover: { id: string; status: string; expires_at: string } | null;
}

/** Where the child stands today — the line under the name. */
export type DoorTodayState =
  | { kind: "notArrived" }
  | { kind: "in"; at: string }
  | { kind: "out"; at: string };

/**
 * Why the legal move may not be written right now. The same tokens the
 * register answers with, so one message key serves the row and the result.
 */
export type DoorBlock = "just_arrived" | "pickup_not_allowed";

export interface DoorMove {
  childId: string;
  today: DoorTodayState;
  /** What today's row makes of the next scan — said on the row, never chosen. */
  move: DoorMoveKind;
  /** Set, the row cannot be ticked and says why. Only ever on a departure. */
  blocked: DoorBlock | null;
  /** A hand-over already asked for: the child is waiting on the team, not on a tick. */
  pending: { id: string; expiresAt: string } | null;
}

export interface DoorPlan {
  /** One per child, in the order given. */
  moves: DoorMove[];
  /** The child ids the screen ticks before the parent touches anything. */
  preselected: string[];
}

/** The register's own window for "a double scan, not a pickup" (0027). */
export const JUST_ARRIVED_MS = 2 * 60 * 1000;

/** True for the plain case: a move the parent may write as it stands. */
export function isOpenMove(move: DoorMove): boolean {
  return move.move !== "done" && move.blocked === null && move.pending === null;
}

/**
 * Every child's move, and which ones start ticked.
 *
 * Every open move starts ticked when the open moves all point the same way
 * — two arriving siblings, two departing — and none when the list points
 * both ways: the kiosk's own rule (a mother collecting one child while
 * dropping off the other reads "Départ" on one row and "Arrivée" on the
 * other and ticks what she means). The register decides the direction at
 * write time either way; the rule is about what one button may do unasked.
 * A row that is blocked (a departure this adult may not make, a child who
 * walked in two minutes ago), already over for the day, or already waiting
 * on a hand-over is never ticked — those are facts a person has to read,
 * not defaults — and does not count as a direction.
 */
export function planSelf(children: DoorPeekChild[], now: number = Date.now()): DoorPlan {
  const moves = children.map((child) => moveFor(child, now));
  // The kiosk's single-direction rule, kept here too: every open row is
  // ticked when they all point the same way, none when the list points both
  // ways — a father dropping Adam off must not find Ines's departure armed
  // under the one button. Blocked and done rows do not count as a direction.
  const open = moves.filter(isOpenMove);
  const oneWay = new Set(open.map((m) => m.move)).size === 1;
  return { moves, preselected: oneWay ? open.map((m) => m.childId) : [] };
}

function moveFor(child: DoorPeekChild, now: number): DoorMove {
  const pending =
    child.handover && child.handover.status === "pending"
      ? { id: child.handover.id, expiresAt: child.handover.expires_at }
      : null;

  // Left today: the day is over from here. The register would answer
  // `already_out` to anything, and a return is recorded at the kiosk by
  // the team — so the row says so and offers nothing.
  if (child.check_out_at) {
    return {
      childId: child.id,
      today: { kind: "out", at: child.check_out_at },
      move: "done",
      blocked: null,
      pending,
    };
  }

  // Inside: the move is a departure. Blocked when this adult may not
  // collect the child, or when the arrival is so fresh that the register
  // would read the departure as a double scan (`just_arrived`).
  if (child.check_in_at) {
    const justArrived = now - Date.parse(child.check_in_at) < JUST_ARRIVED_MS;
    return {
      childId: child.id,
      today: { kind: "in", at: child.check_in_at },
      move: "out",
      blocked: !child.can_pickup ? "pickup_not_allowed" : justArrived ? "just_arrived" : null,
      pending,
    };
  }

  // Not here yet: the move is the arrival, open to any linked adult.
  return {
    childId: child.id,
    today: { kind: "notArrived" },
    move: "in",
    blocked: null,
    pending,
  };
}

// ─── the screen read again ──────────────────────────────────────────────────

/**
 * Which ticks survive a fresh answer of the register.
 *
 * The day's code keeps the parent's screen valid for hours, so what a row
 * said when it was read and what the register would write now can differ:
 * a child ticked for an arrival at 08:00 and walked in past the kiosk is,
 * at 08:10, a departure. The register infers the direction itself (`auto`),
 * but the parent's intent is the label they tapped — so before anything is
 * written, and when a tab comes back after a while, the screen asks again
 * and keeps a tick only where the fresh row is still open and still says
 * the same move. The rest are lost: the row shows the register's current
 * word, unticked, and the parent reads it before the next tap. A child the
 * fresh answer no longer lists is lost too. Ticks are kept in the order
 * given; rows that were not ticked are not looked at — an untouched row
 * that changed simply reads differently now.
 */
export function rereadTicks(
  before: DoorPlan,
  after: DoorPlan,
  ticked: string[]
): { kept: string[]; lost: string[] } {
  const said = new Map(before.moves.map((m) => [m.childId, m.move]));
  const says = new Map(after.moves.map((m) => [m.childId, m]));
  const kept: string[] = [];
  const lost: string[] = [];
  for (const childId of ticked) {
    const fresh = says.get(childId);
    (fresh && isOpenMove(fresh) && said.get(childId) === fresh.move ? kept : lost).push(childId);
  }
  return { kept, lost };
}

// ─── the day's code ─────────────────────────────────────────────────────────
//
// Since 0169 the door shows ONE code per day, minted on the first request
// and dead at the next Algiers midnight. So `expires_at` is no longer
// "ninety seconds from now" but "tonight", and the two bounds below are the
// day's: the least a code the register has just accepted is given on this
// phone, and the most any code can have. The floor is this screen's own.
// v1 derived it from the kiosk's refresh cadence (`DOOR_CODE_REFRESH_MS`,
// "a scanned code has at least TTL − refresh left"), which stopped being
// true the day the code became daily and the kiosk slowed down to five
// minutes — the difference would have gone negative.

/**
 * The least a code the peek has just accepted is trusted for on this phone.
 * A minute: long enough to read the rows and tap once, short enough that a
 * code the register is about to kill at midnight is not promised an hour.
 */
export const DOOR_CODE_MIN_LEFT_MS = 60 * 1000;
/**
 * The most a code can have: its whole Algiers day, minted at 00:00:00.
 * Algeria keeps no summer time, so a day is always twenty-four hours — the
 * same bound `@/lib/door-code` states for the kiosk, read from there so the
 * two ends of the scan cannot disagree about it.
 */
export const DOOR_CODE_MAX_LEFT_MS = DOOR_CODE_TTL_S * 1000;

/**
 * When the code stops being offered, as a moment on THIS phone's clock.
 *
 * kg_door_peek says `expires_at` on the server's clock, and the two clocks
 * are not the same clock. Read naively at 23:59 on a phone running a minute
 * fast, a code the peek has just accepted would show as dead — rows grey,
 * button locked, "scan again" — when the register said the opposite. So the
 * deadline is anchored on the moment the peek came back, which both clocks
 * agree was "now", and the server's remaining time is read off with the
 * day's bounds: a reading inside them is trusted as it is (a small skew
 * only shifts the deadline by as much), one outside them is a skewed clock,
 * and the bound it crossed stands in for it. The register keeps the last
 * word: a code that is dead in Algiers is refused as `expired_code`
 * whatever this deadline says, and that refusal is already a sentence on
 * the screen.
 */
export function codeDeadline(expiresAt: string, receivedAt: number): number {
  const said = Date.parse(expiresAt) - receivedAt;
  const left =
    Number.isNaN(said) || said <= 0 ? DOOR_CODE_MIN_LEFT_MS : Math.min(said, DOOR_CODE_MAX_LEFT_MS);
  return receivedAt + left;
}

/** Whole seconds left before `deadline` (an ISO stamp or a local moment), never below zero. */
export function remainingSeconds(deadline: string | number, now: number = Date.now()): number {
  const left = (typeof deadline === "number" ? deadline : Date.parse(deadline)) - now;
  return Number.isNaN(left) ? 0 : Math.max(0, Math.ceil(left / 1000));
}

// ─── the RPCs' refusals ─────────────────────────────────────────────────────

/**
 * The tokens the door RPCs raise (§2.5), read out of a PostgREST error
 * message — which wraps them ("unknown_code", sometimes with a prefix) —
 * and anything else folded into `generic`, so the screen never shows a
 * database sentence to a parent.
 */
export type DoorErrorToken =
  | "unknown_code"
  | "expired_code"
  | "not_a_parent"
  | "forbidden"
  | "not_pending"
  | "unknown_child"
  | "unknown_handover"
  | "generic";

const DOOR_ERROR_TOKENS: readonly Exclude<DoorErrorToken, "generic">[] = [
  "unknown_code",
  "expired_code",
  "not_a_parent",
  "forbidden",
  "not_pending",
  "unknown_child",
  "unknown_handover",
];

export function doorErrorToken(message: string | null | undefined): DoorErrorToken {
  const text = message ?? "";
  return DOOR_ERROR_TOKENS.find((token) => text.includes(token)) ?? "generic";
}
