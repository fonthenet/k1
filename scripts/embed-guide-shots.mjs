/**
 * Puts the captured screenshots into public/guide.html.
 *
 *   node scripts/capture-guide-shots.mjs      # take them
 *   node scripts/embed-guide-shots.mjs        # place them
 *
 * Steps carry `data-shot="<name>"`, written when the guide is generated. This
 * looks for public/guide-shots/<locale>-<name>.png, makes a web-sized copy,
 * and drops an <img> into that step. A step whose shot is missing is left
 * exactly as it is — a guide with some pictures beats one that fails to
 * build because a screen was renamed.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SHOTS = path.join(ROOT, "public", "guide-shots");
const WEB = path.join(SHOTS, "web");
const GUIDE = path.join(ROOT, "public", "guide.html");
// Wide enough that a director can actually read the labels in the picture.
// The page column is widened to match in guide.html; a screenshot narrower
// than the prose it illustrates is decoration, not instruction.
const WIDTH = 1100;

if (!existsSync(SHOTS)) {
  console.error("No public/guide-shots/ — run scripts/capture-guide-shots.mjs first.");
  process.exit(1);
}
if (!existsSync(WEB)) mkdirSync(WEB, { recursive: true });

// Downscale once, here, rather than shipping 2× retina PNGs to a phone on
// Algerian mobile data.
const sources = readdirSync(SHOTS).filter((f) => f.endsWith(".png"));
const dims = new Map();
let bytesBefore = 0, bytesAfter = 0;
for (const f of sources) {
  const src = path.join(SHOTS, f);
  const dst = path.join(WEB, f);
  const pipeline = sharp(src).resize(WIDTH).png({ compressionLevel: 9, palette: true });
  const { data: out, info } = await pipeline.toBuffer({ resolveWithObject: true });
  dims.set(f, { w: info.width, h: info.height });
  writeFileSync(dst, out);
  bytesBefore += readFileSync(src).length;
  bytesAfter += out.length;
}
console.log(
  `${sources.length} shots → ${WIDTH}px  (${Math.round(bytesBefore / 1024)}KB → ${Math.round(bytesAfter / 1024)}KB)`
);

if (!existsSync(GUIDE)) {
  console.log("public/guide.html not built yet — shots are ready for it.");
  process.exit(0);
}

let html = readFileSync(GUIDE, "utf8");
let placed = 0;
const missing = new Set();

/**
 * Inject per LANGUAGE BLOCK, not across the whole document.
 *
 * Each language lives in its own <div data-lang="…">, and the earlier
 * version tested for dir="rtl" inside the <li> — which sits on the
 * ancestor, never the item. Every Arabic step was therefore being handed a
 * screenshot of the FRENCH interface, which is precisely the confusion a
 * screenshot is supposed to remove.
 */
for (const lang of ["fr", "ar", "en"]) {
  const open = `<div data-lang="${lang}"`;
  const at = html.indexOf(open);
  if (at === -1) continue;
  // the block ends where the next language block begins, or at </main>
  const nextIdx = ["fr", "ar", "en"]
    .map((l) => html.indexOf(`<div data-lang="${l}"`, at + 1))
    .filter((i) => i > -1);
  const end = nextIdx.length ? Math.min(...nextIdx) : html.indexOf("</main>", at);
  const block = html.slice(at, end);
  // One appearance each. Several steps legitimately mention the same screen,
  // but repeating a picture down a page reads as a mistake, not emphasis.
  const used = new Set();

  const updated = block.replace(
    /<li data-shot="([a-z0-9-]+)">([\s\S]*?)<\/li>/g,
    (whole, name, inner) => {
      if (inner.includes('class="shot"')) return whole;      // already placed
      if (used.has(name)) return whole;
      const file = `${lang}-${name}.png`;
      if (!existsSync(path.join(WEB, file))) { missing.add(file); return whole; }
      used.add(name);
      placed++;
      return `<li data-shot="${name}">${inner}` +
        `<figure class="shot"><img src="/guide-shots/web/${file}" alt="" loading="lazy" width="${dims.get(file)?.w ?? WIDTH}" height="${dims.get(file)?.h ?? ""}"></figure>` +
        `</li>`;
    }
  );
  html = html.slice(0, at) + updated + html.slice(end);
}

writeFileSync(GUIDE, html);
console.log(`placed ${placed} screenshots`);
if (missing.size) console.log(`not captured yet: ${[...missing].join(", ")}`);
