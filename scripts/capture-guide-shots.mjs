/**
 * Screenshots for the startup guide, taken from the running app.
 *
 *   RAWDATIK_PASSWORD=… npm run shots            # against localhost:3000
 *   RAWDATIK_PASSWORD=… BASE=https://www.rawdatik.com npm run shots
 *
 * WHY A SCRIPT AND NOT A FOLDER OF PNGs. A guide illustrated with stale
 * screenshots is worse than one with none: it shows a director a button
 * that has moved. Re-run this after any UI change and the guide catches up.
 *
 * The password is read from the environment and never written to disk or
 * logged. Point it at the demo tenant, never at a real crèche — every shot
 * lands in a public folder and ships inside a public repository.
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read the secret from .env.local rather than the command line.
 *
 * .env.local is already gitignored and is where this project keeps its other
 * keys, so the value never appears in shell history, in a process list, or in
 * anything pasted into a chat. Add ONE of:
 *
 *   RAWDATIK_SESSION=<the sb-…-auth-token value from a signed-in browser>
 *   RAWDATIK_PASSWORD=<the demo account's password>
 */
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;                    // real env wins
    process.env[k] = raw.replace(/^["']|["']$/g, "");
  }
}

const BASE = process.env.BASE ?? "http://localhost:3000";
const PASSWORD = process.env.RAWDATIK_PASSWORD;
// Preferred over a password: paste a session from a browser already signed in
// (DevTools → Application → Local Storage → the sb-*-auth-token value), or
// export it from the Supabase CLI. Nothing is typed into a login form.
const SESSION = process.env.RAWDATIK_SESSION;
const ONLY = process.env.ONLY ?? "all";   // all | public
// SCREENS=kiosk,billing captures just those, instead of the whole set.
const PICK = (process.env.SCREENS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const wanted = (list) => (PICK.length ? list.filter(([n]) => PICK.includes(n)) : list);
const LOCALE = process.env.LOCALE ?? "fr"; // fr | ar | en
const OUT = path.join(process.cwd(), "public", "guide-shots");

if (!PASSWORD && !SESSION && ONLY !== "public") {
  console.error("Give the script a way in — one of:");
  console.error("  RAWDATIK_SESSION='<sb-…-auth-token value>' npm run shots   (preferred)");
  console.error("  RAWDATIK_PASSWORD=…                        npm run shots");
  console.error("  ONLY=public                                npm run shots   (no account needed)");
  process.exit(1);
}

/** Staff screens, in the order the guide walks through them. */
const STAFF = [
  ["settings",       "/settings",                 "Établissement et horaires"],
  ["holidays",       "/settings/holidays",        "Jours fériés"],
  ["classes",        "/classes",                  "Classes"],
  ["plans",          "/billing/plans",            "Formules tarifaires"],
  ["staff",          "/staff",                    "Équipe"],
  ["enrollment",     "/settings/enrollment",      "Lien d'inscription"],
  ["applications",   "/applications",             "Demandes d'inscription"],
  ["dashboard",      "/dashboard",                "Tableau de bord"],
  ["attendance",     "/attendance",               "Présences"],
  ["children",       "/children",                 "Enfants"],
  ["menus",          "/menus",                    "Menus et alerte allergies"],
  ["incidents",      "/incidents",                "Incidents"],
  ["messages",       "/messages",                 "Messages"],
  ["billing",        "/billing",                  "Facturation"],
  ["arrears",        "/billing/arrears",          "Impayés"],
  ["transactions",   "/accounting/transactions",  "Comptabilité"],
  ["payroll",        "/accounting/payroll",       "Paie"],
  ["reports",        "/reports",                  "Rapports"],
  ["kiosk",          "/kiosk",                    "Mode kiosque — écran d'entrée"],
  ["onboarding",     "/onboarding?create=1",      "Créer un établissement"],
  ["glyphs",         "/glyph-sheet",                  "Weather glyph proof sheet"],
];

/** Parent screens — a different account, so a second pass. */
const PARENT = [
  ["portal",         "/portal",                   "Espace parents — accueil"],
  ["portal-child",   "/portal/children",          "Espace parents — mon enfant"],
  ["portal-payments","/portal/payments",          "Espace parents — factures"],
  ["portal-messages","/portal/messages",          "Espace parents — messages"],
];

/**
 * Public — no account needed, and between them these are the whole first
 * half of the parent journey: what a family sees before they have a login.
 * ENROLL_TOKEN comes from Paramètres → Inscriptions on the demo tenant.
 */
const ENROLL_TOKEN = process.env.ENROLL_TOKEN ?? "";
const PUBLIC = [
  ["landing",        "/",                         "Page d'accueil"],
  ["login",          "/login",                    "Connexion"],
  ["signup",         "/signup",                   "Créer un compte"],
  ...(ENROLL_TOKEN
    ? [["enroll",    `/enroll/${ENROLL_TOKEN}`,   "Formulaire d'inscription en ligne"]]
    : []),
];

const PROJECT_REF = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
  .replace(/^https:\/\//, "").split(".")[0];

/** Seed a session that already exists, rather than authenticating here. */
async function useSession(ctx, page) {
  const key = `sb-${PROJECT_REF}-auth-token`;
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, SESSION]);
  await page.reload({ waitUntil: "networkidle" });
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  // Pinned to the real ids on /login rather than matched by label text —
  // the field is labelled "E-mail ou numéro de téléphone", and the three
  // language buttons sit above the submit.
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('button[type="submit"]');
  // The app lands on /after-login and routes by role from there.
  // Sign-in lands on /after-login, which routes by role; wait for that to
  // resolve rather than for a fixed destination.
  await page.waitForURL((u) => !/\/(login|after-login)/.test(u.pathname), { timeout: 45_000 });
  await page.waitForLoadState("networkidle");
  if (/\/login/.test(new URL(page.url()).pathname)) {
    throw new Error("Still on /login — check the password and that the account exists.");
  }
}

async function shoot(page, [name, route, caption]) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  // Let charts and skeletons settle; several screens stream in.
  await page.waitForTimeout(1200);
  // The floating inbox bubble overlaps the bottom-right of every screen and
  // is not what any of these steps is about.
  await page.addStyleTag({
    content: `[data-slot="dialog-trigger"][aria-label="Messages"],
              .fixed.bottom-4.end-4, .fixed.bottom-6.end-6,
              [data-next-badge-root], nextjs-portal { visibility: hidden !important; }`,
  });
  const file = path.join(OUT, `${LOCALE}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${LOCALE}-${name}.png   ${caption}`);
}

const run = async () => {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  // Use the Chrome that is already on the machine rather than making every
  // contributor download Playwright's own build for a handful of screenshots.
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch {
    browser = await chromium.launch(); // falls back to `npx playwright install`
  }
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 2, // legible when scaled down into the guide
    locale: LOCALE === "ar" ? "ar-DZ" : LOCALE === "en" ? "en-GB" : "fr-DZ",
  });
  // Locale is a cookie in this app, not a route segment (src/i18n/request.ts).
  await ctx.addCookies([
    { name: "kg-locale", value: LOCALE, url: BASE },
  ]);

  const page = await ctx.newPage();

  console.log(`\npublic (${PUBLIC.length})`);
  for (const s of wanted(PUBLIC)) await shoot(page, s);

  if (ONLY === "public") {
    await browser.close();
    console.log(`\nDone — ${PUBLIC.length} public shots in public/guide-shots/`);
    return;
  }

  console.log(`\nstaff (${wanted(STAFF).length})`);
  if (SESSION) await useSession(ctx, page);
  else await signIn(page, "directrice@rawdatik.com");
  for (const s of wanted(STAFF)) await shoot(page, s);

  if (!SESSION) {
    console.log(`\nparent — parent1@rawdatik.com (${PARENT.length})`);
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "kg-locale", value: LOCALE, url: BASE }]);
    await signIn(page, "parent1@rawdatik.com");
    for (const s of wanted(PARENT)) await shoot(page, s);
  } else {
    console.log("\nparent screens skipped — a session is one account; re-run with the parent's.");
  }

  await browser.close();
  console.log(`\nDone — ${PUBLIC.length + STAFF.length + PARENT.length} shots in public/guide-shots/`);
  console.log("Now run:  node scripts/embed-guide-shots.mjs");
};

run().catch((e) => { console.error(e); process.exit(1); });
