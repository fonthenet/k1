// The bell and the push share one renderer; this exercises it over the real
// message files, so a key that a locale forgot, a template whose placeholder
// no payload fills, or a plural category Arabic needs and fr/en lack is caught
// here rather than on a parent's phone.
//
//   node --test scripts/notifications.test.mjs
//
// Runs on the project's Node 20 as well as a newer one: the renderer is
// TypeScript with `@/` imports, so a small resolve/load hook (registered below
// from a data: URL, no dependency) maps `@/x` onto src/x, adds the extension,
// and strips types with the TypeScript compiler already in node_modules.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

register(
  `data:text/javascript,${encodeURIComponent(`
    import { existsSync } from "node:fs";
    import { readFile } from "node:fs/promises";
    import { pathToFileURL, fileURLToPath } from "node:url";
    const root = ${JSON.stringify(root)};
    const ts = (await import(pathToFileURL(root + "/node_modules/typescript/lib/typescript.js").href)).default;
    const withExt = (p) => {
      for (const c of [p, p + ".ts", p + ".tsx", p + "/index.ts", p + "/index.tsx"]) if (existsSync(c) && !c.endsWith("/")) return c;
      return null;
    };
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) {
        const hit = withExt(root + "/src/" + specifier.slice(2));
        if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
      }
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        if (!/\\.[cm]?[jt]sx?$|\\.json$/.test(base)) {
          const hit = withExt(base);
          if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
        }
      }
      return next(specifier, context);
    }
    export async function load(url, context, next) {
      if (/\\.tsx?$/.test(url)) {
        const source = await readFile(fileURLToPath(url), "utf8");
        const { outputText } = ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
          fileName: fileURLToPath(url),
        });
        return { format: "module", source: outputText, shortCircuit: true };
      }
      return next(url, context);
    }
  `)}`,
  { parentURL: pathToFileURL(root + "/").href }
);

const { NOTIFICATION_TYPES, renderNotification, notificationHref } = await import(
  pathToFileURL(path.join(root, "src/lib/notifications.ts")).href
);
const { dailyJournalSettings, defaultSendAt, parseChildDay, sectionsFor } = await import(
  pathToFileURL(path.join(root, "src/lib/child-day.ts")).href
);

const LOCALES = ["ar", "fr", "en"];

// The merged file, plus the pending fragment while it is still pending, so the
// test is the same before and after `merge-message-fragments`.
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] && typeof target[k] === "object" ? target[k] : {}, v);
    } else if (target[k] === undefined) {
      target[k] = v;
    }
  }
  return target;
}
function messagesFor(locale) {
  const merged = JSON.parse(readFileSync(path.join(root, "messages", locale, "notifications.json"), "utf8"));
  const pending = path.join(root, "messages", "_pending", "daily-journal-notify.json");
  if (existsSync(pending)) {
    const frag = JSON.parse(readFileSync(pending, "utf8"));
    deepMerge(merged, frag[locale]?.notifications);
  }
  return merged;
}
const MESSAGES = Object.fromEntries(LOCALES.map((l) => [l, messagesFor(l)]));

const row = (type, data, extra = {}) => ({
  type, title: "Adam Amrani", body: null, data, ...extra,
});

test("every type renders in every locale from an empty payload without a stray placeholder", () => {
  for (const locale of LOCALES) {
    const messages = MESSAGES[locale];
    for (const type of NOTIFICATION_TYPES) {
      assert.ok(messages.types[type], `${locale}: types.${type} missing`);
      const { title, body } = renderNotification(row(type, {}), messages, locale);
      assert.ok(!title.includes("{") && !body.includes("{"), `${locale} ${type}: "${title}" / "${body}"`);
      assert.ok(!/·\s*·|^\s*·|·\s*$/.test(body), `${locale} ${type}: dangling separator in "${body}"`);
    }
  }
});

test("the digest keys carry all six plural categories in every locale", () => {
  const CATEGORIES = ["zero", "one", "two", "few", "many", "other"];
  for (const locale of LOCALES) {
    const parts = MESSAGES[locale].types.daily_report.parts;
    const groups = [parts.lessons.academic, parts.lessons.therapy, parts.lessons.other, parts.photos, parts.incidents];
    for (const g of groups) assert.deepEqual(Object.keys(g).sort(), [...CATEGORIES].sort(), locale);
    for (const mood of ["happy", "calm", "energetic", "tired", "sad", "upset", "sick"]) {
      assert.equal(typeof MESSAGES[locale].moods[mood], "string", `${locale} moods.${mood}`);
    }
  }
});

// 08:12 in Algiers is 07:12Z; the digest carries the instant, the reader's
// zone is pinned in formatTime, so every locale prints 08:12.
const care = {
  source: "digest", date: "2026-09-10", profile: "care", attendance: "present",
  arrivedAt: "2026-09-10T07:12:00+00:00", leftAt: "2026-09-10T15:30:00+00:00",
  lessons: 3, menu: true, eaten: "all", napMinutes: 60, mood: "calm", photos: 0, incidents: 0,
  childId: "809202b0-ab41-4523-8f4c-298aae11fa5e", childName: "Adam Amrani", audience: "parent",
};

test("a crèche digest reads as the spec's row in the three languages", () => {
  const expected = {
    fr: ["Journal de Adam Amrani", "Arrivée 08:12 · 3 activités · a tout mangé · sieste 60 min · humeur calme"],
    en: ["Adam Amrani's daily journal", "Arrived 08:12 · 3 activities · ate everything · nap 60 min · calm"],
    ar: ["يوميات Adam Amrani", "الوصول 08:12 · 3 أنشطة · الأكل: كل شيء · قيلولة 60 دقيقة · مزاج هادئ"],
  };
  for (const locale of LOCALES) {
    const { title, body } = renderNotification(row("daily_report", care), MESSAGES[locale], locale);
    assert.equal(title, expected[locale][0], locale);
    assert.equal(body, expected[locale][1], locale);
  }
});

test("an Arabic reader gets the child's Arabic name when the payload carries one", () => {
  const bilingual = { ...care, childNameAr: "آدم عمراني" };
  assert.equal(renderNotification(row("daily_report", bilingual), MESSAGES.ar, "ar").title, "يوميات آدم عمراني");
  // The Latin name stays the fallback for a French reader and for a row
  // written before the payload carried the Arabic one.
  assert.equal(renderNotification(row("daily_report", bilingual), MESSAGES.fr, "fr").title, "Journal de Adam Amrani");
  assert.equal(renderNotification(row("daily_report", care), MESSAGES.ar, "ar").title, "يوميات Adam Amrani");
  // Every family type goes through the same variable, arrival included, and
  // the arrival/departure titles are nouns so a girl's row is never masculine.
  const arrival = { childId: care.childId, childNameAr: "إيناس عمراني", childName: "Ines Amrani", time: care.arrivedAt };
  assert.equal(renderNotification(row("checkin", arrival), MESSAGES.ar, "ar").title, "وصول إيناس عمراني");
  assert.equal(renderNotification(row("checkin", arrival), MESSAGES.fr, "fr").title, "Arrivée de Ines Amrani");
  assert.equal(renderNotification(row("checkout", arrival), MESSAGES.fr, "fr").title, "Départ de Ines Amrani");
});

test("an école digest names lessons, the menu and the incident, and never a nap", () => {
  const academic = {
    ...care, profile: "academic", lessons: 2, eaten: null, napMinutes: null, mood: null, photos: 1, incidents: 1,
  };
  const expected = {
    fr: "Arrivée 08:12 · 2 cours · menu du jour · 1 photo · 1 incident",
    en: "Arrived 08:12 · 2 lessons · today's menu · 1 photo · 1 incident",
    ar: "الوصول 08:12 · حصتان · قائمة اليوم · صورة واحدة · حادث واحد",
  };
  for (const locale of LOCALES) {
    assert.equal(renderNotification(row("daily_report", academic), MESSAGES[locale], locale).body, expected[locale], locale);
  }
  // An école day never says how the pupil ate, even when a payload carries it.
  const withMeal = { ...academic, eaten: "half", incidents: 0, photos: 0 };
  assert.equal(
    renderNotification(row("daily_report", withMeal), MESSAGES.fr, "fr").body,
    "Arrivée 08:12 · 2 cours · menu du jour"
  );
});

test("a therapy digest counts workshops and stops at incidents", () => {
  const therapy = { ...care, profile: "therapy", lessons: 1, eaten: null, napMinutes: null, mood: null, incidents: 2 };
  const expected = {
    fr: "Arrivée 08:12 · 1 atelier · 2 incidents",
    en: "Arrived 08:12 · 1 workshop · 2 incidents",
    ar: "الوصول 08:12 · ورشة واحدة · حادثان",
  };
  for (const locale of LOCALES) {
    assert.equal(renderNotification(row("daily_report", therapy), MESSAGES[locale], locale).body, expected[locale], locale);
  }
});

test("Arabic picks the dual, the 3–10 form and the 11+ form", () => {
  const at = (n) => renderNotification(
    row("daily_report", { ...care, lessons: n, menu: false, eaten: null, napMinutes: null, mood: null, arrivedAt: null }),
    MESSAGES.ar, "ar"
  ).body;
  assert.equal(at(1), "نشاط واحد");
  assert.equal(at(2), "نشاطان");
  assert.equal(at(5), "5 أنشطة");
  assert.equal(at(11), "11 نشاطا");
  assert.equal(at(100), "100 نشاط");
});

test("a fact the day did not record leaves no word behind", () => {
  const quiet = { ...care, arrivedAt: null, lessons: 0, menu: false, eaten: null, napMinutes: 0, mood: null };
  assert.equal(renderNotification(row("daily_report", quiet), MESSAGES.fr, "fr").body, "pas de sieste");
  const nothing = { ...quiet, napMinutes: null };
  assert.equal(renderNotification(row("daily_report", nothing), MESSAGES.fr, "fr").body, "");
  // A crèche without a meal line falls back to the menu; with one, the meal wins.
  const menuOnly = { ...quiet, eaten: null, menu: true, napMinutes: null };
  assert.equal(renderNotification(row("daily_report", menuOnly), MESSAGES.en, "en").body, "today's menu");
});

test("rows the educator published by hand, and rows older than the sender, keep the template body", () => {
  const byHand = { childId: care.childId, date: "2026-09-10", source: "journal", childName: "Adam Amrani", audience: "parent" };
  assert.equal(renderNotification(row("daily_report", byHand), MESSAGES.fr, "fr").body, "Le journal du jour a été publié.");
  const legacy = { childId: care.childId, childName: "Adam Amrani" };
  assert.equal(renderNotification(row("daily_report", legacy), MESSAGES.ar, "ar").body, "نُشرت يوميات اليوم.");
});

test("a journal row lands on its day: the family's day page, the staff's Journal screen", () => {
  const n = { type: "daily_report", data: care };
  assert.equal(notificationHref(n, true), `/portal/children/${care.childId}/day/2026-09-10`);
  assert.equal(notificationHref(n, false), "/attendance/journal?date=2026-09-10");
  assert.equal(notificationHref({ type: "daily_report", data: { childId: care.childId } }, true), `/portal/children/${care.childId}`);
  assert.equal(notificationHref({ type: "daily_report", data: {} }, false), "/attendance");
  assert.equal(notificationHref({ type: "daily_report", data: {} }, true), "/portal");
  // A date that is not one never reaches the URL.
  assert.equal(notificationHref({ type: "daily_report", data: { childId: care.childId, date: "../x" } }, true), `/portal/children/${care.childId}`);
});

test("the setting and its default agree with the database bounds", () => {
  assert.deepEqual(dailyJournalSettings(null), { enabled: false, sendAt: "17:00" });
  assert.deepEqual(dailyJournalSettings({ daily_journal: { enabled: true, send_at: "18:30" } }), { enabled: true, sendAt: "18:30" });
  // A value the CHECK would refuse never reaches a TimePicker as its selection.
  assert.deepEqual(dailyJournalSettings({ daily_journal: { enabled: true, send_at: "21:15" } }), { enabled: true, sendAt: "17:00" });
  const week = (close) => ({ sun: { open: "08:00", close }, mon: { open: "08:00", close }, tue: null, wed: null, thu: null, fri: null, sat: null });
  assert.equal(defaultSendAt([week("16:30")]), "17:00");
  assert.equal(defaultSendAt([week("16:45"), week("16:30")]), "17:30");
  assert.equal(defaultSendAt([week("18:00")]), "18:30");
  assert.equal(defaultSendAt([week("23:00")]), "21:00");
  assert.equal(defaultSendAt([]), "17:00");
});

test("the day parser keeps the composer's shape and drops what is not a fact", () => {
  assert.equal(parseChildDay(null), null);
  assert.equal(parseChildDay({ date: "2026-09-10" }), null);
  const day = parseChildDay({
    date: "2026-09-10",
    child: { id: "c", tenantId: "t", firstName: "Adam", lastName: "Amrani", profile: "care", classId: "k", className: "Petite Section" },
    closed: false, hours: { open: "08:00", close: "16:30" }, holiday: null,
    attendance: { status: "present", checkIn: "2026-09-10T07:12:00+00:00", checkOut: null, pickedUpBy: null },
    lessons: [{ id: "l1", title: "Accueil", kind: "care", startsAt: "2026-09-10T07:00:00+00:00", endsAt: "2026-09-10T08:00:00+00:00", status: "scheduled" }, { title: "no id" }],
    menu: { breakfast: null, lunch: "Couscous", snack: null, notes: null },
    journal: { id: "j", mood: "calm", meals: [{ meal: "lunch", eaten: "all" }], nap: { start: "13:00", end: "14:00" }, photos: [{ path: "t/x.jpg", at: "2026-09-10T10:00:00+00:00" }, { nope: true }], published: true, updatedAt: "2026-09-10T15:00:00+00:00" },
    incidents: [], sessions: [],
  });
  assert.equal(day.child.profile, "care");
  assert.equal(day.lessons.length, 1);
  assert.equal(day.journal.photos.length, 1);
  assert.equal(day.menu.lunch, "Couscous");
  assert.equal(day.attendance.status, "present");
  assert.deepEqual(sectionsFor("therapy"), ["presence", "blocks", "sessions", "incidents"]);
  assert.deepEqual(sectionsFor("academic"), ["presence", "blocks", "meals", "photos", "incidents", "notes"]);
});
