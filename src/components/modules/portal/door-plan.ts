/**
 * What a parent may record at the door, worked out from today's register.
 *
 * kg_door_peek (0168) answers with each child's row for today — or nulls —
 * and the hand-over still open on them, if any. This turns that into the
 * ONE move each child has, whether the parent may make it right now, and
 * which rows the screen ticks before a finger touches it, so the chips, the
 * state line under the name and the pre-selection are read off a single
 * computation and can never disagree.
 *
 * The register stays the authority. kg_checkin_self re-checks every rule —
 * opening hours, custody, the four duplicate reasons — and answers with
 * facts, never with a button a parent could press to force anything. What
 * is decided here is only what the screen offers first.
 *
 * The rules are the kiosk's (kiosk-client.tsx: `stillHere` → out, else in;
 * `localDuplicate` for the two-minute window; a blocked tile keeps the
 * whole list manual; every legal tile has to point the same way before
 * anything is pre-selected), because a parent and a staff member looking
 * at the same child must be offered the same move.
 *
 * Pure, no React, no I/O — scripts/door-plan.test.mjs proves it.
 */

import { DOOR_CODE_REFRESH_MS, DOOR_CODE_TTL_S } from "@/lib/door-code";

export type DoorDirection = "in" | "out";

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
 * register answers with, so one message key serves the chip and the result.
 */
export type DoorBlock = "just_arrived" | "pickup_not_allowed";

export interface DoorMove {
  childId: string;
  today: DoorTodayState;
  /** The one move today's row allows: an arrival, or a departure. */
  direction: DoorDirection;
  /**
   * The child left today and is at the door again. The arrival is offered —
   * a late return is real — but never pre-selected: the register answers
   * `returned` and the team decides, exactly as at the kiosk.
   */
  returning: boolean;
  /** Set, the chip for `direction` is disabled with this reason. */
  blocked: DoorBlock | null;
  /** A hand-over already asked for: the child is waiting on the team, not on a chip. */
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
  return move.blocked === null && move.pending === null && !move.returning;
}

/**
 * Every child's move, and which ones start ticked.
 *
 * Pre-selection follows the kiosk's auto-confirm rule to the letter: every
 * row must be a plain open move and every one must point the same way. One
 * blocked row — a departure this adult may not make, a child who walked in
 * two minutes ago — keeps the whole list manual, because that refusal is
 * the thing a person has to read before anything is written. So does a
 * child already out (a return is the team's call) or already waiting on a
 * hand-over. And so does a list that points both ways: a mother collecting
 * one child while dropping off the other must tick each move herself,
 * never find the second counted as a departure by default.
 */
export function planSelf(children: DoorPeekChild[], now: number = Date.now()): DoorPlan {
  const moves = children.map((child) => moveFor(child, now));
  const directions = new Set(moves.map((m) => m.direction));
  const auto = moves.length > 0 && moves.every(isOpenMove) && directions.size === 1;
  return { moves, preselected: auto ? moves.map((m) => m.childId) : [] };
}

function moveFor(child: DoorPeekChild, now: number): DoorMove {
  const pending =
    child.handover && child.handover.status === "pending"
      ? { id: child.handover.id, expiresAt: child.handover.expires_at }
      : null;

  // Left today: the register would call a departure `already_out`, so the
  // only move on offer is the arrival — as a return, said as such.
  if (child.check_out_at) {
    return {
      childId: child.id,
      today: { kind: "out", at: child.check_out_at },
      direction: "in",
      returning: true,
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
      direction: "out",
      returning: false,
      blocked: !child.can_pickup ? "pickup_not_allowed" : justArrived ? "just_arrived" : null,
      pending,
    };
  }

  // Not here yet: the move is the arrival, open to any linked adult.
  return {
    childId: child.id,
    today: { kind: "notArrived" },
    direction: "in",
    returning: false,
    blocked: null,
    pending,
  };
}

/** A code's whole life, in ms (§2.2). */
export const DOOR_CODE_TTL_MS = DOOR_CODE_TTL_S * 1000;
/** The least a code scanned off a live kiosk has left: the kiosk renews every 30 s. */
export const DOOR_CODE_MIN_LEFT_MS = DOOR_CODE_TTL_MS - DOOR_CODE_REFRESH_MS;

/**
 * When the code stops being offered, as a moment on THIS phone's clock.
 *
 * kg_door_peek says `expires_at` on the server's clock, and the two clocks
 * are not the same clock. Read naively, a phone running a minute fast would
 * see every code dead the instant it was scanned — chips grey, button locked,
 * "scan again" forever — when the peek that just succeeded said the
 * opposite. So the deadline is anchored on the moment the peek came back,
 * which both clocks agree was "now", and the server's remaining time is read
 * off with the contract's own bounds: a code never has more than its 90 s,
 * and one scanned off a kiosk that renews every 30 s has at least 60. A
 * reading inside those bounds is trusted as it is (a small skew only shifts
 * the countdown by as much); one outside them is a skewed clock, and the
 * bound it crossed stands in for it. The register keeps the last word: a
 * code that is dead in Algiers is refused as `expired_code` whatever this
 * countdown says, and that refusal is already a sentence on the screen.
 */
export function codeDeadline(expiresAt: string, receivedAt: number): number {
  const said = Date.parse(expiresAt) - receivedAt;
  const left = Number.isNaN(said) || said <= 0 ? DOOR_CODE_MIN_LEFT_MS : Math.min(said, DOOR_CODE_TTL_MS);
  return receivedAt + left;
}

/** Whole seconds left before `deadline` (an ISO stamp or a local moment), never below zero. */
export function remainingSeconds(deadline: string | number, now: number = Date.now()): number {
  const left = (typeof deadline === "number" ? deadline : Date.parse(deadline)) - now;
  return Number.isNaN(left) ? 0 : Math.max(0, Math.ceil(left / 1000));
}

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
