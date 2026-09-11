import assert from "node:assert/strict";
import test from "node:test";
import {
  programTemplates,
  templatesForType,
} from "../src/components/modules/learning/program-templates.ts";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import {
  date,
  programSchema,
  lessonSchema,
  resultSchema,
  weekStart,
  occurrences,
  seriesFitsProgram,
  learningProfile,
} from "../src/components/modules/learning/domain.ts";

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
