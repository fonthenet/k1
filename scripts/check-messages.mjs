// Two different bugs live in the messages files, and only one of them shows up
// as a locale mismatch:
//
//   1. A key exists in fr but not in ar — the parity check catches it.
//   2. A key is used in code and exists in NO locale — parity is perfectly
//      happy, and the UI renders the raw key. That is how the whole
//      Facturation tab of a child shipped as "children.billing.columns.total".
//
//   3. A key is BUILT from a template — t(`filters.${f}`) — over a list that
//      later grew a member. Parity is happy, the literal scan never sees the
//      key, and the page throws MISSING_MESSAGE at runtime for whichever
//      member is new. That is how "draft" reached the billing filters in all
//      three locales without a single check firing.
//
// This checks all three. Template keys are resolved wherever the variable can
// be traced to a const array of string literals in the same file; the ones
// that cannot be traced are COUNTED and printed, so "checked" never quietly
// means "checked the easy half".
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["ar", "en", "fr"];
const BASE = "fr";

const load = (l) =>
  Object.fromEntries(
    readdirSync(`messages/${l}`).map((f) => [
      f.replace(/\.json$/, ""),
      JSON.parse(readFileSync(`messages/${l}/${f}`, "utf8")),
    ])
  );
const messages = Object.fromEntries(LOCALES.map((l) => [l, load(l)]));

const flat = (o, pre = "") =>
  Object.entries(o).flatMap(([k, v]) => {
    const p = pre ? `${pre}.${k}` : k;
    return typeof v === "object" && v !== null ? flat(v, p) : [p];
  });

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`✗ ${msg}`);
};

// ---- 1. locale parity
for (const ns of Object.keys(messages[BASE])) {
  const base = new Set(flat(messages[BASE][ns]));
  for (const l of LOCALES.filter((x) => x !== BASE)) {
    if (!messages[l][ns]) {
      fail(`${l}: namespace "${ns}" missing entirely`);
      continue;
    }
    const other = new Set(flat(messages[l][ns]));
    for (const k of base) if (!other.has(k)) fail(`${l}/${ns}.json: missing ${k}`);
    for (const k of other) if (!base.has(k)) fail(`${l}/${ns}.json: extra ${k}`);
  }
}

// ---- 2. keys used in code but defined nowhere
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})("src");

const has = (ns, key) => {
  let node = messages[BASE][ns];
  for (const part of key.split(".")) {
    if (node === undefined || node === null || typeof node !== "object") return false;
    node = node[part];
  }
  return node !== undefined;
};

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // Bindings are positional, not per-file: one file often defines eight
  // components, each with its own `const t = getTranslations(...)`. Keying by
  // variable name alone collapses them onto the last one and invents failures.
  const binds = [];
  for (const m of src.matchAll(
    /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g
  )) {
    binds.push({ at: m.index, name: m[1], ns: m[2] });
  }
  if (binds.length === 0) continue;

  const nsFor = (name, at) => {
    let best = null;
    for (const b of binds) if (b.name === name && b.at < at) best = b;
    return best?.ns ?? null;
  };

  for (const m of src.matchAll(/\b(\w+)\(\s*"([^"`$]+)"/g)) {
    const ns = nsFor(m[1], m.index);
    if (!ns) continue;
    const [nsFile, ...nsRest] = ns.split(".");
    if (!messages[BASE][nsFile]) {
      fail(`${file}: unknown namespace "${nsFile}"`);
      continue;
    }
    const path = [...nsRest, m[2]].join(".");
    if (!has(nsFile, path)) fail(`${file}: ${nsFile}.${path} is not defined in any locale`);
  }
}

// Exported string-literal lists, project-wide.
//
// Most of these unions do not live next to the component that renders them —
// STATUSES, ROLES, SEVERITIES sit in a shared types module and are imported.
// Without following the import, every one of those templates was "untraceable"
// and the check covered only the handful of lists declared inline.
const EXPORTED_LISTS = new Map();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(
    /export\s+const\s+([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*\[([^\]]*)\]\s*(?:as\s+const)?/g
  )) {
    const items = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const noise = m[2].replace(/"[^"]*"/g, "").replace(/[\s,]/g, "");
    if (!items.length || noise) continue;
    // A name exported from two files with different members cannot be resolved
    // by name alone — drop it rather than check against the wrong one.
    if (EXPORTED_LISTS.has(m[1]) &&
        EXPORTED_LISTS.get(m[1]).join("\u0000") !== items.join("\u0000")) {
      EXPORTED_LISTS.set(m[1], null);
      continue;
    }
    if (!EXPORTED_LISTS.has(m[1])) EXPORTED_LISTS.set(m[1], items);
  }
}

// ---- 3. keys built from a template over a known list
//
// Only the shapes that actually appear in this codebase, because a general
// solution here is a type checker and this is a 100-line script:
//
//     const FILTERS = ["all", "draft", ...] as const
//     FILTERS.map((f) => t(`filters.${f}`))
//     for (const s of STATUSES) t(`status.${s}.label`)
//
// A member whose message is missing fails. A template whose variable cannot be
// traced to a list is counted as unchecked and reported.
let dynamicChecked = 0;
const untraceable = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");

  const binds = [];
  for (const m of src.matchAll(
    /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g
  )) {
    binds.push({ at: m.index, name: m[1], ns: m[2] });
  }
  if (binds.length === 0) continue;
  const nsFor = (name, at) => {
    let best = null;
    for (const b of binds) if (b.name === name && b.at < at) best = b;
    return best?.ns ?? null;
  };

  // const NAME = ["a", "b"] — string-literal lists only.
  const lists = new Map();
  for (const m of src.matchAll(/const\s+([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*\[([^\]]*)\]\s*(?:as\s+const)?/g)) {
    const items = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const noise = m[2].replace(/"[^"]*"/g, "").replace(/[\s,]/g, "");
    if (items.length && !noise) lists.set(m[1], items);
  }
  // Names this file imports resolve to their exported definition, unless the
  // file shadows them with a local const (checked first, above).
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/\btype\b/, "").split(/\s+as\s+/)[0].trim();
      if (!name || lists.has(name)) continue;
      const members = EXPORTED_LISTS.get(name);
      if (members) lists.set(name, members);
    }
  }

  // Which list does a loop variable range over?
  //
  // Positional, for the same reason nsFor is: one file maps `key` over the tab
  // list in one component and over an info list in another. Keying by name
  // alone collapses them onto whichever came last and invents failures against
  // the wrong list — which is exactly what the first run of this check did.
  const loops = [];
  const remember = (at, v, l) => {
    if (lists.has(l)) loops.push({ at, name: v, members: lists.get(l) });
  };
  for (const m of src.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*(?:map|flatMap|forEach|filter)\s*\(\s*\(?\s*([A-Za-z_]\w*)/g)) {
    remember(m.index, m[2], m[1]);
  }
  for (const m of src.matchAll(/for\s*\(\s*const\s+([A-Za-z_]\w*)\s+of\s+([A-Za-z_]\w*)/g)) {
    remember(m.index, m[1], m[2]);
  }
  // Anything that rebinds the name in a way this script cannot follow KILLS the
  // binding from that point on, rather than letting a stale one stand:
  //
  //     ([["a", x], ["b", y]] as const).map(([key, value]) => t(`info.${key}`))
  //     const key = eatenKey(m.eaten);          t(`eaten.${key}`)
  //
  // Both reuse a name an earlier .map() bound to a real list, and checking the
  // template against that list produced six confident, wrong failures. An
  // untraceable variable is reported as unchecked — never guessed at.
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?!\[)/g)) {
    loops.push({ at: m.index, name: m[1], members: null });
  }
  for (const m of src.matchAll(/\.\s*(?:map|flatMap|forEach|filter)\s*\(\s*\(?\s*[[{]\s*([A-Za-z_]\w*)/g)) {
    loops.push({ at: m.index, name: m[1], members: null });
  }

  const listFor = (name, at) => {
    let best = null;
    for (const l of loops) if (l.name === name && l.at < at) best = l;
    return best?.members ?? null;
  };

  // t(`prefix.${VAR}suffix`)
  for (const m of src.matchAll(/\b(\w+)\(\s*`([^`$]*)\$\{\s*([A-Za-z_]\w*)\s*\}([^`$]*)`/g)) {
    const [, fn, prefix, varName, suffix] = m;
    const ns = nsFor(fn, m.index);
    if (!ns) continue;
    const [nsFile, ...nsRest] = ns.split(".");
    if (!messages[BASE][nsFile]) continue;
    const members = listFor(varName, m.index);
    if (!members) {
      untraceable.push(`${file}: ${ns}.${prefix}\${${varName}}${suffix}`);
      continue;
    }
    for (const member of members) {
      const path = [...nsRest, `${prefix}${member}${suffix}`].join(".");
      dynamicChecked++;
      if (!has(nsFile, path)) {
        fail(`${file}: ${nsFile}.${path} is not defined in any locale (built from \`${prefix}\${${varName}}${suffix}\`)`);
      }
    }
  }
}

if (untraceable.length) {
  console.log(`\n${untraceable.length} template key(s) not statically traceable — verify by hand:`);
  for (const u of untraceable) console.log(`  · ${u}`);
}

if (failures) {
  console.error(`\n${failures} message problem(s).`);
  process.exit(1);
}
console.log(
  `\nmessages OK — locales in parity, every literal key resolves, ` +
    `${dynamicChecked} template key(s) resolved`
);
