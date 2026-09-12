import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/learning.test.mjs`.
//
// The modules under test are the app's own TypeScript, which imports the way
// the bundler does — `@/lib/algiers` for the shared clock, and relative paths
// without an extension. Node resolves neither, so a resolve hook maps `@/` to
// src/ and adds the .ts extension when the file is there. The hook lives in
// this file as a data: URL, and the modules are imported AFTER it is
// registered (a static import would be resolved before this line ran).
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

const { programTemplates, templatesForType } = await import(
  "../src/components/modules/learning/program-templates.ts"
);
const {
  date,
  programSchema,
  lessonSchema,
  updateLessonSchema,
  resultSchema,
  weekStart,
  occurrences,
  seriesFitsProgram,
  learningProfile,
  lessonNounProfile,
  scopeProfile,
} = await import("../src/components/modules/learning/domain.ts");

const id = "018b78d0-91d4-49aa-9070-52c123456789";
test("the entire repeated series must fit the program", () => {
  assert.equal(
    seriesFitsProgram("2026-09-13", 3, "2026-09-01", "2026-09-27"),
    true,
  );
  assert.equal(
    seriesFitsProgram("2026-09-13", 4, "2026-09-01", "2026-09-27"),
    false,
  );
  assert.equal(
    seriesFitsProgram("2026-09-27", 1, "2026-09-01", "2026-09-27"),
    true,
  );
  assert.equal(
    seriesFitsProgram("2026-09-27", 2, "2026-09-01", "2026-09-27"),
    false,
  );
  assert.equal(
    seriesFitsProgram("2026-08-30", 1, "2026-09-01", "2026-09-27"),
    false,
  );
  for (const weeks of [0, 17, 1.5, NaN])
    assert.equal(
      seriesFitsProgram("2026-09-13", weeks, "2026-09-01", "2027-09-01"),
      false,
    );
  assert.equal(seriesFitsProgram("bad", 1, "2026-09-01", "2026-09-27"), false);
});
test("program suggestions cover every business type without inventing an unknown curriculum", () => {
  assert.equal(Object.keys(programTemplates).length, 10);
  assert.deepEqual(templatesForType("unknown"), []);
  assert.deepEqual(templatesForType("__proto__"), []);
  assert.ok(templatesForType("nursery").includes("routines"));
  assert.ok(!templatesForType("nursery").includes("maths"));
  assert.ok(templatesForType("montessori").includes("practical"));
  assert.ok(templatesForType("private_secondary").includes("science"));
  for (const locale of ["ar", "fr", "en"]) {
    const messages = JSON.parse(
      readFileSync(
        new URL(`../messages/${locale}/learning.json`, import.meta.url),
      ),
    );
    for (const type of Object.keys(programTemplates)) {
      for (const key of templatesForType(type)) {
        const entry = messages.templates[key];
        assert.ok(
          entry.title && entry.objectives && entry.activities,
          `${locale}/${type}/${key}`,
        );
        assert.ok(
          programSchema.safeParse({
            classId: id,
            title: entry.title,
            objectives: `${entry.objectives}\n${entry.activities}`,
            startsOn: "2026-09-06",
            endsOn: "2026-10-06",
          }).success,
        );
      }
    }
  }
});
test("learning fields always use themed calendars and dropdowns", () => {
  for (const directory of [
    "../src/components/modules/learning/",
    "../src/app/(dashboard)/learning/",
  ]) {
    const root = new URL(directory, import.meta.url);
    for (const file of readdirSync(root, { recursive: true })) {
      if (!String(file).endsWith(".tsx")) continue;
      const source = readFileSync(new URL(String(file), root), "utf8");
      assert.doesNotMatch(
        source,
        /type\s*=\s*["'](?:date|time)["']/,
        `${file}: use the shared themed DatePicker and TimePicker`,
      );
      assert.doesNotMatch(
        source,
        /<select\b/,
        `${file}: use the shared themed FormSelect`,
      );
    }
  }
});
test("Algerian weeks start Sunday across month and year boundaries", () => {
  assert.equal(weekStart("2026-09-10"), "2026-09-06");
  assert.equal(weekStart("2027-01-01"), "2026-12-27");
  assert.equal(weekStart("2026-09-13"), "2026-09-13");
});
test("weekly recurrence preserves local time across European DST", () => {
  const rows = occurrences("2026-10-18", "09:00", "10:00", 3);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].starts_at, "2026-11-01T09:00:00+01:00");
});
test("invalid dates, reversed ranges and empty titles are rejected", () => {
  assert.equal(date.safeParse("2026-02-30").success, false);
  assert.equal(
    programSchema.safeParse({
      classId: id,
      title: "Math",
      objectives: "",
      startsOn: "2026-10-01",
      endsOn: "2026-09-01",
    }).success,
    false,
  );
  assert.equal(
    lessonSchema.safeParse({
      classId: id,
      programId: id,
      membershipId: id,
      title: "Math",
      kind: "lesson",
      date: "2026-09-13",
      start: "10:00",
      end: "09:00",
      weeks: 1,
    }).success,
    false,
  );
});
test("a class plans its week without a programme, but a cours still needs one", () => {
  const series = {
    classId: id,
    membershipId: id,
    title: "Accueil",
    date: "2026-09-13",
    start: "08:00",
    end: "09:00",
    weeks: 4,
  };
  // The form sends "" for "Sans programme"; the schema stores null.
  const care = lessonSchema.safeParse({ ...series, kind: "care", programId: "" });
  assert.equal(care.success, true);
  assert.equal(care.data.programId, null);
  assert.equal(lessonSchema.safeParse({ ...series, kind: "activity", programId: null }).success, true);
  assert.equal(lessonSchema.safeParse({ ...series, kind: "lesson", programId: null }).success, false);
  assert.equal(lessonSchema.safeParse({ ...series, kind: "lesson", programId: id }).success, true);
  // The class is now the series' own fact, not the programme's.
  assert.equal(
    lessonSchema.safeParse({ ...series, classId: undefined, kind: "activity", programId: null }).success,
    false,
  );

  const one = { id, membershipId: id, title: "Éveil", date: "2026-09-13", start: "09:30", end: "10:00" };
  assert.equal(updateLessonSchema.safeParse({ ...one, kind: "activity", programId: null }).success, true);
  assert.equal(updateLessonSchema.safeParse({ ...one, kind: "lesson", programId: null }).success, false);
  assert.equal(updateLessonSchema.safeParse({ ...one, kind: "lesson", programId: id }).success, true);
});
test("one timetable noun per profile, one profile per scope", () => {
  assert.equal(lessonNounProfile("academic"), "academic");
  assert.equal(lessonNounProfile("therapy"), "therapy");
  for (const profile of ["care", "development", "activities"])
    assert.equal(lessonNounProfile(profile), "other");
  // An école among the structures makes the building speak cours; without
  // one it is a préscolaire, whatever else it holds.
  assert.equal(scopeProfile(["nursery", "kindergarten", "private_primary"]), "academic");
  assert.equal(scopeProfile(["nursery", "kindergarten"]), "development");
  assert.equal(scopeProfile([]), "development");
});
test("zero is a valid mark; absence cannot silently become zero", () => {
  const base = { assessmentId: id, childId: id, feedback: "" };
  assert.equal(
    resultSchema.safeParse({ ...base, outcome: "graded", score: 0 }).success,
    true,
  );
  assert.equal(
    resultSchema.safeParse({ ...base, outcome: "graded", score: null }).success,
    false,
  );
  assert.equal(
    resultSchema.safeParse({ ...base, outcome: "absent", score: 0 }).success,
    false,
  );
  assert.equal(
    resultSchema.safeParse({ ...base, outcome: "absent", score: null }).success,
    true,
  );
});
test("business profiles separate examinations from early-years observations", () => {
  for (const type of [
    "private_primary",
    "private_middle",
    "private_secondary",
    "edu_center",
  ])
    assert.equal(learningProfile(type), "academic");
  assert.equal(learningProfile("nursery"), "care");
  assert.equal(learningProfile("kindergarten"), "development");
  assert.equal(learningProfile("montessori"), "development");
  assert.equal(learningProfile("therapy_center"), "therapy");
  assert.equal(learningProfile("camp"), "activities");
});
test("learning translation keys match in Arabic, English and French", () => {
  const keys = (obj) =>
    Object.entries(obj)
      .flatMap(([k, v]) =>
        typeof v === "object" ? keys(v).map((s) => `${k}.${s}`) : [k],
      )
      .sort();
  const messages = ["en", "ar", "fr"].map((locale) =>
    JSON.parse(
      readFileSync(
        new URL(`../messages/${locale}/learning.json`, import.meta.url),
      ),
    ),
  );
  assert.deepEqual(keys(messages[0]), keys(messages[1]));
  assert.deepEqual(keys(messages[0]), keys(messages[2]));
});
