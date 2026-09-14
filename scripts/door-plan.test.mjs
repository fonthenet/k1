import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/door-plan.test.mjs`.
//
// The parent's side of the door (0168) as seen from the phone: which move
// each child has today, which rows may not be written yet, and which rows
// the screen ticks on its own. These are the kiosk's rules restated for a
// parent, and the one place they could quietly drift is here — so the
// drop-off / collect / return / fresh-arrival / no-custody cases are pinned
// with hand-made rows rather than with a family at a real door. The module
// reads the code's lifetime from `@/lib/door-code`, which is why the same
// resolve hook as tag-scan.test.mjs maps `@/` to src/ and adds the extension.
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
  codeDeadline,
  remainingSeconds,
  doorErrorToken,
  JUST_ARRIVED_MS,
  DOOR_CODE_TTL_MS,
  DOOR_CODE_MIN_LEFT_MS,
} = await import("../src/components/modules/portal/door-plan.ts");

const NOW = Date.parse("2026-09-14T07:30:00Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

/** A child row the way kg_door_peek hands it over, with the usual defaults. */
function child(id, over = {}) {
  return { id, can_pickup: true, check_in_at: null, check_out_at: null, handover: null, ...over };
}

// ─── one child, the three states of a day ───────────────────────────────────

test("not arrived → the move is an arrival, and an only child starts ticked", () => {
  const plan = planSelf([child("a")], NOW);
  assert.equal(plan.moves.length, 1);
  assert.deepEqual(plan.moves[0], {
    childId: "a",
    today: { kind: "notArrived" },
    direction: "in",
    returning: false,
    blocked: null,
    pending: null,
  });
  assert.deepEqual(plan.preselected, ["a"]);
});

test("inside for an hour → the move is a departure, ticked", () => {
  const plan = planSelf([child("a", { check_in_at: iso(-60 * 60 * 1000) })], NOW);
  assert.equal(plan.moves[0].direction, "out");
  assert.deepEqual(plan.moves[0].today, { kind: "in", at: iso(-60 * 60 * 1000) });
  assert.equal(plan.moves[0].blocked, null);
  assert.deepEqual(plan.preselected, ["a"]);
});

test("left today → an arrival is offered as a return, and NEVER ticked", () => {
  const plan = planSelf(
    [child("a", { check_in_at: iso(-8 * 3600 * 1000), check_out_at: iso(-30 * 60 * 1000) })],
    NOW
  );
  assert.equal(plan.moves[0].direction, "in");
  assert.equal(plan.moves[0].returning, true);
  assert.deepEqual(plan.moves[0].today, { kind: "out", at: iso(-30 * 60 * 1000) });
  assert.deepEqual(plan.preselected, []);
  assert.equal(isOpenMove(plan.moves[0]), false);
});

// ─── the register's two refusals, mirrored before the tap ───────────────────

test("arrived under two minutes ago → the departure is blocked as just_arrived", () => {
  const fresh = planSelf([child("a", { check_in_at: iso(-(JUST_ARRIVED_MS - 1000)) })], NOW);
  assert.equal(fresh.moves[0].direction, "out");
  assert.equal(fresh.moves[0].blocked, "just_arrived");
  assert.deepEqual(fresh.preselected, []);

  // At exactly two minutes the register no longer calls it a double scan.
  const settled = planSelf([child("a", { check_in_at: iso(-JUST_ARRIVED_MS) })], NOW);
  assert.equal(settled.moves[0].blocked, null);
  assert.deepEqual(settled.preselected, ["a"]);
});

test("no custody → the departure is blocked as pickup_not_allowed, and it wins over just_arrived", () => {
  const plan = planSelf(
    [child("a", { check_in_at: iso(-30 * 1000), can_pickup: false })],
    NOW
  );
  assert.equal(plan.moves[0].direction, "out");
  assert.equal(plan.moves[0].blocked, "pickup_not_allowed");
  assert.deepEqual(plan.preselected, []);
});

test("no custody does not touch an arrival: drop-off stays open to any linked adult", () => {
  const plan = planSelf([child("a", { can_pickup: false })], NOW);
  assert.equal(plan.moves[0].direction, "in");
  assert.equal(plan.moves[0].blocked, null);
  assert.deepEqual(plan.preselected, ["a"]);
});

// ─── hand-overs already open ────────────────────────────────────────────────

test("a pending hand-over rides on the move and keeps the list manual", () => {
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
  assert.equal(plan.moves[1].pending, null);
  assert.deepEqual(plan.preselected, []);
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

// ─── siblings: the kiosk's single-direction rule ────────────────────────────

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
    plan.moves.map((m) => m.direction),
    ["out", "out"]
  );
  assert.deepEqual(plan.preselected, ["a", "b"]);
});

test("one arriving, one leaving → nothing ticked: a list that points both ways is chosen by hand", () => {
  const plan = planSelf([child("a"), child("b", { check_in_at: iso(-3600 * 1000) })], NOW);
  assert.deepEqual(
    plan.moves.map((m) => m.direction),
    ["in", "out"]
  );
  assert.deepEqual(plan.preselected, []);
});

test("one blocked sibling keeps the whole list manual, even though the other is open", () => {
  const plan = planSelf(
    [
      child("a", { check_in_at: iso(-3600 * 1000) }),
      child("b", { check_in_at: iso(-3600 * 1000), can_pickup: false }),
    ],
    NOW
  );
  assert.equal(plan.moves[0].blocked, null);
  assert.equal(plan.moves[1].blocked, "pickup_not_allowed");
  assert.deepEqual(plan.preselected, []);
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

// ─── the code's clock ───────────────────────────────────────────────────────

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

test("the contract's bounds: a code lives 90 s and a scanned one has at least 60", () => {
  assert.equal(DOOR_CODE_TTL_MS, 90 * 1000);
  assert.equal(DOOR_CODE_MIN_LEFT_MS, 60 * 1000);
});

test("codeDeadline trusts a plausible reading as it is — the phone's clock agrees with the server's", () => {
  // 75 s left on the server, read on a phone whose clock is right.
  assert.equal(codeDeadline(iso(75 * 1000), NOW), NOW + 75 * 1000);
  // A small skew shifts the countdown by as much, nothing more: 75 s left,
  // phone 10 s fast → 65 s shown.
  assert.equal(codeDeadline(iso(75 * 1000), NOW + 10 * 1000), NOW + 10 * 1000 + 65 * 1000);
  assert.equal(codeDeadline(iso(1000), NOW), NOW + 1000);
});

test("codeDeadline: a phone running fast never locks the door on its own clock", () => {
  // 75 s left on the server; the phone is 90 s ahead, so it reads the code as
  // dead 15 s ago — and the peek that just succeeded says otherwise. The
  // floor stands in: a code off a live kiosk has ≥ 60 s.
  const fast = NOW + 90 * 1000;
  assert.equal(codeDeadline(iso(75 * 1000), fast), fast + DOOR_CODE_MIN_LEFT_MS);
  assert.ok(remainingSeconds(codeDeadline(iso(75 * 1000), fast), fast) > 0);
  // Exactly at the stamp counts as past it.
  assert.equal(codeDeadline(iso(0), NOW), NOW + DOOR_CODE_MIN_LEFT_MS);
});

test("codeDeadline: a phone running slow never shows more than a code can have", () => {
  // 75 s left on the server; the phone is 60 s behind, so it would count
  // down from 135 s — the cap is the code's whole life.
  const slow = NOW - 60 * 1000;
  assert.equal(codeDeadline(iso(75 * 1000), slow), slow + DOOR_CODE_TTL_MS);
  assert.equal(remainingSeconds(codeDeadline(iso(75 * 1000), slow), slow), 90);
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
