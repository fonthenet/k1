/**
 * Fold messages/_pending/<package>.json fragments into messages/<locale>/<ns>.json.
 *
 * Several people (or agents) adding keys to the same JSON file at the same
 * time is a merge conflict every time. A fragment per package — one file
 * holding fr, en and ar for the keys that package introduced — lets them work
 * in parallel; this folds the fragments in afterwards, in one place, and
 * refuses to overwrite an existing key with a different value rather than
 * letting the last writer win silently.
 *
 *   node scripts/merge-message-fragments.mjs            # merge + delete fragments
 *   node scripts/merge-message-fragments.mjs --dry-run  # report only
 */
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pending = path.join(root, "messages", "_pending");
const dry = process.argv.includes("--dry-run");
const LOCALES = ["fr", "en", "ar"];

if (!existsSync(pending)) { console.log("no messages/_pending — nothing to merge"); process.exit(0); }
const fragments = readdirSync(pending).filter((f) => f.endsWith(".json")).sort();
if (fragments.length === 0) { console.log("no fragments"); process.exit(0); }

let added = 0, conflicts = 0, same = 0;
const touched = new Set();

function merge(target, source, trail, file) {
  for (const [k, v] of Object.entries(source)) {
    const here = [...trail, k].join(".");
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (target[k] !== undefined && (typeof target[k] !== "object" || target[k] === null)) {
        console.error(`  ✗ ${file}: ${here} is an object in the fragment but a string in the target`);
        conflicts++; continue;
      }
      target[k] ??= {};
      merge(target[k], v, [...trail, k], file);
    } else if (target[k] === undefined) {
      target[k] = v; added++;
    } else if (target[k] === v) {
      same++;
    } else {
      console.error(`  ✗ ${file}: ${here} already exists with a different value\n      have: ${JSON.stringify(target[k])}\n      want: ${JSON.stringify(v)}`);
      conflicts++;
    }
  }
}

for (const f of fragments) {
  const frag = JSON.parse(readFileSync(path.join(pending, f), "utf8"));
  console.log(`• ${f}`);
  for (const locale of LOCALES) {
    if (!frag[locale]) { console.error(`  ✗ ${f}: missing locale ${locale}`); conflicts++; continue; }
    for (const [ns, tree] of Object.entries(frag[locale])) {
      const target = path.join(root, "messages", locale, `${ns}.json`);
      if (!existsSync(target)) { console.error(`  ✗ ${f}: unknown namespace ${ns}`); conflicts++; continue; }
      const data = JSON.parse(readFileSync(target, "utf8"));
      merge(data, tree, [], f);
      if (!dry) writeFileSync(target, JSON.stringify(data, null, 2) + "\n");
      touched.add(`${locale}/${ns}.json`);
    }
  }
}

// The same key tree must exist under every locale of a fragment; a key that
// is only in fr would pass the merge and fail the parity check later.
for (const f of fragments) {
  const frag = JSON.parse(readFileSync(path.join(pending, f), "utf8"));
  const keys = (o, t = []) => Object.entries(o ?? {}).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, [...t, k]) : [[...t, k].join(".")]);
  const sets = LOCALES.map((l) => new Set(keys(frag[l])));
  for (let i = 1; i < sets.length; i++) {
    for (const k of sets[0]) if (!sets[i].has(k)) { console.error(`  ✗ ${f}: ${k} missing in ${LOCALES[i]}`); conflicts++; }
    for (const k of sets[i]) if (!sets[0].has(k)) { console.error(`  ✗ ${f}: ${k} missing in fr`); conflicts++; }
  }
}

console.log(`\n${added} keys added, ${same} identical, ${conflicts} conflicts, files: ${[...touched].sort().join(", ")}`);
if (conflicts > 0) { console.error("\nconflicts — nothing deleted; fix the fragments and re-run"); process.exit(1); }
if (!dry) { for (const f of fragments) unlinkSync(path.join(pending, f)); console.log("fragments folded in and removed"); }
