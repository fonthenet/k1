/**
 * Demo seed for the dossier d'inscription (0164) — the nine objects.
 *
 *   node scripts/seed-dossier-demo.mjs              # render, upload, print the nine paths, write the seed SQL
 *   DRY_RUN=1 node scripts/seed-dossier-demo.mjs    # render the papers to disk only — look at them first
 *   FORCE=1 …                                       # upload even though the demo register already has rows
 *
 * WHAT IT DOES. The demo tenant (روضة الأمل, 732bdf7d…) is the sales showcase:
 * /applications must show آلاء with one accepted paper, one to check and one
 * refused; /children must show Adam Amrani with four accepted papers, one
 * expired certificat and two still to bring; the family's wizard must offer
 * a blank fiche d'engagement to download. Those rows point at files in the
 * private kg-media bucket, and the register refuses a path that names no
 * object — so the files come first, uploaded through the Storage API as the
 * directrice with the ANON key and her own session, exactly the way the
 * office uploads a scan. No service key exists in this app and none is used.
 *
 * Then the register rows: this script cannot write them (the anon key only
 * ever speaks through RLS, and the seed also flips the tenant's list on) —
 * it writes the seed SQL with the nine paths filled in next to the rendered
 * papers, and the lead runs that file through execute_sql on the demo
 * tenant, then reads its verifying SELECTs.
 *
 * THE PAPERS are drawn here, from the demo's own names (the application's
 * child payload, Adam's record, the tenant's letterhead), as SVG pages
 * rasterised by sharp — it ships with Next's image pipeline and shapes
 * Arabic through pango/harfbuzz, so the bilingual extrait reads right. The
 * three PDFs (the blank form, Adam's contrat and fiche) are the same page
 * wrapped as one JPEG in a one-page PDF: a scan, which is what the office
 * would have. آلاء's certificat is deliberately blurred and tilted — it is the
 * paper the directrice refused with "Photo floue".
 *
 * SECRETS. The password is read from ~/rawdatik-secrets/demo-password, else
 * RAWDATIK_PASSWORD (from .env.local, like scripts/capture-guide-shots.mjs).
 * It is never printed, never written. Point this at the demo tenant only —
 * every path below is built from its id, and the real client is never named.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

/* ── Who and where ───────────────────────────────────────────────────────── */

const TENANT = "732bdf7d-775a-4ed7-875f-8c04ea4e4778";
const ADAM = "809202b0-ab41-4523-8f4c-298aae11fa5e";
const APP_PREFIX = "fde84844";
const LOGIN = "directrice@rawdatik.com";
const BUCKET = "kg-media";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.replace(/^["']|["']$/g, "");
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";
const OUT = process.env.OUT ?? path.join(os.tmpdir(), "rawdatik-dossier-seed");

function readPassword() {
  const file = path.join(os.homedir(), "rawdatik-secrets", "demo-password");
  if (existsSync(file)) return readFileSync(file, "utf8").split(/\r?\n/)[0].trim();
  return process.env.RAWDATIK_PASSWORD ?? "";
}

/* ── Drawing ─────────────────────────────────────────────────────────────── */

// A4 at 150 dpi: legible on a phone, a few hundred KB as JPEG, and the size
// a real scan of a paper comes in at.
const W = 1240;
const H = 1754;
const M = 110;
const FONT = "Helvetica, Arial, 'Noto Naskh Arabic', sans-serif";

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One <text>. `anchor` says which edge sits at x — "start" the left, "end"
 * the right, "middle" the centre — for BOTH scripts: an Arabic run sets
 * `rtl` so pango shapes and orders it, and SVG's own anchor words then flip
 * (the "start" of an RTL run is its right edge), which is why they are
 * swapped here rather than at every call.
 */
function text(x, y, s, o = {}) {
  const size = o.size ?? 26;
  const weight = o.bold ? "700" : "400";
  const wanted = o.anchor ?? "start";
  const anchor = o.rtl ? ({ start: "end", end: "start" }[wanted] ?? wanted) : wanted;
  const dir = o.rtl ? ' direction="rtl"' : "";
  const fill = o.fill ?? "#1a1a1a";
  const style = o.italic ? ' font-style="italic"' : "";
  const spacing = o.caps ? ' letter-spacing="2"' : "";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${dir}${style}${spacing}>${esc(s)}</text>`;
}

const line = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke ?? "#333"}" stroke-width="${o.width ?? 1.5}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}/>`;

const rect = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill ?? "none"}" stroke="${o.stroke ?? "#333"}" stroke-width="${o.width ?? 1.5}"/>`;

/** A round ink stamp: two circles and two words, the way a mairie or a cabinet stamps (librsvg draws no textPath, so no ring of text). */
function stamp(cx, cy, centre, under, color = "#2b4a9b", radius = 95) {
  return `
  <g opacity="0.82">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="${radius - 8}" fill="none" stroke="${color}" stroke-width="1.5"/>
    <text x="${cx}" y="${cy + Math.round(radius / 14)}" font-family="${FONT}" font-size="${Math.round(radius / 4.5)}" fill="${color}" text-anchor="middle" font-weight="700">${esc(centre)}</text>
    <text x="${cx}" y="${cy + Math.round(radius / 2.4)}" font-family="${FONT}" font-size="${Math.round(radius / 7)}" fill="${color}" text-anchor="middle" letter-spacing="2">${esc(under)}</text>
  </g>`;
}

/** A signature: one hand-drawn looking stroke in blue ink. */
function signature(x, y, scale = 1, color = "#1f3a93") {
  return `<path transform="translate(${x} ${y}) scale(${scale})" d="M0 40 C 20 -10, 40 60, 60 20 S 100 0, 110 35 S 150 60, 175 15 S 210 30, 240 10" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
}

const page = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;

/** The republic's two lines, as every official Algerian paper opens. */
function republic(y) {
  return (
    text(W / 2, y, "الجمهورية الجزائرية الديمقراطية الشعبية", { size: 28, anchor: "middle", rtl: true, bold: true }) +
    text(W / 2, y + 40, "RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE", { size: 20, anchor: "middle", caps: true })
  );
}

/** The establishment's letterhead: its name (Arabic on the demo), its address, its phone. */
function letterhead(tenant, y) {
  const where = [tenant.address, tenant.commune, tenant.wilaya].filter(Boolean).join(" · ");
  return (
    text(W / 2, y, tenant.name, { size: 34, anchor: "middle", rtl: true, bold: true }) +
    (where ? text(W / 2, y + 40, where, { size: 20, anchor: "middle", fill: "#444" }) : "") +
    (tenant.phone ? text(W / 2, y + 70, `Tél. ${tenant.phone}`, { size: 20, anchor: "middle", fill: "#444" }) : "") +
    line(M, y + 95, W - M, y + 95, { width: 2 })
  );
}

/** A "Label : value" row with the Arabic label mirrored at the right margin. */
function field(y, label, value, labelAr) {
  return (
    text(M, y, `${label} :`, { size: 24, fill: "#555" }) +
    text(M + 260, y, value, { size: 26, bold: true }) +
    (labelAr ? text(W - M, y, labelAr, { size: 24, fill: "#555", anchor: "end", rtl: true }) : "")
  );
}

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const addMonths = (iso, months) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(" ");
const fullNameAr = (p) => [p.first_name_ar, p.last_name_ar].filter(Boolean).join(" ");

function extraitSvg(child, guardian, place) {
  const feminine = child.gender === "female";
  let y = 150;
  const rows = [
    ["Nom", (child.last_name ?? "").toUpperCase(), "اللقب"],
    ["Prénom(s)", child.first_name ?? "", "الاسم"],
    ["Né(e) le", fmtDate(child.dob), "تاريخ الميلاد"],
    ["À", place, "مكان الميلاد"],
    ["Sexe", feminine ? "féminin" : "masculin", "الجنس"],
    [feminine ? "Fille de" : "Fils de", fullName(guardian) || "—", "الوالد"],
  ];
  let body = republic(y);
  y += 90;
  body += text(M, y, `Wilaya : ${place}`, { size: 22, fill: "#444" }) + text(W - M, y, `ولاية ${place}`, { size: 22, fill: "#444", anchor: "end", rtl: true });
  y += 34;
  body += text(M, y, `Commune : ${place}`, { size: 22, fill: "#444" }) + text(W - M, y, `بلدية ${place}`, { size: 22, fill: "#444", anchor: "end", rtl: true });
  y += 90;
  body += text(W / 2, y, "مستخرج من سجلات عقود الميلاد", { size: 34, anchor: "middle", rtl: true, bold: true });
  y += 48;
  body += text(W / 2, y, "EXTRAIT DES REGISTRES DES ACTES DE NAISSANCE", { size: 26, anchor: "middle", bold: true, caps: true });
  y += 50;
  body += text(W / 2, y, `N° ${1000 + (child.dob ? new Date(child.dob).getDate() * 37 : 12)} / ${child.dob ? child.dob.slice(0, 4) : "2024"}`, { size: 24, anchor: "middle", fill: "#444" });
  y += 80;
  for (const [label, value, ar] of rows) {
    body += field(y, label, value, ar);
    body += line(M, y + 14, W - M, y + 14, { stroke: "#bbb", width: 1, dash: "4 6" });
    y += 64;
  }
  if (fullNameAr(child)) {
    y += 10;
    body += text(W - M, y, fullNameAr(child), { size: 30, anchor: "end", rtl: true, bold: true });
    y += 64;
  }
  y += 40;
  body += text(M, y, "Mentions marginales : néant", { size: 22, fill: "#555", italic: true });
  y += 120;
  body += text(M, y, `Délivré à ${place}, le ${fmtDate(daysAgo(9))}`, { size: 24 });
  body += text(W - M, y, "L'officier de l'état civil", { size: 24, anchor: "end" });
  body += signature(W - M - 300, y + 30, 1.1);
  body += stamp(W / 2 + 40, y + 120, "A.P.C.", `${place.toUpperCase()} · ÉTAT CIVIL`);
  return page(body);
}

function carnetSvg(child) {
  const dob = child.dob ?? "2024-03-01";
  const vaccines = [
    ["BCG", 0], ["Hépatite B (HBV)", 0], ["Polio orale", 0],
    ["DTC-Hib-HepB-Polio (1)", 2], ["Pneumocoque (1)", 2],
    ["DTC-Hib-HepB-Polio (2)", 4], ["Pneumocoque (2)", 4],
    ["ROR (1)", 11], ["DTC-Hib-HepB-Polio rappel", 12], ["ROR (2)", 18],
  ];
  const today = new Date().toISOString().slice(0, 10);
  let y = 140;
  let body = text(W / 2, y, "الدفتر الصحي للطفل", { size: 34, anchor: "middle", rtl: true, bold: true });
  y += 46;
  body += text(W / 2, y, "CARNET DE SANTÉ DE L'ENFANT", { size: 26, anchor: "middle", bold: true, caps: true });
  y += 30;
  body += text(W / 2, y, "Ministère de la Santé — وزارة الصحة", { size: 20, anchor: "middle", fill: "#444" });
  y += 70;
  body += field(y, "Nom et prénom", fullName(child), "الاسم واللقب");
  y += 54;
  body += field(y, "Né(e) le", fmtDate(dob), "تاريخ الميلاد");
  y += 90;
  body += text(M, y, "VACCINATIONS", { size: 28, bold: true, caps: true }) + text(W - M, y, "التلقيحات", { size: 28, bold: true, anchor: "end", rtl: true });
  y += 30;
  const cols = [M, M + 470, M + 700, M + 880, W - M];
  const head = ["Vaccin", "Date", "Lot", "Cachet"];
  body += rect(cols[0], y, cols[4] - cols[0], 48, { fill: "#f1f1f1" });
  head.forEach((h, i) => { body += text(cols[i] + 14, y + 32, h, { size: 22, bold: true }); });
  y += 48;
  for (const [name, months] of vaccines) {
    const due = addMonths(dob, months);
    const done = due <= today;
    body += rect(cols[0], y, cols[4] - cols[0], 66);
    for (let i = 1; i < 4; i++) body += line(cols[i], y, cols[i], y + 66, { width: 1 });
    body += text(cols[0] + 14, y + 42, name, { size: 22 });
    body += text(cols[1] + 14, y + 42, done ? fmtDate(due) : "", { size: 22, fill: "#1f3a93" });
    body += text(cols[2] + 14, y + 42, done ? `L${(months + 3) * 7}${dob.slice(2, 4)}` : "", { size: 20, fill: "#444" });
    if (done) body += stamp(cols[3] + 90, y + 33, "Dr", "", "#1f6b3a", 28);
    y += 66;
  }
  y += 60;
  body += text(M, y, "Prochain rappel : voir calendrier national de vaccination.", { size: 20, fill: "#555", italic: true });
  return page(body);
}

function certificatSvg(child, place) {
  let y = 130;
  let body = text(M, y, "Dr. Nadia BOUZID", { size: 30, bold: true });
  body += text(W - M, y, "د. نادية بوزيد", { size: 30, bold: true, anchor: "end", rtl: true });
  y += 36;
  body += text(M, y, "Médecin pédiatre — طبيبة أطفال", { size: 22, fill: "#444" });
  y += 32;
  body += text(M, y, `Cabinet médical, ${place} · Tél. 0770 22 01 01`, { size: 20, fill: "#444" });
  body += line(M, y + 24, W - M, y + 24, { width: 2 });
  y += 160;
  body += text(W / 2, y, "شهادة طبية", { size: 40, anchor: "middle", rtl: true, bold: true });
  y += 56;
  body += text(W / 2, y, "CERTIFICAT MÉDICAL", { size: 32, anchor: "middle", bold: true, caps: true });
  y += 120;
  const paragraphs = [
    "Je soussignée, Docteur Nadia BOUZID, médecin pédiatre, certifie avoir",
    `examiné ce jour l'enfant ${fullName(child)}, né(e) le ${fmtDate(child.dob)},`,
    "et n'avoir constaté aucune contre-indication apparente à la vie en",
    "collectivité. Les vaccinations obligatoires sont à jour.",
    "",
    "Certificat établi à la demande de l'intéressé(e) pour servir et valoir",
    "ce que de droit.",
  ];
  for (const p of paragraphs) {
    if (p) body += text(M, y, p, { size: 26 });
    y += 48;
  }
  y += 100;
  body += text(W - M, y, `Fait à ${place}, le ${fmtDate(daysAgo(6))}`, { size: 24, anchor: "end" });
  body += signature(W - M - 320, y + 40, 1.2);
  body += stamp(M + 180, y + 110, "Dr N. BOUZID", "PÉDIATRE · N° 16-4521", "#1f6b3a");
  return page(body);
}

function engagementSvg(tenant) {
  let y = 130;
  let body = letterhead(tenant, y);
  y += 180;
  body += text(W / 2, y, "استمارة الالتزام", { size: 40, anchor: "middle", rtl: true, bold: true });
  y += 56;
  body += text(W / 2, y, "FICHE D'ENGAGEMENT", { size: 32, anchor: "middle", bold: true, caps: true });
  y += 110;
  const paragraphs = [
    "Je soussigné(e) ………………………………………………………………………, tuteur légal",
    "de l'enfant ………………………………………………………………, m'engage à respecter le",
    "règlement intérieur de l'établissement, à régler les frais dans les délais",
    "convenus et à signaler sans délai tout changement de situation, d'adresse",
    "ou de personne autorisée à récupérer l'enfant.",
  ];
  for (const p of paragraphs) {
    body += text(M, y, p, { size: 24 });
    y += 44;
  }
  y += 40;
  body += text(M, y, "Observations / engagements particuliers :", { size: 22, fill: "#555" });
  y += 30;
  for (let i = 0; i < 8; i++) {
    y += 62;
    body += line(M, y, W - M, y, { stroke: "#777", width: 1.2 });
  }
  y += 120;
  body += text(M, y, "Fait à ……………………………  le ……………………………", { size: 24 });
  y += 80;
  body += text(W - M - 200, y, "Signature du tuteur", { size: 22, anchor: "middle", fill: "#444" });
  body += text(W - M - 200, y + 30, "« Lu et approuvé »", { size: 20, anchor: "middle", fill: "#777", italic: true });
  body += rect(W - M - 400, y + 50, 400, 170, { stroke: "#777", width: 1.2 });
  return page(body);
}

function contratSvg(tenant, child, guardian) {
  let y = 130;
  let body = letterhead(tenant, y);
  y += 170;
  body += text(W / 2, y, "عقد المؤسسة والولي", { size: 36, anchor: "middle", rtl: true, bold: true });
  y += 52;
  body += text(W / 2, y, "CONTRAT ÉTABLISSEMENT – TUTEUR", { size: 30, anchor: "middle", bold: true, caps: true });
  y += 90;
  const intro = [
    `Entre l'établissement ${tenant.name}, représenté par sa direction,`,
    `et M./Mme ${fullName(guardian) || "……………………"}, tuteur légal de l'enfant`,
    `${fullName(child)}, né(e) le ${fmtDate(child.dob)}, il est convenu ce qui suit :`,
  ];
  for (const p of intro) { body += text(M, y, p, { size: 24 }); y += 42; }
  y += 30;
  const articles = [
    ["Article 1 — Objet", "L'établissement accueille l'enfant aux jours et heures d'ouverture fixés par le règlement intérieur."],
    ["Article 2 — Frais", "Les frais d'inscription et la mensualité sont réglés d'avance, avant le 5 de chaque mois."],
    ["Article 3 — Santé", "Le tuteur remet un certificat médical et tient le carnet de vaccination à jour."],
    ["Article 4 — Résiliation", "Chaque partie peut mettre fin au contrat avec un préavis d'un mois, par écrit."],
  ];
  for (const [title, sentence] of articles) {
    body += text(M, y, title, { size: 24, bold: true });
    y += 38;
    body += text(M, y, sentence, { size: 22 });
    y += 70;
  }
  y += 40;
  body += text(M, y, `Fait à ${tenant.commune ?? "……………"}, le ${fmtDate(addMonths(daysAgo(0), -13))}`, { size: 24 });
  y += 70;
  body += text(M + 200, y, "La direction", { size: 22, anchor: "middle", fill: "#444" });
  body += text(W - M - 200, y, "Le tuteur — lu et approuvé", { size: 22, anchor: "middle", fill: "#444" });
  body += rect(M, y + 20, 400, 170, { stroke: "#777", width: 1.2 });
  body += rect(W - M - 400, y + 20, 400, 170, { stroke: "#777", width: 1.2 });
  body += stamp(M + 200, y + 105, "الإدارة", "DIRECTION", "#2b4a9b", 70);
  body += signature(M + 80, y + 70, 0.8);
  body += signature(W - M - 330, y + 80, 1.1, "#333");
  return page(body);
}

function ficheSvg(tenant, child, guardian) {
  let y = 130;
  let body = letterhead(tenant, y);
  y += 170;
  body += text(W / 2, y, "استمارة المعلومات", { size: 36, anchor: "middle", rtl: true, bold: true });
  y += 52;
  body += text(W / 2, y, "FICHE DE RENSEIGNEMENTS", { size: 30, anchor: "middle", bold: true, caps: true });
  y += 80;
  const rows = [
    ["Nom", (child.last_name ?? "").toUpperCase(), "اللقب"],
    ["Prénom", child.first_name ?? "", "الاسم"],
    ["Nom en arabe", fullNameAr(child) || "—", "الاسم بالعربية"],
    ["Date de naissance", fmtDate(child.dob), "تاريخ الميلاد"],
    ["Sexe", child.gender === "female" ? "féminin" : "masculin", "الجنس"],
    ["Tuteur légal", fullName(guardian) || "—", "الولي"],
    ["Téléphone", guardian.phone ?? "—", "الهاتف"],
    ["Adresse", guardian.address ?? "—", "العنوان"],
  ];
  for (const [label, value, ar] of rows) {
    body += rect(M, y, W - 2 * M, 66);
    body += line(M + 330, y, M + 330, y + 66, { width: 1 });
    body += text(M + 14, y + 42, label, { size: 22, fill: "#444" });
    body += text(M + 350, y + 42, value, { size: 24, bold: true });
    body += text(W - M - 14, y + 42, ar, { size: 22, fill: "#444", anchor: "end", rtl: true });
    y += 66;
  }
  y += 60;
  body += text(M, y, "Je certifie l'exactitude des renseignements ci-dessus.", { size: 22 });
  y += 80;
  body += text(M, y, `Fait le ${fmtDate(addMonths(daysAgo(0), -13))}`, { size: 24 });
  body += text(W - M - 200, y, "Signature du tuteur", { size: 22, anchor: "middle", fill: "#444" });
  body += signature(W - M - 330, y + 30, 1.1, "#333");
  return page(body);
}

/** SVG → JPEG. `rough` is a bad phone photo: the page tilted on a table, out of focus, a touch dark — the refused certificat. */
async function toJpeg(svg, rough = false) {
  let img = sharp(Buffer.from(svg));
  if (rough) {
    img = img
      .rotate(2.5, { background: "#b9b2a8" })
      .blur(3.2)
      .modulate({ brightness: 0.92 })
      .resize({ width: W, height: H, fit: "cover" });
  }
  return img.jpeg({ quality: rough ? 58 : 82, mozjpeg: true }).toBuffer();
}

/**
 * One JPEG on one A4 page — a scanned paper. The image stream is the JPEG
 * bytes as they are (DCTDecode), so the wrapper is a page, an XObject and a
 * five-word content stream; offsets are counted on the bytes because the
 * xref table needs them exact.
 */
async function jpegToPdf(jpeg) {
  const { width, height } = await sharp(jpeg).metadata();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      Buffer.from("\nendstream"),
    ]),
    (() => {
      const content = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
      return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    })(),
  ];
  const parts = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body), Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/* ── The seed SQL, with the nine paths filled in ─────────────────────────── */

const SEED_SQL = `-- Demo seed for the dossier d'inscription — DEMO TENANT 732bdf7d… ONLY.
-- Written by scripts/seed-dossier-demo.mjs with the nine object paths it
-- uploaded as directrice@rawdatik.com. Run through execute_sql in one DO
-- block AFTER 0164 is live; verify with the SELECTs at the end.
--
-- States the product itself can produce, and only those: a paper the family
-- sent is source 'family' and starts 'received' (the office reviews it —
-- accept / refuse with a note); a paper the office scanned is source 'staff'
-- and is born 'accepted' (D15). The two reviews below are UPDATEs so the
-- triggers run the way the product runs them: 'document_received' reaches the
-- demo staff other than the directrice (she is the actor); no family push
-- fires because the demo application has no applicant account.
do $$
declare
  t uuid := '732bdf7d-775a-4ed7-875f-8c04ea4e4778';
  u_owner uuid := 'd9485859-48e8-4aad-85e7-d09e1cd16f4d';
  app_alaa uuid;                                        -- fde84844… آلاء, submitted, crèche
  v_child uuid := '809202b0-ab41-4523-8f4c-298aae11fa5e'; -- Adam Amrani, crèche, parent1@rawdatik.com
  r_engagement uuid; r_birth uuid; r_health uuid; r_medical uuid; r_contract uuid; r_info uuid;
  d_extrait uuid; d_flou uuid;
  -- the nine objects this script uploaded (paths and byte sizes as Storage holds them)
  p_form        text := '{{p_form}}';
  p_extrait     text := '{{p_extrait}}';
  p_carnet      text := '{{p_carnet}}';
  p_flou        text := '{{p_flou}}';
  c_extrait     text := '{{c_extrait}}';
  c_carnet      text := '{{c_carnet}}';
  c_contrat     text := '{{c_contrat}}';
  c_fiche       text := '{{c_fiche}}';
  c_certificat  text := '{{c_certificat}}';
begin
  select id into app_alaa from kg_applications where tenant_id = t and id::text like 'fde84844%';
  if app_alaa is null then raise exception 'demo application fde84844 not found'; end if;
  if not exists (select 1 from kg_children where id = v_child and tenant_id = t and status = 'enrolled') then
    raise exception 'demo child Adam Amrani not found or not enrolled'; end if;
  -- every path must be a real object the directrice uploaded
  if (select count(*) from storage.objects where bucket_id = 'kg-media'
        and name in (p_form, p_extrait, p_carnet, p_flou, c_extrait, c_carnet, c_contrat, c_fiche, c_certificat)) <> 9 then
    raise exception 'upload the nine objects first (scripts/seed-dossier-demo.mjs) and paste the printed paths';
  end if;

  select id into r_engagement from kg_document_requirements where tenant_id = t and kind = 'early' and key = 'commitment_sheet';
  select id into r_birth      from kg_document_requirements where tenant_id = t and kind = 'early' and key = 'birth_certificate';
  select id into r_health     from kg_document_requirements where tenant_id = t and kind = 'early' and key = 'health_booklet';
  select id into r_medical    from kg_document_requirements where tenant_id = t and kind = 'early' and key = 'medical_certificate';
  select id into r_contract   from kg_document_requirements where tenant_id = t and kind = 'early' and key = 'contract';
  select id into r_info       from kg_document_requirements where tenant_id = t and kind = 'early' and key = 'information_sheet';

  -- The demo is the showcase: the crèche / jardin list is ON (0164 seeds
  -- existing tenants inactive). The école list stays inactive so the settings
  -- page shows both states and the école children stay quiet.
  update kg_document_requirements set active = true where tenant_id = t and kind = 'early';

  -- the blank fiche d'engagement the family downloads
  update kg_document_requirements set form_path = p_form, form_name = 'fiche-engagement.pdf' where id = r_engagement;

  -- ── آلاء (submitted): one accepted, one to check, one refused with the note the family reads
  insert into kg_child_documents (tenant_id, application_id, requirement_id, doc_type, title, file_path, uploaded_by, status, source, file_name, mime_type, size_bytes, created_at)
  values (t, app_alaa, r_birth, 'birth_certificate', 'Extrait de naissance', p_extrait, u_owner, 'received', 'family', 'extrait.jpg', 'image/jpeg', {{n_p_extrait}}, now() - interval '3 days')
  returning id into d_extrait;
  insert into kg_child_documents (tenant_id, application_id, requirement_id, doc_type, title, file_path, uploaded_by, status, source, file_name, mime_type, size_bytes, created_at)
  values (t, app_alaa, r_health, 'health_booklet', 'Copie du carnet de santé', p_carnet, u_owner, 'received', 'family', 'carnet.jpg', 'image/jpeg', {{n_p_carnet}}, now() - interval '1 day');
  insert into kg_child_documents (tenant_id, application_id, requirement_id, doc_type, title, file_path, uploaded_by, status, source, file_name, mime_type, size_bytes, created_at)
  values (t, app_alaa, r_medical, 'medical_certificate', 'Certificat médical', p_flou, u_owner, 'received', 'family', 'certificat.jpg', 'image/jpeg', {{n_p_flou}}, now() - interval '2 days')
  returning id into d_flou;
  -- the office reviewed two of them (UPDATE OF status → the product's own trigger path)
  update kg_child_documents set status = 'accepted', reviewed_by = u_owner, reviewed_at = now() - interval '2 days' where id = d_extrait;
  update kg_child_documents set status = 'rejected', reviewed_by = u_owner, reviewed_at = now() - interval '1 day',
         review_note = 'Photo floue — merci de la reprendre à la lumière du jour' where id = d_flou;

  -- ── Adam (enrolled): scanned at the desk (born accepted), a certificat that lapsed 10 days ago,
  --    the demande manuscrite and the photos still to bring → "Dossier 4 / 7"
  insert into kg_child_documents (tenant_id, child_id, requirement_id, doc_type, title, file_path, uploaded_by, status, source, file_name, mime_type, size_bytes, reviewed_by, reviewed_at, expires_at, created_at)
  values
    (t, v_child, r_birth,    'birth_certificate',   'Extrait de naissance',        c_extrait,    u_owner, 'accepted', 'staff', 'extrait.jpg',    'image/jpeg',      {{n_c_extrait}}, u_owner, now() - interval '13 months', null,                          now() - interval '13 months'),
    (t, v_child, r_health,   'health_booklet',      'Copie du carnet de santé',    c_carnet,     u_owner, 'accepted', 'staff', 'carnet.jpg',     'image/jpeg',      {{n_c_carnet}}, u_owner, now() - interval '13 months', null,                          now() - interval '13 months'),
    (t, v_child, r_contract, 'contract',            'Contrat établissement – tuteur signé', c_contrat, u_owner, 'accepted', 'staff', 'contrat.pdf', 'application/pdf', {{n_c_contrat}}, u_owner, now() - interval '13 months', null,                          now() - interval '13 months'),
    (t, v_child, r_info,     'information_sheet',   'Fiche de renseignements',     c_fiche,      u_owner, 'accepted', 'staff', 'fiche.pdf',      'application/pdf', {{n_c_fiche}}, u_owner, now() - interval '13 months', null,                          now() - interval '13 months'),
    (t, v_child, r_medical,  'medical_certificate', 'Certificat médical',          c_certificat, u_owner, 'accepted', 'staff', 'certificat.jpg', 'image/jpeg',       {{n_c_certificat}}, u_owner, now() - interval '12 months 10 days', kg_today() - 10, now() - interval '12 months 10 days');

  raise notice 'seeded 3 rows for application % and 5 rows for child %', app_alaa, v_child;
end $$;

-- verify (SELECT-only)
select coalesce(a.child->>'first_name', c.first_name) as child, d.title, d.status, d.source, d.expires_at, d.review_note
  from kg_child_documents d
  left join kg_applications a on a.id = d.application_id
  left join kg_children c on c.id = d.child_id
 where d.tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' order by d.child_id nulls first, d.created_at;
select kind, count(*) filter (where active) as active, count(*) as total from kg_document_requirements
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' group by kind;
select key, kind, form_name from kg_document_requirements
 where tenant_id = '732bdf7d-775a-4ed7-875f-8c04ea4e4778' and form_path is not null;
-- expected: آلاء required 7 / accepted 1 / pending 1 / missing 5 ; Adam required 7 / accepted 4 / pending 0 / missing 3
select child_id, application_id, required, accepted, pending, missing
  from kg_dossier_summary('732bdf7d-775a-4ed7-875f-8c04ea4e4778')
 where child_id = '809202b0-ab41-4523-8f4c-298aae11fa5e' or application_id::text like 'fde84844%';
`;

/* ── Run ─────────────────────────────────────────────────────────────────── */

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  if (!URL || !ANON) fail("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing (.env.local).");
  mkdirSync(OUT, { recursive: true });

  // Placeholders for a dry run: the papers are drawn from these when nobody
  // is signed in, so the rendering can be looked at without touching prod.
  let tenant = { name: "روضة الأمل", address: null, commune: "Hydra", wilaya: "Alger", phone: null };
  let alaa = { first_name: "Alaa", last_name: "Bensalem", first_name_ar: "آلاء", last_name_ar: "بن سالم", dob: "2024-03-14", gender: "female" };
  let alaaGuardian = { first_name: "Karim", last_name: "Bensalem", phone: "0550 12 34 56", address: "Hydra, Alger" };
  let adam = { first_name: "Adam", last_name: "Amrani", first_name_ar: "آدم", last_name_ar: "عمراني", dob: "2023-05-02", gender: "male" };
  let adamGuardian = { first_name: "Sofiane", last_name: "Amrani", phone: "0770 22 01 01", address: "Hydra, Alger" };
  let appId = `${APP_PREFIX}-0000-4000-8000-000000000000`;
  let commitmentId = "00000000-0000-4000-8000-000000000000";
  let supabase = null;

  if (!DRY_RUN) {
    const password = readPassword();
    if (!password) fail("No password: put it in ~/rawdatik-secrets/demo-password or RAWDATIK_PASSWORD in .env.local.");
    supabase = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: authError } = await supabase.auth.signInWithPassword({ email: LOGIN, password });
    if (authError) fail(`Sign-in as ${LOGIN} failed: ${authError.message}`);

    // 0164 must be live: the requirement rows are what the papers answer.
    const { data: reqs, error: reqError } = await supabase
      .from("kg_document_requirements")
      .select("id, key")
      .eq("tenant_id", TENANT)
      .eq("kind", "early");
    if (reqError) fail(`kg_document_requirements is not readable — is 0164 applied? (${reqError.message})`);
    const commitment = (reqs ?? []).find((r) => r.key === "commitment_sheet");
    if (!commitment) fail("The demo's early list has no commitment_sheet row.");
    commitmentId = commitment.id;

    const { data: tenantRow, error: tenantError } = await supabase
      .from("kg_tenants").select("name, address, commune, wilaya, phone").eq("id", TENANT).single();
    if (tenantError) fail(`Tenant: ${tenantError.message}`);
    tenant = tenantRow;

    const { data: apps, error: appError } = await supabase
      .from("kg_applications").select("id, status, child, guardians").eq("tenant_id", TENANT);
    if (appError) fail(`Applications: ${appError.message}`);
    const app = (apps ?? []).find((a) => a.id.startsWith(APP_PREFIX));
    if (!app) fail(`Demo application ${APP_PREFIX}… not found.`);
    if (app.status === "approved" || app.status === "rejected") fail(`Demo application ${app.id} is ${app.status}; the seed needs it open.`);
    appId = app.id;
    alaa = app.child ?? alaa;
    alaaGuardian = (Array.isArray(app.guardians) && app.guardians[0]) || alaaGuardian;

    const { data: child, error: childError } = await supabase
      .from("kg_children").select("id, status, first_name, last_name, first_name_ar, last_name_ar, dob, gender").eq("id", ADAM).single();
    if (childError || !child) fail(`Adam Amrani: ${childError?.message ?? "not found"}`);
    if (child.status !== "enrolled") fail(`Adam Amrani is ${child.status}; the seed needs him enrolled.`);
    adam = child;
    const { data: links } = await supabase
      .from("kg_child_guardians").select("is_primary, kg_guardians(first_name, last_name, phone, address)").eq("child_id", ADAM);
    const primary = (links ?? []).find((l) => l.is_primary) ?? (links ?? [])[0];
    if (primary?.kg_guardians) adamGuardian = primary.kg_guardians;

    // A second run would stack a second set of rows behind the same
    // screens: the register's LATEST row is the state, so the seed's
    // carefully dated history would be hidden by whatever came last.
    const { count } = await supabase
      .from("kg_child_documents").select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT).or(`child_id.eq.${ADAM},application_id.eq.${appId}`);
    if ((count ?? 0) > 0 && !FORCE) {
      fail(`The demo register already has ${count} row(s) for آلاء / Adam. Remove them first, or FORCE=1 to upload anyway.`);
    }
  }

  const place = tenant.commune ?? "Hydra";
  console.log(`Rendering the papers into ${OUT} …`);
  const papers = {
    // the blank form, offered to every family of the crèche list
    form: await jpegToPdf(await toJpeg(engagementSvg(tenant))),
    // آلاء's three, sent from a phone
    p_extrait: await toJpeg(extraitSvg(alaa, alaaGuardian, place)),
    p_carnet: await toJpeg(carnetSvg(alaa)),
    p_flou: await toJpeg(certificatSvg(alaa, place), true),
    // Adam's five, scanned at the desk thirteen months ago
    c_extrait: await toJpeg(extraitSvg(adam, adamGuardian, place)),
    c_carnet: await toJpeg(carnetSvg(adam)),
    c_contrat: await jpegToPdf(await toJpeg(contratSvg(tenant, adam, adamGuardian))),
    c_fiche: await jpegToPdf(await toJpeg(ficheSvg(tenant, adam, adamGuardian))),
    c_certificat: await toJpeg(certificatSvg(adam, place)),
  };
  const local = {
    form: "blank-engagement.pdf",
    p_extrait: "alaa-extrait.jpg", p_carnet: "alaa-carnet.jpg", p_flou: "alaa-certificat-flou.jpg",
    c_extrait: "adam-extrait.jpg", c_carnet: "adam-carnet.jpg", c_contrat: "adam-contrat.pdf",
    c_fiche: "adam-fiche.pdf", c_certificat: "adam-certificat.jpg",
  };
  for (const [key, bytes] of Object.entries(papers)) {
    writeFileSync(path.join(OUT, local[key]), bytes);
    console.log(`  ${local[key].padEnd(26)} ${Math.round(bytes.length / 1024)} KB`);
  }

  // One timestamp per run, the way the staff action names its uploads
  // (`${Date.now()}-${safeName}`): nine distinct names, none colliding with
  // a previous run's.
  const ts = Date.now();
  const paths = {
    p_form: `t/${TENANT}/forms/${commitmentId}.pdf`,
    p_extrait: `t/${TENANT}/applications/${appId}/documents/${ts}-extrait.jpg`,
    p_carnet: `t/${TENANT}/applications/${appId}/documents/${ts}-carnet.jpg`,
    p_flou: `t/${TENANT}/applications/${appId}/documents/${ts}-certificat.jpg`,
    c_extrait: `t/${TENANT}/children/${ADAM}/documents/${ts}-extrait.jpg`,
    c_carnet: `t/${TENANT}/children/${ADAM}/documents/${ts}-carnet.jpg`,
    c_contrat: `t/${TENANT}/children/${ADAM}/documents/${ts}-contrat.pdf`,
    c_fiche: `t/${TENANT}/children/${ADAM}/documents/${ts}-fiche.pdf`,
    c_certificat: `t/${TENANT}/children/${ADAM}/documents/${ts}-certificat.jpg`,
  };
  const bytesFor = { p_form: papers.form, ...papers };

  if (DRY_RUN) {
    console.log("\nDRY_RUN — nothing uploaded. The nine paths a real run would use:");
    for (const p of Object.values(paths)) console.log(`  ${p}`);
    return;
  }

  console.log("\nUploading as the directrice …");
  const uploaded = [];
  for (const [key, storagePath] of Object.entries(paths)) {
    const contentType = storagePath.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
    // The form path is deterministic (one per requirement), so it is replaced
    // in place; a paper is never overwritten — the register keeps history.
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytesFor[key], { contentType, upsert: key === "p_form" });
    if (error) {
      console.error(`  upload failed for ${storagePath}: ${error.message}`);
      if (uploaded.length) {
        console.error(`  removing the ${uploaded.length} object(s) already uploaded …`);
        await supabase.storage.from(BUCKET).remove(uploaded);
      }
      await supabase.auth.signOut({ scope: "local" });
      process.exit(1);
    }
    uploaded.push(storagePath);
    console.log(`  ${storagePath}`);
  }
  // Only this script's session: the default scope is GLOBAL and would sign
  // the directrice out of her browser too — which is exactly what happened
  // the first time this ran.
  await supabase.auth.signOut({ scope: "local" });

  // Paths and sizes as Storage now holds them, so the register rows agree
  // with the objects the way kg_attach_document would have written them.
  const sql = Object.entries(paths).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value).replaceAll(`{{n_${key}}}`, String(bytesFor[key].length)),
    SEED_SQL
  );
  const sqlFile = path.join(OUT, "seed-dossier-demo.sql");
  writeFileSync(sqlFile, sql);

  console.log("\nThe nine paths:");
  for (const p of Object.values(paths)) console.log(`  ${p}`);
  console.log(`\nSeed SQL with the paths filled in: ${sqlFile}`);
  console.log("Run it through execute_sql on the demo tenant (one DO block), then read its four SELECTs:");
  console.log("  expected — آلاء required 7 / accepted 1 / pending 1 / missing 5 ; Adam required 7 / accepted 4 / pending 0 / missing 3.");
}

main().catch((e) => fail(e?.stack ?? String(e)));
