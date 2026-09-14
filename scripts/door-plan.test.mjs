import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/door-plan.test.mjs`.
//
// The parent's side of the door (0168, direction made automatic in 0169) as
// seen from the phone: which move each child has today — an arrival, a
// departure, or none because the day is over — which rows may not be
// written yet, which rows the screen ticks on its own, and which ticks
// survive when the register is read again before writing. These are the
// kiosk's rules restated for a parent, and the one place they could quietly
// drift is here — so the drop-off / collect / left-already / fresh-arrival /
// no-custody cases are pinned with hand-made rows rather than with a family
// at a real door. The module reads the day's bound from `@/lib/door-code`,
// which is why the same resolve hook as tag-scan.test.mjs maps `@/` to src/
// and adds the extension. (The pair a child's card encodes is
// door-code.ts's too, and door-code.test.mjs pins it.)
const hooks = `
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
let src;
export function initialize(data) { src = data.src; }
export async function resolve(specifier, context, next) {
  let target = specifier;
  if (target.startsWith("@/")) target = new URL(target.slice(2), src).href;
  const local = target.startsWith("./") || target.startsWith("../") || target.startsWith("file:");
  const named = target.slice(target.lastIndexOf("/") + 1).includes(".");
  if (local && !named) {
    const base = target.startsWith("file:") ? target : new URL(target, context.parentURL).href;
    for (const ext of [".ts", ".tsx"]) {
      if (existsSync(fileURLToPath(base + ext))) { target = base + ext; break; }
    }
  }
  return next(target, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`, {
  parentURL: import.meta.url,
  data: { src: new URL("../src/", import.meta.url).href },
});

const {
  planSelf,
  isOpenMove,
  rereadTicks,
  codeDeadline,
  remainingSeconds,
  doorErrorToken,
  JUST_ARRIVED_MS,
  DOOR_CODE_MIN_LEFT_MS,
  DOOR_CODE_MAX_LEFT_MS,
} = await import("../src/components/modules/portal/door-plan.ts");

const NOW = Date.parse("2026-09-14T07:30:00Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

/** A child row the way kg_door_peek hands it over, with the usual defaults. */
function child(id, over = {}) {
  return { id, can_pickup: true, check_in_at: null, check_out_at: null, handover: null, ...over };
}

// ─── one child, the three states of a day ───────────────────────────────────

test("not arrived → the move is an arrival, ticked", () => {
  const plan = planSelf([child("a")], NOW);
  assert.equal(plan.moves.length, 1);
  assert.deepEqual(plan.moves[0], {
    childId: "a",
    today: { kind: "notArrived" },
    move: "in",
    blocked: null,
    pending: null,
  });
  assert.deepEqual(plan.preselected, ["a"]);
});

test("inside for an hour → the move is a departure, ticked", () => {
  const plan = planSelf([child("a", { check_in_at: iso(-60 * 60 * 1000) })], NOW);
  assert.equal(plan.moves[0].move, "out");
  assert.deepEqual(plan.moves[0].today, { kind: "in", at: iso(-60 * 60 * 1000) });
  assert.equal(plan.moves[0].blocked, null);
  assert.deepEqual(plan.preselected, ["a"]);
});

test("left today → the day is over: no move, nothing to tick, a fact on the row", () => {
  const plan = planSelf(
    [child("a", { check_in_at: iso(-8 * 3600 * 1000), check_out_at: iso(-30 * 60 * 1000) })],
    NOW
  );
  assert.equal(plan.moves[0].move, "done");
  assert.equal(plan.moves[0].blocked, null);
  assert.deepEqual(plan.moves[0].today, { kind: "out", at: iso(-30 * 60 * 1000) });
  assert.deepEqual(plan.preselected, []);
  assert.equal(isOpenMove(plan.moves[0]), false);
});

test("a departure written without an arrival still reads as the day over", () => {
  // The register lets staff record a departure on a row with no check-in
  // (a child brought in before the tablet was on). check_out_at decides.
  const plan = planSelf([child("a", { check_out_at: iso(-30 * 60 * 1000) })], NOW);
  assert.equal(plan.moves[0].move, "done");
  assert.deepEqual(plan.preselected, []);
});

// ─── the register's two refusals, mirrored before the tap ───────────────────

test("arrived under two minutes ago → the departure is blocked as just_arrived", () => {
  const fresh = planSelf([child("a", { check_in_at: iso(-(JUST_ARRIVED_MS - 1000)) })], NOW);
  assert.equal(fresh.moves[0].move, "out");
  assert.equal(fresh.moves[0].blocked, "just_arrived");
  assert.deepEqual(fresh.preselected, []);

  // At exactly two minutes the register no longer calls it a double scan.
  const settled = planSelf([child("a", { check_in_at: iso(-JUST_ARRIVED_MS) })], NOW);
  assert.equal(settled.moves[0].blocked, null);
  assert.deepEqual(settled.preselected, ["a"]);
});

test("no custody → the departure is blocked as pickup_not_allowed, and it wins over just_arrived", () => {
  const plan = planSelf([child("a", { check_in_at: iso(-30 * 1000), can_pickup: false })], NOW);
  assert.equal(plan.moves[0].move, "out");
  assert.equal(plan.moves[0].blocked, "pickup_not_allowed");
  assert.deepEqual(plan.preselected, []);
});

test("no custody does not touch an arrival: drop-off stays open to any linked adult", () => {
  const plan = planSelf([child("a", { can_pickup: false })], NOW);
  assert.equal(plan.moves[0].move, "in");
  assert.equal(plan.moves[0].blocked, null);
  assert.deepEqual(plan.preselected, ["a"]);
});

test("a child already out is never blocked: there is nothing left to refuse", () => {
  const plan = planSelf(
    [child("a", { check_in_at: iso(-3600 * 1000), check_out_at: iso(-60 * 1000), can_pickup: false })],
    NOW
  );
  assert.equal(plan.moves[0].move, "done");
  assert.equal(plan.moves[0].blocked, null);
});

// ─── hand-overs already open ────────────────────────────────────────────────

test("a pending hand-over rides on the move and keeps THAT row unticked, not the others", () => {
  const plan = planSelf(
    [
      child("a", {
        check_in_at: iso(-3600 * 1000),
        handover: { id: "h1", status: "pending", expires_at: iso(5 * 60 * 1000) },
      }),
      child("b"),
    ],
    NOW
  );
  assert.deepEqual(plan.moves[0].pending, { id: "h1", expiresAt: iso(5 * 60 * 1000) });
  assert.equal(plan.moves[0].move, "out");
  assert.equal(isOpenMove(plan.moves[0]), false);
  assert.equal(plan.moves[1].pending, null);
  assert.deepEqual(plan.preselected, ["b"]);
});

test("a hand-over that is not pending is ignored", () => {
  const plan = planSelf(
    [
      child("a", {
        check_in_at: iso(-3600 * 1000),
        handover: { id: "h1", status: "cancelled", expires_at: iso(-60 * 1000) },
      }),
    ],
    NOW
  );
  assert.equal(plan.moves[0].pending, null);
  assert.deepEqual(plan.preselected, ["a"]);
});

// ─── siblings: every open row starts ticked, whichever way it points ────────

test("two siblings both arriving → both ticked", () => {
  const plan = planSelf([child("a"), child("b")], NOW);
  assert.deepEqual(plan.preselected, ["a", "b"]);
});

test("two siblings both inside → both ticked as departures", () => {
  const plan = planSelf(
    [child("a", { check_in_at: iso(-3600 * 1000) }), child("b", { check_in_at: iso(-3600 * 1000) })],
    NOW
  );
  assert.deepEqual(
    plan.moves.map((m) => m.move),
    ["out", "out"]
  );
  assert.deepEqual(plan.preselected, ["a", "b"]);
});

test("one arriving, one leaving → nothing ticked: the kiosk's single-direction rule, one button must not arm a departure unasked", () => {
  const plan = planSelf([child("a"), child("b", { check_in_at: iso(-3600 * 1000) })], NOW);
  assert.deepEqual(
    plan.moves.map((m) => m.move),
    ["in", "out"]
  );
  assert.deepEqual(plan.preselected, []);
});

test("one arriving beside a sibling who already left → the arrival is still ticked: done is not a direction", () => {
  const plan = planSelf(
    [child("a"), child("b", { check_in_at: iso(-8 * 3600 * 1000), check_out_at: iso(-3600 * 1000) })],
    NOW
  );
  assert.deepEqual(plan.preselected, ["a"]);
});

test("one blocked sibling stays unticked while the open one is ticked", () => {
  const plan = planSelf(
    [
      child("a", { check_in_at: iso(-3600 * 1000) }),
      child("b", { check_in_at: iso(-3600 * 1000), can_pickup: false }),
    ],
    NOW
  );
  assert.equal(plan.moves[0].blocked, null);
  assert.equal(plan.moves[1].blocked, "pickup_not_allowed");
  assert.deepEqual(plan.preselected, ["a"]);
});

test("one sibling collected already, one still inside → only the one inside is ticked", () => {
  const plan = planSelf(
    [
      child("a", { check_in_at: iso(-8 * 3600 * 1000), check_out_at: iso(-60 * 60 * 1000) }),
      child("b", { check_in_at: iso(-8 * 3600 * 1000) }),
    ],
    NOW
  );
  assert.deepEqual(
    plan.moves.map((m) => m.move),
    ["done", "out"]
  );
  assert.deepEqual(plan.preselected, ["b"]);
});

test("no children → no moves, nothing ticked", () => {
  assert.deepEqual(planSelf([], NOW), { moves: [], preselected: [] });
});

test("moves keep the order the register gave (first_name, last_name)", () => {
  const plan = planSelf([child("zoe"), child("amir"), child("lina")], NOW);
  assert.deepEqual(
    plan.moves.map((m) => m.childId),
    ["zoe", "amir", "lina"]
  );
});

// ─── the screen read again: which ticks survive a fresh answer ──────────────

test("a ticked row that still says the same move keeps its tick", () => {
  const before = planSelf([child("a"), child("b", { check_in_at: iso(-3600 * 1000) })], NOW);
  const after = planSelf([child("a"), child("b", { check_in_at: iso(-3600 * 1000) })], NOW + 60_000);
  assert.deepEqual(rereadTicks(before, after, ["a", "b"]), { kept: ["a", "b"], lost: [] });
});

test("the stale-screen case: ticked for an arrival, recorded inside by the team meanwhile → lost", () => {
  // Read at 08:00 as "Arrivée"; the kiosk scanned the child in at 08:03;
  // the parent taps at 08:10. The fresh row says "Départ" — the register
  // would write it, and the parent never meant it.
  const before = planSelf([child("a")], NOW);
  const after = planSelf([child("a", { check_in_at: iso(3 * 60_000) })], NOW + 10 * 60_000);
  assert.equal(after.moves[0].move, "out");
  assert.deepEqual(rereadTicks(before, after, ["a"]), { kept: [], lost: ["a"] });
});

test("ticked for a departure, collected by the other parent meanwhile → lost (the day is over)", () => {
  const before = planSelf([child("a", { check_in_at: iso(-3600 * 1000) })], NOW);
  const after = planSelf(
    [child("a", { check_in_at: iso(-3600 * 1000), check_out_at: iso(5 * 60_000) })],
    NOW + 10 * 60_000
  );
  assert.deepEqual(rereadTicks(before, after, ["a"]), { kept: [], lost: ["a"] });
});

test("ticked for a departure, a hand-over asked for meanwhile → lost (the row is waiting on the team)", () => {
  const before = planSelf([child("a", { check_in_at: iso(-3600 * 1000) })], NOW);
  const after = planSelf(
    [
      child("a", {
        check_in_at: iso(-3600 * 1000),
        handover: { id: "h1", status: "pending", expires_at: iso(15 * 60_000) },
      }),
    ],
    NOW + 60_000
  );
  assert.equal(after.moves[0].move, "out");
  assert.deepEqual(rereadTicks(before, after, ["a"]), { kept: [], lost: ["a"] });
});

test("ticked for a departure that the fresh answer blocks → lost, whichever block", () => {
  const before = planSelf([child("a", { check_in_at: iso(-3600 * 1000) })], NOW);
  const noCustody = planSelf([child("a", { check_in_at: iso(-3600 * 1000), can_pickup: false })], NOW);
  assert.deepEqual(rereadTicks(before, noCustody, ["a"]), { kept: [], lost: ["a"] });
});

test("a child the fresh answer no longer lists is lost", () => {
  const before = planSelf([child("a"), child("b")], NOW);
  const after = planSelf([child("b")], NOW);
  assert.deepEqual(rereadTicks(before, after, ["a", "b"]), { kept: ["b"], lost: ["a"] });
});

test("rows that were not ticked are not looked at, and kept ticks keep their order", () => {
  // `b` changed under the parent but was never ticked: nothing to lose.
  const before = planSelf([child("z"), child("b"), child("a")], NOW);
  const after = planSelf([child("z"), child("b", { check_in_at: iso(0) }), child("a")], NOW + 1000);
  assert.deepEqual(rereadTicks(before, after, ["z", "a"]), { kept: ["z", "a"], lost: [] });
  assert.deepEqual(rereadTicks(before, after, []), { kept: [], lost: [] });
});

// ─── the day's code and its clock ───────────────────────────────────────────

test("remainingSeconds rounds up, floors at zero, and treats garbage as expired", () => {
  assert.equal(remainingSeconds(iso(90 * 1000), NOW), 90);
  assert.equal(remainingSeconds(iso(500), NOW), 1);
  assert.equal(remainingSeconds(iso(0), NOW), 0);
  assert.equal(remainingSeconds(iso(-5000), NOW), 0);
  assert.equal(remainingSeconds("not a date", NOW), 0);
  // A local deadline (a number) counts down the same way.
  assert.equal(remainingSeconds(NOW + 75 * 1000, NOW), 75);
  assert.equal(remainingSeconds(NOW - 1, NOW), 0);
});

test("the day's bounds: a just-accepted code is good for a minute at least, a day at most", () => {
  assert.equal(DOOR_CODE_MIN_LEFT_MS, 60 * 1000);
  assert.equal(DOOR_CODE_MAX_LEFT_MS, 24 * 60 * 60 * 1000);
});

test("codeDeadline trusts a plausible reading as it is — the phone's clock agrees with the server's", () => {
  // Scanned at 07:30 UTC = 08:30 Algiers; the code dies at the next Algiers
  // midnight, 15 h 30 later.
  const tonight = 15.5 * 3600 * 1000;
  assert.equal(codeDeadline(iso(tonight), NOW), NOW + tonight);
  // A small skew shifts the deadline by as much, nothing more: the phone is
  // 10 s fast, so it reads 10 s less.
  assert.equal(codeDeadline(iso(tonight), NOW + 10 * 1000), NOW + tonight);
  // Seconds before midnight the reading is still trusted: the register may
  // well kill the code before the parent taps, and says so if it does.
  assert.equal(codeDeadline(iso(10 * 1000), NOW), NOW + 10 * 1000);
});

test("codeDeadline: a phone running fast never locks the door on its own clock", () => {
  // 30 s left on the server at 23:59:30; the phone is 90 s ahead, so it
  // reads the code as dead a minute ago — and the peek that just succeeded
  // says otherwise. The floor stands in: a minute to tap.
  const fast = NOW + 90 * 1000;
  assert.equal(codeDeadline(iso(30 * 1000), fast), fast + DOOR_CODE_MIN_LEFT_MS);
  assert.ok(remainingSeconds(codeDeadline(iso(30 * 1000), fast), fast) > 0);
  // Exactly at the stamp counts as past it.
  assert.equal(codeDeadline(iso(0), NOW), NOW + DOOR_CODE_MIN_LEFT_MS);
});

test("codeDeadline: a phone running slow never shows more than a day", () => {
  // A code minted at midnight, read on a phone an hour behind: it would
  // count down from 25 h — the cap is the code's whole day.
  const slow = NOW - 3600 * 1000;
  assert.equal(codeDeadline(iso(DOOR_CODE_MAX_LEFT_MS), slow), slow + DOOR_CODE_MAX_LEFT_MS);
});

test("codeDeadline: a stamp that does not parse falls back to the floor, not to zero", () => {
  assert.equal(codeDeadline("not a date", NOW), NOW + DOOR_CODE_MIN_LEFT_MS);
});

// ─── the RPCs' refusals ─────────────────────────────────────────────────────

test("doorErrorToken reads the token out of PostgREST's wrapping and folds the rest into generic", () => {
  assert.equal(doorErrorToken("unknown_code"), "unknown_code");
  assert.equal(doorErrorToken("P0001: expired_code"), "expired_code");
  assert.equal(doorErrorToken("not_a_parent"), "not_a_parent");
  assert.equal(doorErrorToken("forbidden"), "forbidden");
  assert.equal(doorErrorToken("not_pending"), "not_pending");
  assert.equal(doorErrorToken("unknown_child"), "unknown_child");
  assert.equal(doorErrorToken("TypeError: Failed to fetch"), "generic");
  assert.equal(doorErrorToken(null), "generic");
  assert.equal(doorErrorToken(undefined), "generic");
});
