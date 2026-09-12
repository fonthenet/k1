import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/rooms.test.mjs`.
//
// The room rules of 0155 as seen from the app: the DETAIL parser every error
// mapping shares, the schedule normaliser that twins kg_activity_schedule_normalise,
// and the picker's verdicts. This file is the proof of the refused save that
// nobody may attempt by hand on the demo (the rehearsal's B1 is the other
// half): explicit × explicit is red before the database says 23P01.
//
// The modules under test are the app's own TypeScript, which imports the way
// the bundler does — `@/lib/week` for the day keys, relative paths without an
// extension. Node resolves neither, so the same resolve hook as
// learning.test.mjs maps `@/` to src/ and adds the extension.
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

const { clashFromDetails, isRoomClash, isStaffClash, isClassClash } = await import(
  "../src/lib/db-clash.ts"
);
const { normaliseSchedule, sortSchedule, slotOccurrences } = await import(
  "../src/lib/activity-schedule.ts"
);
const { roomStates, occupantLabel, algiersDaySlices } = await import(
  "../src/components/modules/rooms/room-state.ts"
);

const room4 = "4b2e1c0a-1111-4aaa-8bbb-000000000004";
const anglais = "a1a1a1a1-2222-4aaa-8bbb-000000000001";
const lesson = "c00df93e-7e4c-43ec-bc44-ff1af29dfcb5";

// ─── db-clash ───────────────────────────────────────────────────────────────

test("clashFromDetails reads the exclusion's DETAIL: the LAST range is the row that was there", () => {
  const details =
    `Key (room_id, during)=(${room4}, ["2026-09-13 10:00:00+00","2026-09-13 10:45:00+00")) ` +
    `conflicts with existing key (room_id, during)=(${room4}, ["2026-09-13 10:00:00+00","2026-09-13 11:00:00+00")).`;
  assert.deepEqual(clashFromDetails(details), { date: "2026-09-13", start: "11:00", end: "12:00", endDate: "2026-09-13" });
});

test("clashFromDetails reads refuse_activity_overlap's DETAIL (a booking over an activity occurrence)", () => {
  const details =
    `Key (room_id, during)=(${room4}, ["2026-09-13 10:00:00+00","2026-09-13 10:45:00+00")) ` +
    `conflicts with activity ${anglais} (Anglais) at (${room4}, ["2026-09-13 10:00:00+00","2026-09-13 11:00:00+00"))`;
  assert.deepEqual(clashFromDetails(details), { date: "2026-09-13", start: "11:00", end: "12:00", endDate: "2026-09-13" });
});

test("clashFromDetails reads the guard's dated branch (an activity over an explicit booking)", () => {
  const details =
    `Key (room_id, during)=(${room4}, weekly) conflicts with existing key (room_id, during)=` +
    `(${room4}, ["2026-09-14 11:15:00+00","2026-09-14 12:00:00+00")) session `;
  assert.deepEqual(clashFromDetails(details), { date: "2026-09-14", start: "12:15", end: "13:00", endDate: "2026-09-14" });
});

test("clashFromDetails is undefined on the weekday branch (activity against activity) and on nothing", () => {
  const details =
    `Key (room_id, weekday)=(${room4}, 1) conflicts with activity ${anglais} (Coran) at (09:00:00 – 10:00:00)`;
  assert.equal(clashFromDetails(details), undefined);
  assert.equal(clashFromDetails(undefined), undefined);
  assert.equal(clashFromDetails(""), undefined);
});

test("clashFromDetails lands on the Algiers date when the UTC bound is the evening before", () => {
  const details = `Key (room_id, during)=(x, ["2026-09-13 23:30:00+00","2026-09-14 00:15:00+00"))`;
  assert.deepEqual(clashFromDetails(details), { date: "2026-09-14", start: "00:30", end: "01:15", endDate: "2026-09-14" });
});

test("clashFromDetails keeps the end's own day when the booking crosses midnight", () => {
  // A two-day event in the yard, 13:00 → 11:00 the next day: the footer
  // must be able to say the second day instead of "13:00 – 11:00".
  const details = `Key (room_id, during)=(x, ["2026-10-05 12:00:00+00","2026-10-06 10:00:00+00"))`;
  assert.deepEqual(clashFromDetails(details), { date: "2026-10-05", start: "13:00", end: "11:00", endDate: "2026-10-06" });
});

test("isRoomClash names both room refusals and nothing else", () => {
  assert.equal(
    isRoomClash(`conflicting key value violates exclusion constraint "room_booking_no_overlap"`),
    true,
  );
  assert.equal(isRoomClash(`room_booking_activity_overlap: room ${room4} is taken by activity ${anglais}`), true);
  assert.equal(
    isRoomClash(`conflicting key value violates exclusion constraint "staff_booking_no_overlap"`),
    false,
  );
  assert.equal(isRoomClash(undefined), false);
});

test("isStaffClash and isClassClash keep the lesson mapping's two other words", () => {
  assert.equal(isStaffClash(`kg_learning_lessons_membership_id_tstzrange_excl`), true);
  assert.equal(isStaffClash(`staff_booking_no_overlap`), true);
  assert.equal(isStaffClash(`room_booking_no_overlap`), false);
  assert.equal(isClassClash(`kg_learning_lessons_class_id_tstzrange_excl`), true);
  assert.equal(isClassClash(`room_booking_no_overlap`), false);
});

// ─── activity-schedule ──────────────────────────────────────────────────────

const strip = (slots) => slots.map(({ day, start, end }) => ({ day, start, end }));

test("normaliseSchedule twins kg_activity_schedule_normalise on the migration's rehearsal input", () => {
  // The exact input and the exact expected output of 0155's in-transaction
  // rehearsal (§13 of the migration): integer day, legacy {day,time} with a
  // derived end, 7 = Sunday with "HH:MM:SS" bounds cut to HH:MM, sorted by
  // day then start. If either side changes, this assertion and the SQL
  // rehearsal must change together.
  const input = [
    { day: 2, start: "14:00", end: "15:30" },
    { day: "sun", time: "09:00" },
    { day: 7, start: "08:00:00", end: "08:30:00" },
  ];
  assert.deepEqual(strip(normaliseSchedule(input)), [
    { day: "sun", start: "08:00", end: "08:30" },
    { day: "sun", start: "09:00", end: "10:00" },
    { day: "tue", start: "14:00", end: "15:30" },
  ]);
  // The derived end is flagged, internally, so a later tidy can find it.
  assert.deepEqual(
    normaliseSchedule(input).map((s) => s.legacy === true),
    [false, true, false],
  );
});

test("normaliseSchedule reads each shape on its own", () => {
  assert.deepEqual(strip(normaliseSchedule([{ day: "thu", start: "09:00", end: "10:00" }])), [
    { day: "thu", start: "09:00", end: "10:00" },
  ]);
  assert.deepEqual(strip(normaliseSchedule([{ day: 4, start: "09:00", end: "10:00" }])), [
    { day: "thu", start: "09:00", end: "10:00" },
  ]);
  assert.deepEqual(strip(normaliseSchedule([{ day: "Thu ", time: "09:00:00" }])), [
    { day: "thu", start: "09:00", end: "10:00" },
  ]);
});

test("normaliseSchedule drops what fits neither shape, as the SQL does before its preflight refuses the row", () => {
  assert.deepEqual(normaliseSchedule([{ day: 9, start: "08:00", end: "08:30" }]), []);
  assert.deepEqual(normaliseSchedule([1, "x", null, [{ day: "sun", time: "09:00" }]]), []);
  assert.deepEqual(normaliseSchedule([{ day: "xx", time: "09:00" }]), []);
  assert.deepEqual(normaliseSchedule([{ day: "sun", time: "9:00" }]), []);
  assert.deepEqual(normaliseSchedule({ day: "sun", time: "09:00" }), []);
  assert.deepEqual(normaliseSchedule(null), []);
  assert.deepEqual(normaliseSchedule("[]"), []);
});

test("a derived end wraps at midnight exactly as a Postgres time does", () => {
  assert.deepEqual(strip(normaliseSchedule([{ day: "sat", time: "23:30" }])), [
    { day: "sat", start: "23:30", end: "00:30" },
  ]);
});

test("sortSchedule is week order then start, and never sorts in place", () => {
  const slots = [
    { day: "tue", start: "14:00", end: "15:30" },
    { day: "sun", start: "11:00", end: "12:00" },
    { day: "sun", start: "09:00", end: "10:00" },
  ];
  const sorted = sortSchedule(slots);
  assert.deepEqual(
    sorted.map((s) => `${s.day} ${s.start}`),
    ["sun 09:00", "sun 11:00", "tue 14:00"],
  );
  assert.equal(slots[0].day, "tue");
});

test("slotOccurrences dates a weekly slot across a week, from dates or from instants", () => {
  const slot = { day: "sun", start: "11:00", end: "12:00" };
  // Sunday 13 → Saturday 19 September 2026: one Sunday.
  assert.deepEqual(slotOccurrences(slot, "2026-09-13", "2026-09-20"), [
    { date: "2026-09-13", start: "11:00", end: "12:00" },
  ]);
  // Two weeks, as an instant window in Algiers (+01:00): two Sundays.
  assert.deepEqual(
    slotOccurrences(slot, "2026-09-13T00:00:00+01:00", "2026-09-27T00:00:00+01:00").map((o) => o.date),
    ["2026-09-13", "2026-09-20"],
  );
  // A window that starts mid-morning still returns the slot that overlaps it,
  // as kg_bookings returns it — and not one that ended before it.
  assert.deepEqual(
    slotOccurrences(slot, "2026-09-13T10:30:00.000Z", "2026-09-14T00:00:00.000Z").map((o) => o.date),
    ["2026-09-13"],
  );
  assert.deepEqual(slotOccurrences(slot, "2026-09-13T11:00:00.000Z", "2026-09-14T00:00:00.000Z"), []);
  // Thursday slot, Sun–Thu week: the Thursday.
  assert.deepEqual(
    slotOccurrences({ day: "thu", start: "09:00", end: "10:00" }, "2026-09-13", "2026-09-18").map((o) => o.date),
    ["2026-09-17"],
  );
  // An empty or inverted window is no occurrence at all.
  assert.deepEqual(slotOccurrences(slot, "2026-09-20", "2026-09-13"), []);
  assert.deepEqual(slotOccurrences(slot, "2026-09-13", "2026-09-13"), []);
});

// ─── roomStates ─────────────────────────────────────────────────────────────

const rooms = [
  { id: "r3", name: "Salle 3", name_ar: "القاعة 3", capacity: 20, active: true },
  { id: "r4", name: "Salle 4", name_ar: "القاعة 4", capacity: 20, active: true },
  { id: "r6", name: "Salle 6", name_ar: "القاعة 6", capacity: 24, active: true },
  { id: "r9", name: "Annexe", name_ar: null, capacity: null, active: false },
];
const busy = [
  // 1re année's inherited cours in Salle 6 at 08:30 — the co-tenant of 2e année.
  { id: "l1", kind: "lesson", classId: "c1", className: "1re année", membershipId: "m1", roomId: "r6",
    explicit: false, date: "2026-09-13", start: "08:30", end: "09:15", title: "Lecture" },
  // Anglais reserved Salle 4 explicitly, Sunday 11:00–12:00.
  { id: anglais, kind: "activity", classId: null, className: null, membershipId: null, roomId: "r4",
    explicit: true, date: "2026-09-13", start: "11:00", end: "12:00", title: "Anglais" },
  // Grande Section's inherited Comptines in its own Salle 4 at 11:00.
  { id: "l2", kind: "lesson", classId: "c4", className: "Grande Section", membershipId: "m4", roomId: "r4",
    explicit: false, date: "2026-09-13", start: "11:00", end: "11:45", title: "Comptines : les animaux" },
  // The cours being edited, 2e année in its own Salle 6 at 11:00.
  { id: lesson, kind: "lesson", classId: "c2", className: "2e année", membershipId: "m2", roomId: "r6",
    explicit: false, date: "2026-09-13", start: "11:00", end: "11:45", title: "Soustraction avec retenue" },
  // A follow-up in Salle 6 on Monday at 12:15.
  { id: "s1", kind: "session", classId: null, className: null, membershipId: "m9", roomId: "r6",
    explicit: true, date: "2026-09-14", start: "12:15", end: "13:00", title: "" },
];
const homeClasses = {
  r4: [{ id: "c4", name: "Grande Section", color: "#22c55e" }],
  r6: [{ id: "c1", name: "1re année", color: "#3b82f6" }, { id: "c2", name: "2e année", color: "#8b5cf6" }],
};

test("co-tenant rule: the home option of 2e année at 08:30 has no occupant (1re année's cours is inherited too)", () => {
  const [home] = roomStates([rooms[2]], busy, { date: "2026-09-13", start: "08:30", end: "09:15" }, {
    explicit: false, excludeKind: "lesson", excludeId: "lx", homeClasses, excludeClassId: "c2",
  });
  assert.equal(home.occupant, undefined);
  assert.equal(home.refused, false);
  assert.deepEqual(home.homeClasses.map((c) => c.id), ["c1"]);
});

test("inherited × explicit: Grande Section's home option at 11:00 names Anglais, gold, not refused", () => {
  const [home] = roomStates([rooms[1]], busy, { date: "2026-09-13", start: "11:00", end: "11:45" }, {
    explicit: false, excludeKind: "lesson", excludeId: "l2", homeClasses, excludeClassId: "c4",
  });
  assert.equal(home.occupant?.id, anglais);
  assert.equal(home.occupant?.explicit, true);
  assert.equal(home.refused, false);
});

test("explicit × inherited: a follow-up over an inherited cours is named, gold, not refused", () => {
  const states = roomStates(rooms, busy, { date: "2026-09-13", start: "11:15", end: "11:45" }, {
    explicit: true, homeClasses,
  });
  const salle6 = states.find((s) => s.room.id === "r6");
  assert.equal(salle6.occupant?.id, lesson);
  assert.equal(salle6.refused, false);
  assert.equal(occupantLabel(salle6.occupant, "Suivi individuel"), "2e année · Soustraction avec retenue");
});

test("explicit × explicit: 2e année's cours moved to Salle 4 at 11:00 is refused — the save the database will say no to", () => {
  const states = roomStates(rooms.filter((r) => r.id !== "r6"), busy, { date: "2026-09-13", start: "11:00", end: "11:45" }, {
    explicit: true, excludeKind: "lesson", excludeId: lesson, homeClasses, currentRoomId: "r4",
  });
  const salle4 = states.find((s) => s.room.id === "r4");
  assert.equal(salle4.occupant?.id, anglais);
  assert.equal(salle4.refused, true);
  assert.equal(occupantLabel(salle4.occupant, "Suivi individuel"), "Anglais");
  // Salle 3 reads bare: a free room.
  const salle3 = states.find((s) => s.room.id === "r3");
  assert.equal(salle3.occupant, undefined);
  assert.equal(salle3.refused, false);
});

test("the explicit booking is named whatever order the ledger returned it in — a refusal is never hidden behind an inherited cours", () => {
  // The same Sunday 11:00 in Salle 4, with Comptines (inherited) ahead of Anglais (explicit).
  const reversed = [...busy].reverse();
  const [salle4] = roomStates([rooms[1]], reversed, { date: "2026-09-13", start: "11:00", end: "12:00" }, {
    explicit: true, excludeKind: "lesson", excludeId: lesson, homeClasses,
  });
  assert.equal(salle4.occupant?.id, anglais);
  assert.equal(salle4.refused, true);
  // With no explicit booking in the way, the first overlap in ledger order is the occupant.
  const [gold] = roomStates([rooms[1]], reversed.filter((b) => b.id !== anglais), { date: "2026-09-13", start: "11:00", end: "12:00" }, {
    explicit: true, excludeKind: "lesson", excludeId: lesson, homeClasses,
  });
  assert.equal(gold.occupant?.id, "l2");
  assert.equal(gold.refused, false);
});

test("the record being edited is never its own occupant", () => {
  const [salle6] = roomStates([rooms[2]], busy, { date: "2026-09-13", start: "11:00", end: "11:45" }, {
    explicit: true, excludeKind: "lesson", excludeId: lesson,
  });
  assert.equal(salle6.occupant, undefined);
  // Same id, another kind: still an occupant — an activity occurrence and a lesson can share an id only by accident.
  const [again] = roomStates([rooms[2]], busy, { date: "2026-09-13", start: "11:00", end: "11:45" }, {
    explicit: true, excludeKind: "session", excludeId: lesson,
  });
  assert.equal(again.occupant?.id, lesson);
});

test("a follow-up occupant is labelled by the product's noun, never by the child", () => {
  const [salle6] = roomStates([rooms[2]], busy, { date: "2026-09-14", start: "12:00", end: "12:30" }, {
    explicit: true,
  });
  assert.equal(salle6.occupant?.kind, "session");
  assert.equal(occupantLabel(salle6.occupant, "Suivi individuel"), "Suivi individuel");
});

test("an inactive room is offered only while it is the current choice", () => {
  const offered = roomStates(rooms, [], { date: "2026-09-13", start: "09:00", end: "10:00" }, { explicit: true });
  assert.deepEqual(offered.map((s) => s.room.id), ["r3", "r4", "r6"]);
  const kept = roomStates(rooms, [], { date: "2026-09-13", start: "09:00", end: "10:00" }, {
    explicit: true, currentRoomId: "r9",
  });
  assert.deepEqual(kept.map((s) => s.room.id), ["r3", "r4", "r6", "r9"]);
});

test("tooSmall compares the group to the room, and the occupant wins over it", () => {
  const states = roomStates(rooms, busy, { date: "2026-09-13", start: "11:00", end: "12:00" }, {
    explicit: true, groupSize: 25,
  });
  const salle3 = states.find((s) => s.room.id === "r3");
  assert.equal(salle3.tooSmall, true);
  assert.equal(salle3.groupSize, 25);
  assert.equal(salle3.occupant, undefined);
  const salle4 = states.find((s) => s.room.id === "r4");
  assert.equal(salle4.tooSmall, true);
  assert.equal(salle4.occupant?.id, anglais);
  // No capacity, or no group: never too small.
  const [annexe] = roomStates([rooms[3]], [], null, { explicit: true, groupSize: 25, currentRoomId: "r9" });
  assert.equal(annexe.tooSmall, false);
  const [fits] = roomStates([rooms[0]], [], null, { explicit: true, groupSize: 20 });
  assert.equal(fits.tooSmall, false);
  const [unknown] = roomStates([rooms[0]], [], null, { explicit: true, groupSize: null });
  assert.equal(unknown.tooSmall, false);
});

test("window null (the class dialog): never an occupant, the home classes minus the class itself", () => {
  const states = roomStates(rooms, busy, null, {
    explicit: false, homeClasses, excludeClassId: "c2", groupSize: 30,
  });
  for (const s of states) assert.equal(s.occupant, undefined);
  const salle6 = states.find((s) => s.room.id === "r6");
  assert.deepEqual(salle6.homeClasses.map((c) => c.name), ["1re année"]);
  assert.equal(salle6.tooSmall, true);
  assert.equal(salle6.refused, false);
});

// ─── algiersDaySlices ───────────────────────────────────────────────────────

test("algiersDaySlices cuts a booking at Algiers midnights, one slot per day it touches", () => {
  // A same-day cours is itself.
  assert.deepEqual(algiersDaySlices("2026-09-13T10:00:00+00:00", "2026-09-13T11:00:00+00:00"), [
    { date: "2026-09-13", start: "11:00", end: "12:00" },
  ]);
  // A two-day event: the first day runs to 24:00, the second starts at 00:00.
  assert.deepEqual(algiersDaySlices("2026-10-05T12:00:00+00:00", "2026-10-06T10:00:00+00:00"), [
    { date: "2026-10-05", start: "13:00", end: "24:00" },
    { date: "2026-10-06", start: "00:00", end: "11:00" },
  ]);
  // Three days: a whole middle day.
  assert.deepEqual(algiersDaySlices("2026-10-05T12:00:00+00:00", "2026-10-07T07:00:00+00:00").map((s) => `${s.date} ${s.start}-${s.end}`), [
    "2026-10-05 13:00-24:00",
    "2026-10-06 00:00-24:00",
    "2026-10-07 00:00-08:00",
  ]);
  // An end exactly at midnight is 24:00 on the day before and claims nothing of the next.
  assert.deepEqual(algiersDaySlices("2026-10-05T12:00:00+00:00", "2026-10-05T23:00:00+00:00"), [
    { date: "2026-10-05", start: "13:00", end: "24:00" },
  ]);
  // The Algiers day, not the UTC one: 23:30Z is 00:30 the next day here.
  assert.deepEqual(algiersDaySlices("2026-09-13T23:30:00Z", "2026-09-14T00:15:00Z"), [
    { date: "2026-09-14", start: "00:30", end: "01:15" },
  ]);
});

test("a two-day event in the yard is the occupant on its second day, and refused there", () => {
  const yard = { id: "ry", name: "Cour", name_ar: "الساحة", capacity: null, active: true };
  const slices = algiersDaySlices("2026-10-05T12:00:00+00:00", "2026-10-06T10:00:00+00:00");
  const twoDay = slices.map((slice) => ({
    id: "e2", kind: "event", classId: null, className: null, membershipId: null, roomId: "ry",
    explicit: true, ...slice, title: "Journée sportive",
  }));
  // A follow-up drafted at 09:00 on the second day: the event is named, red.
  const [day2] = roomStates([yard], twoDay, { date: "2026-10-06", start: "09:00", end: "09:45" }, { explicit: true });
  assert.equal(day2.occupant?.id, "e2");
  assert.equal(day2.occupant?.start, "00:00");
  assert.equal(day2.refused, true);
  assert.equal(occupantLabel(day2.occupant, "Suivi individuel"), "Journée sportive");
  // The evening of the first day too, after the event began.
  const [day1] = roomStates([yard], twoDay, { date: "2026-10-05", start: "18:00", end: "19:00" }, { explicit: true });
  assert.equal(day1.occupant?.id, "e2");
  assert.equal(day1.refused, true);
  // The morning of the first day, before it, is free; so is the day after.
  const [before] = roomStates([yard], twoDay, { date: "2026-10-05", start: "09:00", end: "10:00" }, { explicit: true });
  assert.equal(before.occupant, undefined);
  const [after] = roomStates([yard], twoDay, { date: "2026-10-07", start: "09:00", end: "10:00" }, { explicit: true });
  assert.equal(after.occupant, undefined);
});

test("the occupant is the first overlapping booking on the window's day, and only that day", () => {
  const states = roomStates([rooms[1]], busy, { date: "2026-09-14", start: "11:00", end: "12:00" }, {
    explicit: true,
  });
  assert.equal(states[0].occupant, undefined);
  const touching = roomStates([rooms[1]], busy, { date: "2026-09-13", start: "12:00", end: "12:30" }, {
    explicit: true,
  });
  assert.equal(touching[0].occupant, undefined, "12:00 right after Anglais is free");
});
