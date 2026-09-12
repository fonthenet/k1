import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";

// `node --test scripts/learning-profile.test.mjs` (Node 22.18+ or 23.6+, where
// TypeScript is stripped natively; earlier 22.x needs --experimental-strip-types).
//
// One rule, written twice on purpose: learningProfile() in
// src/components/modules/learning/domain.ts decides which sections a screen
// draws for a structure type, and kg_learning_profile() in migration 0152
// decides which sections the evening sender composes for the same type. The
// two must never drift — a crèche family would otherwise be pushed a "cours"
// count while the portal shows "activités" — so this test reads the SQL CASE
// out of the migration file, evaluates it the way Postgres would, and compares
// it with the TypeScript function over every value of kg_center_type, taken
// from the migrations that declare the enum rather than from a list typed
// here (a value added later fails the test until both twins know it).
//
// The resolve hook is the one scripts/learning.test.mjs uses: domain.ts
// imports `@/lib/...` and extension-less relative paths the way the bundler
// does, and Node resolves neither on its own.
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

const { learningProfile } = await import(
  "../src/components/modules/learning/domain.ts"
);

const migrations = new URL("../supabase/migrations/", import.meta.url);
const migrationFiles = readdirSync(migrations)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const readMigration = (name) =>
  readFileSync(new URL(name, migrations), "utf8");

/** The ten values of kg_center_type, read from the migration that created the
 *  enum (0009) and every later `add value` — the database's own list. */
function centerTypesFromMigrations() {
  const values = [];
  for (const name of migrationFiles) {
    const sql = readMigration(name);
    const created = sql.match(
      /create type (?:public\.)?kg_center_type as enum\s*\(([^)]*)\)/i,
    );
    if (created)
      for (const [, value] of created[1].matchAll(/'([^']+)'/g))
        values.push(value);
    for (const [, value] of sql.matchAll(
      /alter type (?:public\.)?kg_center_type add value(?: if not exists)? '([^']+)'/gi,
    ))
      values.push(value);
  }
  return values;
}

/** The CASE of kg_learning_profile(p_type), parsed into ordered branches so
 *  it can be evaluated exactly as Postgres does: first matching WHEN wins,
 *  ELSE otherwise. Only the two shapes the function uses are understood
 *  (`p_type in (...)` and `p_type = '...'`); anything else fails loudly rather
 *  than silently comparing against an empty rule. */
function sqlProfileFromMigration(sql) {
  const fn = sql.match(
    /create or replace function public\.kg_learning_profile\(p_type text\) returns text[\s\S]*?\$\$([\s\S]*?)\$\$;/,
  );
  assert.ok(fn, "kg_learning_profile is defined in the migration");
  const body = fn[1];
  const caseExpr = body.match(/\bcase\b([\s\S]*?)\bend\b/);
  assert.ok(caseExpr, "kg_learning_profile is a single CASE expression");
  const branches = [];
  for (const m of caseExpr[1].matchAll(
    /when p_type (?:in \(([^)]*)\)|= '([^']+)') then '([^']+)'/g,
  )) {
    const types = m[1]
      ? [...m[1].matchAll(/'([^']+)'/g)].map(([, v]) => v)
      : [m[2]];
    branches.push({ types, profile: m[3] });
  }
  const fallback = caseExpr[1].match(/else '([^']+)'/);
  assert.ok(fallback, "the CASE has an ELSE");
  const whens = caseExpr[1].match(/\bwhen\b/g) ?? [];
  assert.equal(
    branches.length,
    whens.length,
    "every WHEN of the CASE was understood by the parser",
  );
  return (type) =>
    branches.find((b) => b.types.includes(type))?.profile ?? fallback[1];
}

const migration0152 = migrationFiles.find((name) =>
  name.startsWith("0152_kg_daily_journal"),
);
assert.ok(migration0152, "migration 0152_kg_daily_journal.sql exists");
const sqlProfile = sqlProfileFromMigration(readMigration(migration0152));
const centerTypes = centerTypesFromMigrations();

test("the enum holds the ten centre types the product knows", () => {
  assert.deepEqual(
    [...centerTypes].sort(),
    [
      "activity_center",
      "camp",
      "edu_center",
      "kindergarten",
      "montessori",
      "nursery",
      "private_middle",
      "private_primary",
      "private_secondary",
      "therapy_center",
    ],
  );
});

test("kg_learning_profile() equals learningProfile() for every centre type", () => {
  for (const type of centerTypes)
    assert.equal(
      sqlProfile(type),
      learningProfile(type),
      `profile of ${type}: SQL says ${sqlProfile(type)}, TypeScript says ${learningProfile(type)}`,
    );
});

test("montessori is a development profile on both sides", () => {
  // Montessori is not named by either CASE: it falls through to the default,
  // and the default is what a préscolaire family must receive.
  assert.equal(learningProfile("montessori"), "development");
  assert.equal(sqlProfile("montessori"), "development");
});

test("every profile the SQL can return is one the app draws sections for", () => {
  const profiles = new Set(centerTypes.map(sqlProfile));
  assert.deepEqual(
    [...profiles].sort(),
    ["academic", "activities", "care", "development", "therapy"],
  );
});
