// Two different bugs live in the messages files, and only one of them shows up
// as a locale mismatch:
//
//   1. A key exists in fr but not in ar — the parity check catches it.
//   2. A key is used in code and exists in NO locale — parity is perfectly
//      happy, and the UI renders the raw key. That is how the whole
//      Facturation tab of a child shipped as "children.billing.columns.total".
//
// This checks both. Only literal keys are verified; template keys like
// t(`status.${x}`) are reported as unresolved namespaces, not failures.
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

if (failures) {
  console.error(`\n${failures} message problem(s).`);
  process.exit(1);
}
console.log("messages OK — locales in parity, every literal key resolves");
