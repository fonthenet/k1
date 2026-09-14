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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const { NOTIFICATION_TYPES, renderNotification, notificationHref, isoInstant } = await import(
  pathToFileURL(path.join(root, "src/lib/notifications.ts")).href
);
const { dailyJournalSettings, defaultSendAt, parseChildDay, sectionsFor } = await import(
  pathToFileURL(path.join(root, "src/lib/child-day.ts")).href
);
// The calendar lib shares this loader: pure helpers, no database.
const calendar = await import(pathToFileURL(path.join(root, "src/lib/calendar.ts")).href);
const closures = await import(pathToFileURL(path.join(root, "src/lib/closures.ts")).href);
const ics = await import(pathToFileURL(path.join(root, "src/lib/ics.ts")).href);

const LOCALES = ["ar", "fr", "en"];

// The merged file, plus every pending fragment that carries the namespace, so
// the test is the same before and after `merge-message-fragments --override`:
// a fragment's value wins over the merged file's, exactly as the lead's pass
// applies a vocabulary change.
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] && typeof target[k] === "object" ? target[k] : {}, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}
function messagesFor(locale) {
  const merged = JSON.parse(readFileSync(path.join(root, "messages", locale, "notifications.json"), "utf8"));
  const pendingDir = path.join(root, "messages", "_pending");
  if (existsSync(pendingDir)) {
    for (const f of readdirSync(pendingDir).filter((f) => f.endsWith(".json")).sort()) {
      const frag = JSON.parse(readFileSync(path.join(pendingDir, f), "utf8"));
      if (frag[locale]?.notifications) deepMerge(merged, frag[locale].notifications);
    }
  }
  return merged;
}
const MESSAGES = Object.fromEntries(LOCALES.map((l) => [l, messagesFor(l)]));

const FSI = "\u2068";
const PDI = "\u2069";
const ARABIC_INDIC = /[٠-٩]/;
// What every `time`/`endTime` the calendar writes must look like (0159:
// to_jsonb(timestamptz)) — the one form Safari's Date parser accepts.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;

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
  // On by default since 0163; only an explicit false turns it off.
  assert.deepEqual(dailyJournalSettings(null), { enabled: true, sendAt: "17:00" });
  assert.deepEqual(dailyJournalSettings({ daily_journal: { enabled: false, send_at: "17:00" } }), { enabled: false, sendAt: "17:00" });
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

// ── 0159: the calendar's rows, worded by what happened ──────────────────────

// The parents' meeting of the demo seed (A2): Petite Section, 22 Sept 17:00
// Algiers (16:00Z), Salle 1, RSVP. `time`/`endTime` are the 0097 shape —
// a timestamptz through to_jsonb — never `::text`.
const meeting = {
  eventId: "a5f0b4c2-9d3e-4c1f-8b7a-015700000002", kind: "created",
  classId: "c1", className: "Petite Section", classNameAr: "القسم الصغير",
  structureId: null, structureName: "", structureNameAr: "",
  roomName: "Salle 1", roomNameAr: "القاعة 1",
  date: "2026-09-22", time: "2026-09-22T16:00:00+00:00", endTime: "2026-09-22T17:00:00+00:00",
  allDay: false, description: "Rentrée", audience: "both",
};
const meetingRow = (kind, extra = {}) => row("event", { ...meeting, kind, ...extra }, { title: "Réunion des parents" });

test("an event row says what happened, from the kind in its payload", () => {
  const name = `${FSI}Réunion des parents${PDI}`;
  const titles = {
    fr: { created: `Nouvel événement — ${name}`, changed: `Événement modifié — ${name}`, removed: `Ne vous concerne plus — ${name}`, cancelled: `Événement annulé — ${name}`, reminder: `Demain : ${name}` },
    en: { created: `New event — ${name}`, changed: `Event changed — ${name}`, removed: `No longer concerns you — ${name}`, cancelled: `Event cancelled — ${name}`, reminder: `Tomorrow: ${name}` },
    ar: { created: `فعالية جديدة — ${name}`, changed: `تغيير في الفعالية — ${name}`, removed: `لم تعد تخصّكم — ${name}`, cancelled: `إلغاء الفعالية — ${name}`, reminder: `غدًا: ${name}` },
  };
  for (const locale of LOCALES) {
    for (const kind of ["created", "changed", "removed", "cancelled", "reminder"]) {
      const { title } = renderNotification(meetingRow(kind), MESSAGES[locale], locale);
      assert.equal(title, titles[locale][kind], `${locale} ${kind}`);
    }
  }
  // The body carries the room, in the reader's script, between the clock and the class.
  assert.equal(renderNotification(meetingRow("created"), MESSAGES.fr, "fr").body, "22 septembre · 17:00 · Salle 1 · Petite Section · Rentrée");
  assert.equal(renderNotification(meetingRow("created"), MESSAGES.en, "en").body, "22 September · 17:00 · Salle 1 · Petite Section · Rentrée");
  const ar = renderNotification(meetingRow("created"), MESSAGES.ar, "ar").body;
  assert.ok(ar.includes("17:00 · القاعة 1 · القسم الصغير · Rentrée"), ar);
  assert.ok(!ARABIC_INDIC.test(ar), `Arabic-Indic digit in "${ar}"`);
  // A change to the room says the new room; the reminder keeps the full line.
  assert.equal(renderNotification(meetingRow("changed", { roomName: "Cour", roomNameAr: "الساحة" }), MESSAGES.fr, "fr").body, "22 septembre · 17:00 · Cour · Petite Section · Rentrée");
  assert.equal(renderNotification(meetingRow("reminder"), MESSAGES.fr, "fr").body, "22 septembre · 17:00 · Salle 1 · Petite Section · Rentrée");
});

test("removed and cancelled have their own sentence; a row without a kind keeps the plain title", () => {
  assert.equal(renderNotification(meetingRow("removed"), MESSAGES.fr, "fr").body, "L'événement du 22 septembre ne concerne plus votre enfant.");
  assert.equal(renderNotification(meetingRow("cancelled"), MESSAGES.fr, "fr").body, "L'événement du 22 septembre n'aura pas lieu.");
  assert.equal(renderNotification(meetingRow("cancelled"), MESSAGES.en, "en").body, "The event on 22 September will not take place.");
  assert.equal(renderNotification(meetingRow("removed"), MESSAGES.ar, "ar").body, "فعالية يوم 22 سبتمبر لم تعد تخصّ طفلكم.");
  // A 0090/0097 row written before `kind` existed: the type's own title, the full body.
  const legacy = Object.fromEntries(Object.entries(meeting).filter(([k]) => k !== "kind"));
  const old = renderNotification(row("event", legacy, { title: "Réunion des parents" }), MESSAGES.fr, "fr");
  assert.equal(old.title, `${FSI}Réunion des parents${PDI}`);
  assert.equal(old.body, "22 septembre · 17:00 · Salle 1 · Petite Section · Rentrée");
});

test("an all-day event with no room collapses its empty segments", () => {
  // A1 of the seed: the outing of 1re année, all day, no room, no description.
  const outing = { ...meeting, kind: "created", className: "1re année", classNameAr: "السنة الأولى", roomName: "", roomNameAr: "", time: "", endTime: "", allDay: true, description: "", date: "2026-09-23" };
  for (const locale of LOCALES) {
    const { body } = renderNotification(row("event", outing, { title: "Sortie au parc" }), MESSAGES[locale], locale);
    assert.ok(!/·\s*·|^\s*·|·\s*$/.test(body), `${locale}: "${body}"`);
  }
  assert.equal(renderNotification(row("event", outing, { title: "Sortie au parc" }), MESSAGES.fr, "fr").body, "23 septembre · 1re année");
  // Room but no class, no description: two segments, one separator.
  assert.equal(renderNotification(meetingRow("created", { className: "", classNameAr: "", description: "" }), MESSAGES.en, "en").body, "22 September · 17:00 · Salle 1");
});

test("the row's own name is isolated (FSI…PDI) so a French title survives an Arabic sentence", () => {
  const { title } = renderNotification(meetingRow("created"), MESSAGES.ar, "ar");
  assert.equal(title, `فعالية جديدة — ${FSI}Réunion des parents${PDI}`);
  // An Arabic name inside a French sentence is isolated the same way.
  const arabicName = renderNotification(row("event", { ...meeting, kind: "reminder" }, { title: "اجتماع الأولياء" }), MESSAGES.fr, "fr").title;
  assert.equal(arabicName, `Demain : ${FSI}اجتماع الأولياء${PDI}`);
  // A closure's name is stored in both scripts and picked by locale, not by the row's title.
  const closure = { holidayId: "h1", kind: "created", date: "2026-09-27", endDate: "2026-09-28", name: "Journées pédagogiques", nameAr: "أيام بيداغوجية", structureId: "s3", structureName: "L'école primaire", structureNameAr: "المدرسة الابتدائية", tentative: false, holidayKind: "closure", audience: "both" };
  assert.equal(renderNotification(row("closure", closure, { title: "أيام بيداغوجية" }), MESSAGES.fr, "fr").title, `Fermeture — ${FSI}Journées pédagogiques${PDI}`);
  assert.equal(renderNotification(row("closure", closure, { title: "أيام بيداغوجية" }), MESSAGES.ar, "ar").title, `إغلاق — ${FSI}أيام بيداغوجية${PDI}`);
});

test("a closure reads as one day or as a range, with the structure only when it has one", () => {
  const ecole = { holidayId: "h1", kind: "created", date: "2026-09-27", endDate: "2026-09-28", name: "Journées pédagogiques", nameAr: "أيام بيداغوجية", structureId: "s3", structureName: "L'école primaire", structureNameAr: "المدرسة الابتدائية", tentative: false, holidayKind: "closure", audience: "both" };
  assert.equal(renderNotification(row("closure", ecole, { title: "x" }), MESSAGES.fr, "fr").body, "Du 27 septembre au 28 septembre · L'école primaire");
  assert.equal(renderNotification(row("closure", ecole, { title: "x" }), MESSAGES.en, "en").body, "From 27 September to 28 September · L'école primaire");
  assert.equal(renderNotification(row("closure", ecole, { title: "x" }), MESSAGES.ar, "ar").body, "من 27 سبتمبر إلى 28 سبتمبر · المدرسة الابتدائية");
  // The whole building, one day, the afternoon before: no structure, no range.
  const toussaint = { ...ecole, kind: "reminder", date: "2026-11-01", endDate: null, name: "Toussaint", nameAr: "عيد الثورة", structureId: null, structureName: "", structureNameAr: "", holidayKind: "public" };
  const r = renderNotification(row("closure", toussaint, { title: "عيد الثورة" }), MESSAGES.fr, "fr");
  assert.equal(r.title, `Fermé demain — ${FSI}Toussaint${PDI}`);
  assert.equal(r.body, "1 novembre");
  // endDate equal to date is one day, not a range of one.
  const oneDay = { ...ecole, kind: "confirmed", endDate: "2026-09-27" };
  const c = renderNotification(row("closure", oneDay, { title: "x" }), MESSAGES.fr, "fr");
  assert.equal(c.title, `Date confirmée — ${FSI}Journées pédagogiques${PDI}`);
  assert.equal(c.body, "27 septembre · L'école primaire");
});

// Adam's speech appointment of the seed: 23 Sept 10:00 Algiers (09:00Z), 45 min.
const appointment = {
  sessionId: "a5f0b4c2-9d3e-4c1f-8b7a-015700000031", kind: "created", childId: care.childId,
  childName: "Adam Amrani", childNameAr: "آدم عمراني",
  date: "2026-09-23", time: "2026-09-23T09:00:00+00:00", endTime: "2026-09-23T09:45:00+00:00",
  sessionType: "speech", therapist: "Nadia Bouzid", audience: "parent",
};

test("a therapy appointment names the child, the type word and the therapist, per kind", () => {
  const at = (kind, locale) => renderNotification(row("session_scheduled", { ...appointment, kind }, { title: "Adam Amrani" }), MESSAGES[locale], locale);
  assert.equal(at("created", "fr").title, "Rendez-vous — Adam Amrani");
  assert.equal(at("created", "fr").body, "23 septembre · 10:00 · Nadia Bouzid");
  assert.equal(at("rescheduled", "fr").title, "Rendez-vous déplacé — Adam Amrani");
  assert.equal(at("changed", "fr").title, "Rendez-vous modifié — Adam Amrani");
  assert.equal(at("cancelled", "fr").title, "Rendez-vous annulé — Adam Amrani");
  assert.equal(at("reminder", "fr").title, "Demain : Orthophonie — Adam Amrani");
  assert.equal(at("changed", "en").title, "Appointment updated — Adam Amrani");
  assert.equal(at("reminder", "en").title, "Tomorrow: Speech therapy — Adam Amrani");
  assert.equal(at("created", "ar").title, "موعد — آدم عمراني");
  assert.equal(at("changed", "ar").title, "تعديل الموعد — آدم عمراني");
  assert.equal(at("reminder", "ar").title, "غدًا: تقويم النطق — آدم عمراني");
  assert.ok(at("created", "ar").body.includes("10:00 · Nadia Bouzid"), at("created", "ar").body);
  // A type word the bundle lacks falls back to the enum rather than a blank.
  assert.equal(renderNotification(row("session_scheduled", { ...appointment, kind: "reminder", sessionType: "hydrotherapy" }, { title: "x" }), MESSAGES.fr, "fr").title, "Demain : hydrotherapy — Adam Amrani");
});

test("a test or exam date reaches the family with the kind word and the class", () => {
  const exam = { assessmentId: "x1", kind: "created", assessmentKind: "exam", classId: "c9", className: "2e année", classNameAr: "السنة الثانية", date: "2026-09-29", audience: "parent" };
  const r = (kind, locale) => renderNotification(row("assessment_scheduled", { ...exam, kind }, { title: "Mathématiques" }), MESSAGES[locale], locale);
  assert.equal(r("created", "fr").title, `Examen — ${FSI}Mathématiques${PDI}`);
  assert.equal(r("created", "fr").body, "29 septembre · 2e année");
  assert.equal(r("changed", "fr").title, `Date modifiée — ${FSI}Mathématiques${PDI}`);
  assert.equal(r("created", "en").title, `Exam — ${FSI}Mathématiques${PDI}`);
  assert.equal(r("changed", "en").title, `Date changed — ${FSI}Mathématiques${PDI}`);
  assert.equal(r("created", "ar").title, `اختبار — ${FSI}Mathématiques${PDI}`);
  assert.equal(r("created", "ar").body, "29 سبتمبر · السنة الثانية");
  assert.equal(renderNotification(row("assessment_scheduled", { ...exam, assessmentKind: "test" }, { title: "Dictée" }), MESSAGES.fr, "fr").title, `Devoir — ${FSI}Dictée${PDI}`);
});

test("a leave decision reads as its answer, one day or a range", () => {
  const sick = { leaveId: "l1", kind: "approved", leaveType: "sick", date: "2026-10-01", endDate: "2026-10-01", audience: "staff" };
  const a = renderNotification(row("leave", sick, { title: "Nadia Bouzid" }), MESSAGES.fr, "fr");
  assert.equal(a.title, "Congé accepté");
  assert.equal(a.body, "1 octobre · congé maladie");
  const vacation = { ...sick, kind: "rejected", leaveType: "vacation", date: "2026-10-04", endDate: "2026-10-08" };
  const v = renderNotification(row("leave", vacation, { title: "Nadia Bouzid" }), MESSAGES.fr, "fr");
  assert.equal(v.title, "Congé refusé");
  assert.equal(v.body, "Du 4 octobre au 8 octobre · congé annuel");
  assert.equal(renderNotification(row("leave", vacation, { title: "x" }), MESSAGES.en, "en").body, "From 4 October to 8 October · annual leave");
  assert.equal(renderNotification(row("leave", vacation, { title: "x" }), MESSAGES.ar, "ar").title, "إجازة مرفوضة");
  assert.equal(renderNotification(row("leave", vacation, { title: "x" }), MESSAGES.ar, "ar").body, "من 4 أكتوبر إلى 8 أكتوبر · إجازة سنوية");
  // A row with no endDate at all is one day too.
  assert.equal(renderNotification(row("leave", { ...sick, endDate: null }, { title: "x" }), MESSAGES.en, "en").body, "1 October · sick leave");
});

test("every clock the calendar writes is a Safari-safe ISO instant; an older text form is repaired", () => {
  for (const payload of [meeting, { ...meeting, kind: "reminder" }, appointment]) {
    for (const key of ["time", "endTime"]) {
      assert.match(payload[key], ISO_INSTANT, `${key} of ${payload.kind}`);
      assert.ok(!Number.isNaN(Date.parse(payload[key])));
      assert.equal(isoInstant(payload[key]), payload[key]);
    }
  }
  // What `timestamptz::text` produces — a space and a bare hour offset — is
  // what Safari's parser refuses; the renderer repairs it before parsing.
  assert.equal(isoInstant("2026-09-22 16:00:00+00"), "2026-09-22T16:00:00+00:00");
  assert.equal(isoInstant("2026-09-22 16:00:00+01:00"), "2026-09-22T16:00:00+01:00");
  assert.equal(isoInstant("2026-09-22"), "2026-09-22");
  const legacy = renderNotification(row("event", { ...meeting, time: "2026-09-22 16:00:00+00", endTime: "" }, { title: "x" }), MESSAGES.fr, "fr");
  assert.equal(legacy.body, "22 septembre · 17:00 · Salle 1 · Petite Section · Rentrée");
});

test("the calendar rows land on their day: the staff calendar or the family's", () => {
  const e = { type: "event", data: meeting };
  assert.equal(notificationHref(e, false), `/calendar?view=day&date=2026-09-22&event=${meeting.eventId}`);
  assert.equal(notificationHref(e, true), `/portal/calendar?date=2026-09-22&event=${meeting.eventId}`);
  // No date (a 0090 row), or a date that is not one: the calendar itself.
  assert.equal(notificationHref({ type: "event", data: { eventId: meeting.eventId } }, false), "/calendar");
  assert.equal(notificationHref({ type: "event", data: { eventId: meeting.eventId, date: "../x" } }, true), "/portal/calendar");
  assert.equal(notificationHref({ type: "closure", data: { date: "2026-11-01" } }, false), "/calendar?date=2026-11-01");
  assert.equal(notificationHref({ type: "closure", data: { date: "2026-11-01" } }, true), "/portal/calendar?date=2026-11-01");
  assert.equal(notificationHref({ type: "closure", data: {} }, true), "/portal/calendar");
  assert.equal(notificationHref({ type: "session_scheduled", data: appointment }, true), "/portal/calendar?date=2026-09-23");
  assert.equal(notificationHref({ type: "session_scheduled", data: appointment }, false), `/sessions/${appointment.sessionId}`);
  assert.equal(notificationHref({ type: "assessment_scheduled", data: { assessmentId: "x1", date: "2026-09-29" } }, true), "/portal/calendar?date=2026-09-29");
  assert.equal(notificationHref({ type: "assessment_scheduled", data: { assessmentId: "x1", date: "2026-09-29" } }, false), "/learning/assessments/x1");
  assert.equal(notificationHref({ type: "leave", data: { leaveId: "l1" } }, false), "/staff/leaves");
  assert.equal(notificationHref({ type: "leave", data: { leaveId: "l1" } }, true), "/staff/leaves");
});

// ── 0164: the dossier d'inscription, two types ──────────────────────────────

// What kg_on_child_document_change writes: the requirement's name in both
// scripts, the child's name in both, and — for a review — the kind. The row's
// own title is the French requirement name; its body is the review note on a
// refusal and null otherwise.
const paper = {
  childId: null, applicationId: "fde84844-0000-4000-8000-000000000001", documentId: "d1",
  requirementKey: "birth_certificate", name: "Extrait de naissance", nameAr: "شهادة الميلاد",
  childName: "Alaa Bensalem", childNameAr: "آلاء بن سالم",
};
const paperRow = (type, extra = {}, body = null) =>
  row(type, { ...paper, ...extra }, { title: "Extrait de naissance", body });

test("a paper the family sent names the child and the paper, in the reader's script", () => {
  const fr = renderNotification(paperRow("document_received", { audience: "staff" }), MESSAGES.fr, "fr");
  assert.equal(fr.title, "Pièce reçue — Alaa Bensalem");
  assert.equal(fr.body, `${FSI}Extrait de naissance${PDI}`);
  assert.equal(renderNotification(paperRow("document_received", { audience: "staff" }), MESSAGES.en, "en").title, "Document received — Alaa Bensalem");
  // An Arabic reader gets the Arabic requirement name, never the French one
  // the row's title carries — the payload names the paper in both scripts.
  const ar = renderNotification(paperRow("document_received", { audience: "staff" }), MESSAGES.ar, "ar");
  assert.equal(ar.title, "وثيقة مستلمة — آلاء بن سالم");
  assert.equal(ar.body, `${FSI}شهادة الميلاد${PDI}`);
  // A director who renamed the row without an Arabic name: the French name, isolated.
  const renamed = renderNotification(paperRow("document_received", { name: "Acte de naissance", nameAr: null }), MESSAGES.ar, "ar");
  assert.equal(renamed.body, `${FSI}Acte de naissance${PDI}`);
});

test("a refusal carries the note as the body; completion has its own sentence; a row without a kind keeps the plain title", () => {
  const note = "Photo floue — merci de la reprendre à la lumière du jour";
  const refused = (locale) => renderNotification(paperRow("document_reviewed", { kind: "rejected", audience: "parent" }, note), MESSAGES[locale], locale);
  assert.equal(refused("fr").title, "Pièce refusée — Alaa Bensalem");
  assert.equal(refused("fr").body, `${FSI}Extrait de naissance${PDI} · ${note}`);
  assert.equal(refused("en").title, "Document refused — Alaa Bensalem");
  assert.equal(refused("ar").title, "وثيقة مرفوضة — آلاء بن سالم");
  assert.equal(refused("ar").body, `${FSI}شهادة الميلاد${PDI} · ${note}`);
  // The last required paper accepted: one sentence, no paper named, no note.
  const complete = (locale) => renderNotification(paperRow("document_reviewed", { kind: "complete", audience: "parent" }), MESSAGES[locale], locale);
  assert.equal(complete("fr").title, "Dossier complet — Alaa Bensalem");
  assert.equal(complete("fr").body, "Toutes les pièces demandées sont acceptées.");
  assert.equal(complete("en").body, "Every requested document is accepted.");
  assert.equal(complete("ar").title, "اكتمل الملف — آلاء بن سالم");
  assert.equal(complete("ar").body, "قُبلت جميع الوثائق المطلوبة.");
  // No kind (a bundle or a row that predates one): the type's own title and the paper.
  const plain = renderNotification(paperRow("document_reviewed", { audience: "parent" }), MESSAGES.fr, "fr");
  assert.equal(plain.title, "Dossier — Alaa Bensalem");
  assert.equal(plain.body, `${FSI}Extrait de naissance${PDI}`);
  // A refusal whose note was lost leaves no dangling separator behind.
  const noNote = renderNotification(paperRow("document_reviewed", { kind: "rejected" }), MESSAGES.fr, "fr");
  assert.equal(noNote.body, `${FSI}Extrait de naissance${PDI}`);
  for (const locale of LOCALES) {
    assert.ok(!ARABIC_INDIC.test(refused(locale).body + complete(locale).body), locale);
  }
});

test("a paper lands where it is reviewed or fixed", () => {
  const app = paper.applicationId;
  const child = "809202b0-ab41-4523-8f4c-298aae11fa5e";
  // The office: the application while the file is pending, the child's Dossier tab once it exists.
  assert.equal(notificationHref({ type: "document_received", data: paper }, false), `/applications/${app}`);
  assert.equal(notificationHref({ type: "document_received", data: { ...paper, applicationId: null, childId: child } }, false), `/children/${child}?tab=documents`);
  assert.equal(notificationHref({ type: "document_reviewed", data: { ...paper, applicationId: null, childId: child, kind: "complete" } }, false), `/children/${child}?tab=documents`);
  assert.equal(notificationHref({ type: "document_received", data: {} }, false), "/applications");
  // The family: the child's Dossier tab after approval, its own pending file
  // before (tenant-less — a first-time applicant has no membership yet).
  assert.equal(notificationHref({ type: "document_reviewed", data: { ...paper, kind: "rejected" } }, true), `/enroll/dossier/${app}`);
  assert.equal(notificationHref({ type: "document_reviewed", data: { ...paper, applicationId: null, childId: child, kind: "complete" } }, true), `/portal/children/${child}?tab=permissions`);
  // A row bound to the child at approval keeps application_id as provenance; the child wins.
  assert.equal(notificationHref({ type: "document_reviewed", data: { ...paper, childId: child, kind: "complete" } }, true), `/portal/children/${child}?tab=permissions`);
  assert.equal(notificationHref({ type: "document_reviewed", data: {} }, true), "/portal/children");
  // A parent who is also staff reads the office's row as a parent: home, not the queue.
  assert.equal(notificationHref({ type: "document_received", data: paper }, true), "/portal");
  assert.ok(NOTIFICATION_TYPES.includes("document_received") && NOTIFICATION_TYPES.includes("document_reviewed"));
});

// ── src/lib/calendar.ts — the pure half ─────────────────────────────────────

test("kinds parse from the URL and the cookie, kept to what the role may tick", () => {
  const { parseKinds, serializeKinds, parseKindsCookie, serializeKindsCookie, eligibleKinds, CALENDAR_KINDS } = calendar;
  const owner = eligibleKinds("owner", "staff");
  assert.deepEqual(owner, [...CALENDAR_KINDS]);
  assert.deepEqual(parseKinds("event,holiday,lesson", owner), ["holiday", "event", "lesson"]);
  assert.equal(parseKinds(undefined, owner), null);
  assert.deepEqual(parseKinds("", owner), []);
  assert.equal(parseKinds("nope,zilch", owner), null);
  // A teacher's URL asking for money keeps the kinds she may see and drops the rest.
  const educator = eligibleKinds("educator", "staff");
  assert.ok(!educator.includes("invoice_due") && !educator.includes("payroll"));
  assert.deepEqual(parseKinds("invoice_due,event", educator), ["event"]);
  const accountant = eligibleKinds("accountant", "staff");
  assert.ok(!accountant.includes("session") && !accountant.includes("birthday") && accountant.includes("payroll"));
  assert.deepEqual(eligibleKinds("parent", "family"), ["holiday", "event", "lesson", "session", "activity", "assessment", "invoice_due"]);
  assert.equal(serializeKinds(["lesson", "event", "event", "holiday"]), "holiday,event,lesson");
  assert.equal(serializeKindsCookie("mine", ["lesson", "holiday"]), "mine|month=holiday,lesson");
  // The first shape reads as the month's slot; the week falls back to its own defaults.
  assert.deepEqual(parseKindsCookie("mine|holiday,lesson", owner), { scope: "mine", kinds: ["holiday", "lesson"] });
  assert.deepEqual(parseKindsCookie("mine|holiday,lesson", owner, "week"), { scope: "mine", kinds: null });
  assert.deepEqual(parseKindsCookie("what|holiday", owner), { scope: null, kinds: ["holiday"] });
  assert.deepEqual(parseKindsCookie(undefined, owner), { scope: null, kinds: null });
  // One view's tick never reaches another view's slot.
  const withWeek = serializeKindsCookie("all", ["event"], "week", "mine|month=holiday,lesson");
  assert.equal(withWeek, "all|month=holiday,lesson;week=event");
  assert.deepEqual(parseKindsCookie(withWeek, owner, "month"), { scope: "all", kinds: ["holiday", "lesson"] });
  assert.deepEqual(parseKindsCookie(withWeek, owner, "week"), { scope: "all", kinds: ["event"] });
  assert.deepEqual(parseKindsCookie(withWeek, owner, "day"), { scope: "all", kinds: null });
  assert.equal(calendar.KINDS_COOKIE, "kg-calendar-kinds");
});

test("the defaults per role and view (decision 10)", () => {
  const { defaultKinds, defaultScope, eligibleKinds } = calendar;
  assert.deepEqual(defaultKinds("owner", "month"), ["holiday", "event", "session", "leave", "assessment", "task", "interview", "birthday"]);
  assert.deepEqual(defaultKinds("admin", "week"), eligibleKinds("admin", "staff"));
  assert.deepEqual(defaultKinds("accountant", "month"), ["holiday", "event", "invoice_due", "payroll", "leave", "task", "interview"]);
  assert.ok(defaultKinds("accountant", "day").includes("lesson") && defaultKinds("accountant", "day").includes("activity"));
  for (const view of ["month", "week", "day"]) {
    assert.deepEqual(defaultKinds("educator", view), ["holiday", "event", "lesson", "session", "activity", "assessment", "task", "leave"]);
  }
  assert.equal(defaultScope("educator"), "mine");
  assert.equal(defaultScope("staff"), "mine");
  assert.equal(defaultScope("owner"), "all");
  assert.equal(defaultScope("accountant"), "all");
});

const rowOf = (over) => ({
  id: "event:e1", kind: "event", date: "2026-09-22", last_date: "2026-09-22",
  starts_at: "2026-09-22T16:00:00+00:00", ends_at: "2026-09-22T17:00:00+00:00", all_day: false,
  title: "Réunion des parents", title_ar: null, subtitle: "Salle 1", subtitle_ar: "القاعة 1",
  source_id: "e1", structure_id: null, class_id: "c1", child_id: null, room_id: "r1", membership_id: null,
  tentative: false, cancelled: false, closure: false, count: 1, meta: { audience: "class" },
  ...over,
});

test("a row becomes an item in the reader's script with Algiers clocks and its door", () => {
  const { toItem } = calendar;
  const fr = toItem(rowOf({}), "staff", "fr", false);
  assert.equal(fr.start, "17:00");
  assert.equal(fr.end, "18:00");
  assert.equal(fr.subtitle, "Salle 1");
  assert.equal(fr.href, null);
  const ar = toItem(rowOf({}), "staff", "ar", false);
  assert.equal(ar.subtitle, "القاعة 1");
  assert.equal(ar.title, "Réunion des parents");
  // An all-day row has no clock; a marker has no title but keeps its count.
  const outing = toItem(rowOf({ id: "event:e2", starts_at: null, ends_at: null, all_day: true, last_date: "2026-09-23" }), "family", "fr");
  assert.equal(outing.start, undefined);
  assert.equal(outing.lastDate, "2026-09-23");
  const dues = toItem(rowOf({ id: "invoice_due:2026-09-30", kind: "invoice_due", date: "2026-09-30", last_date: "2026-09-30", starts_at: null, ends_at: null, all_day: true, title: null, subtitle: null, subtitle_ar: null, source_id: null, count: 6, meta: { late: false, balance: 42000 } }), "staff", "fr");
  assert.equal(dues.title, "");
  assert.equal(dues.count, 6);
  assert.equal(dues.href, "/billing?month=2026-09&status=unpaid");
});

test("every kind has one door per audience, and none invents a route", () => {
  const { kindHref } = calendar;
  const staff = (over, isAdmin = false) => kindHref(rowOf(over), "staff", { isAdmin });
  const family = (over) => kindHref(rowOf(over), "family", { isAdmin: false });
  assert.equal(staff({ kind: "event" }), null);
  assert.equal(staff({ kind: "lesson", source_id: "l1" }), null);
  assert.equal(staff({ kind: "session", source_id: "s1" }), "/sessions/s1");
  assert.equal(staff({ kind: "activity", source_id: "a1" }), "/activities/a1");
  assert.equal(staff({ kind: "assessment", source_id: "x1" }), "/learning/assessments/x1");
  assert.equal(staff({ kind: "task" }), "/tasks");
  assert.equal(staff({ kind: "leave" }), "/staff/leaves");
  assert.equal(staff({ kind: "interview", source_id: "ap1" }), "/applications/ap1");
  assert.equal(staff({ kind: "birthday", child_id: "ch1" }), "/children/ch1");
  assert.equal(staff({ kind: "invoice_due", date: "2026-10-05" }), "/billing?month=2026-10&status=unpaid");
  assert.equal(staff({ kind: "payroll" }), "/accounting/payroll");
  assert.equal(staff({ kind: "holiday", source_id: "h1" }), null);
  assert.equal(staff({ kind: "holiday", source_id: "h1" }, true), "/settings/holidays?holiday=h1");
  assert.equal(family({ kind: "event" }), null);
  assert.equal(family({ kind: "holiday" }), null);
  // 22 Sept 2026 is a Tuesday; the family's week is its Sunday.
  assert.equal(family({ kind: "lesson", date: "2026-09-22" }), "/portal/learning?week=2026-09-20");
  assert.equal(family({ kind: "session", child_id: "ch1" }), "/portal/children/ch1");
  assert.equal(family({ kind: "activity", child_id: "ch1" }), "/portal/children/ch1");
  assert.equal(family({ kind: "assessment", child_id: "ch1" }), "/portal/children/ch1");
  assert.equal(family({ kind: "invoice_due" }), "/portal/payments");
  assert.equal(family({ kind: "task" }), null);
  assert.equal(calendar.timetableHref({ date: "2026-09-22", classId: "c1" }), "/learning/timetable?view=day&day=2026-09-22&class=c1");
});

test("items land on every day they cover, clipped to the window, all-day first", () => {
  const { itemsByDay, spans, toItem } = calendar;
  const items = [
    toItem(rowOf({ id: "holiday:h1", kind: "holiday", date: "2026-09-20", last_date: "2026-09-28", starts_at: null, ends_at: null, all_day: true, closure: true, title: "Journées pédagogiques" }), "staff", "fr"),
    toItem(rowOf({ id: "lesson:l1", kind: "lesson", starts_at: "2026-09-22T07:30:00+00:00", ends_at: "2026-09-22T08:30:00+00:00" }), "staff", "fr"),
    toItem(rowOf({}), "staff", "fr"),
    toItem(rowOf({ id: "birthday:ch1", kind: "birthday", date: "2026-09-23", last_date: "2026-09-23", starts_at: null, ends_at: null, all_day: true }), "staff", "fr"),
  ];
  const byDay = itemsByDay(items, "2026-09-21", "2026-09-24");
  assert.deepEqual([...byDay.keys()], ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]);
  assert.deepEqual(byDay.get("2026-09-21").map((i) => i.id), ["holiday:h1"]);
  // The band that started last week comes before the day's own rows, then the clocks in order.
  assert.deepEqual(byDay.get("2026-09-22").map((i) => i.id), ["holiday:h1", "lesson:l1", "event:e1"]);
  assert.deepEqual(byDay.get("2026-09-23").map((i) => i.id), ["holiday:h1", "birthday:ch1"]);
  assert.equal(byDay.get("2026-09-20"), undefined);
  // The band layer: closures and leave always, an event when all-day or multi-day, never a one-day glyph.
  const band = spans([
    ...items,
    toItem(rowOf({ id: "event:e2", starts_at: null, ends_at: null, all_day: true }), "staff", "fr"),
    toItem(rowOf({ id: "leave:lv1", kind: "leave", starts_at: null, ends_at: null, all_day: true, tentative: true }), "staff", "fr"),
  ]).map((i) => i.id);
  assert.deepEqual(band, ["holiday:h1", "event:e2", "leave:lv1"]);
});

// ── src/lib/closures.ts — the one rule ──────────────────────────────────────

const HOURS = { sun: { open: "08:00", close: "16:30" }, mon: { open: "08:00", close: "16:30" }, tue: { open: "08:00", close: "16:30" }, wed: { open: "08:00", close: "16:30" }, thu: { open: "08:00", close: "16:30" }, fri: null, sat: null };
const CRECHE = "515ecf42-3a67-4304-86c6-66fafd6f7229";
const ECOLE = "e1eadc36-2c75-4910-b35d-d3d116227097";
const CLOSURES = [
  { id: "aid", date: "2026-09-15", end_date: null, name: "Aïd (à confirmer)", name_ar: "عيد", tentative: true, closure: true, structure_id: null, kind: "religious" },
  { id: "ped", date: "2026-09-27", end_date: "2026-09-28", name: "Journées pédagogiques", name_ar: "أيام بيداغوجية", tentative: false, closure: true, structure_id: ECOLE, kind: "closure" },
  { id: "toussaint", date: "2026-11-01", end_date: null, name: "Toussaint", name_ar: "عيد الثورة", tentative: false, closure: true, structure_id: null, kind: "public" },
  { id: "open", date: "2026-11-01", end_date: null, name: "Portes ouvertes", name_ar: null, tentative: false, closure: false, structure_id: CRECHE, kind: "closure" },
  { id: "maybe", date: "2026-09-29", end_date: null, name: "Sortie école", name_ar: null, tentative: true, closure: true, structure_id: ECOLE, kind: "closure" },
];

test("a tentative closure names the day and closes nothing; a confirmed one shuts it", () => {
  const { closureOn, closedDates, holidayLabel } = closures;
  const aid = closureOn(CLOSURES, "2026-09-15", null);
  assert.equal(aid.confirmed, null);
  assert.equal(aid.tentative?.id, "aid");
  assert.equal(closureOn(CLOSURES, "2026-09-15", ECOLE).tentative?.id, "aid");
  // 1 Nov shuts the building; the crèche's open-day row is reported beside it, never instead of it.
  const nov = closureOn(CLOSURES, "2026-11-01", CRECHE);
  assert.equal(nov.confirmed?.id, "toussaint");
  assert.equal(nov.open?.id, "open");
  // The école's own closure applies inside the école, not to the building nor to the crèche.
  assert.equal(closureOn(CLOSURES, "2026-09-27", ECOLE).confirmed?.id, "ped");
  assert.equal(closureOn(CLOSURES, "2026-09-27", null).confirmed, null);
  assert.equal(closureOn(CLOSURES, "2026-09-27", CRECHE).confirmed, null);
  // Confirmed rows only, clipped, per scope.
  assert.deepEqual([...closedDates(CLOSURES, "2026-09-01", "2026-11-30", null)], ["2026-11-01"]);
  assert.deepEqual([...closedDates(CLOSURES, "2026-09-01", "2026-09-27", ECOLE)], ["2026-09-27"]);
  assert.deepEqual([...closedDates(CLOSURES, "2026-09-01", "2026-09-30", CRECHE)], []);
  assert.equal(holidayLabel(CLOSURES[1], "ar"), "أيام بيداغوجية");
  assert.equal(holidayLabel(CLOSURES[3], "ar"), "Portes ouvertes");
});

test("buildWeekDays applies the one rule: 15 Sept opens in gold, the école's 27–28 shut its lanes only", () => {
  const { buildWeekDays } = closures;
  const base = { hours: HOURS, closures: CLOSURES, structures: [{ id: CRECHE, name: "La crèche", classIds: ["c1"] }, { id: ECOLE, name: "L'école primaire", classIds: ["c9"] }], busyDays: new Set(), locale: "fr", today: "2026-09-15", todayLabel: "Aujourd'hui" };
  const week = buildWeekDays({ ...base, week: "2026-09-13", structureId: null });
  assert.deepEqual(week.map((d) => d.date), ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]);
  const tue = week.find((d) => d.date === "2026-09-15");
  assert.equal(tue.closed, false);
  assert.equal(tue.closedLabel, "Aïd (à confirmer)");
  assert.equal(tue.tentative, true);
  assert.equal(tue.isToday, true);
  assert.ok(tue.fullLabel.endsWith(", Aujourd'hui"));
  assert.equal(tue.dayNumber, "15");
  assert.deepEqual(tue.hours, { open: "08:00", close: "16:30" });
  assert.deepEqual(tue.closedLanes, []);
  // The école's confirmed closure: the building's day stays open and one lane shuts, with its classes.
  const next = buildWeekDays({ ...base, week: "2026-09-27", structureId: null });
  const sun = next.find((d) => d.date === "2026-09-27");
  assert.equal(sun.closed, false);
  assert.equal(sun.closedLabel, undefined);
  assert.deepEqual(sun.closedLanes, [{ keys: [ECOLE, "c9"], label: "Journées pédagogiques" }]);
  // The école's tentative row on the 29th shuts no lane.
  assert.deepEqual(next.find((d) => d.date === "2026-09-29").closedLanes, []);
  // Inside the école the same day is simply closed, and named.
  const ecole = buildWeekDays({ ...base, week: "2026-09-27", structureId: ECOLE, locale: "ar" });
  const sunEcole = ecole.find((d) => d.date === "2026-09-27");
  assert.equal(sunEcole.closed, true);
  assert.equal(sunEcole.closedLabel, "أيام بيداغوجية");
  assert.equal(sunEcole.tentative, false);
  assert.deepEqual(sunEcole.closedLanes, []);
  assert.ok(!ARABIC_INDIC.test(sunEcole.dayNumber));
  // A busy Friday stays on the sheet, closed by its hours; a building shut all week still gets five columns.
  const busy = buildWeekDays({ ...base, week: "2026-09-13", structureId: null, busyDays: new Set(["2026-09-18"]) });
  assert.equal(busy.length, 6);
  assert.equal(busy[5].closed, true);
  const shut = buildWeekDays({ ...base, week: "2026-09-13", structureId: null, hours: { ...HOURS, sun: null, mon: null, tue: null, wed: null, thu: null } });
  assert.equal(shut.length, 5);
  assert.ok(shut.every((d) => d.closed && d.hours === null));
});

// ── src/lib/ics.ts ──────────────────────────────────────────────────────────

test("the .ics says the event in Algiers time, folds at 75 octets and ends every line with CRLF", () => {
  const { buildEventIcs, foldLine } = ics;
  const now = new Date("2026-09-12T10:00:00Z");
  const text = buildEventIcs({
    id: "a5f0b4c2-9d3e-4c1f-8b7a-015700000002", title: "Réunion des parents; rentrée, Petite Section",
    description: "Ordre du jour :\n1. Rentrée", location: "Salle 1",
    startAt: "2026-09-22T16:00:00+00:00", endAt: "2026-09-22T17:00:00+00:00",
    allDay: false, cancelled: false, updatedAt: "2026-09-12T09:30:00+00:00",
  }, "Roudatek", now);
  assert.ok(!/[^\r]\n/.test(text) && text.endsWith("\r\n"), "CRLF everywhere");
  const lines = text.split("\r\n").filter(Boolean);
  const encoder = new TextEncoder();
  for (const l of lines) assert.ok(encoder.encode(l).length <= 75, `${l.length}: ${l}`);
  const unfolded = text.replace(/\r\n /g, "").split("\r\n");
  assert.ok(unfolded.includes("DTSTART;TZID=Africa/Algiers:20260922T170000"));
  assert.ok(unfolded.includes("DTEND;TZID=Africa/Algiers:20260922T180000"));
  assert.ok(unfolded.includes("UID:event:a5f0b4c2-9d3e-4c1f-8b7a-015700000002@rawdatik"));
  assert.ok(unfolded.includes("DTSTAMP:20260912T100000Z"));
  assert.ok(unfolded.includes(`SEQUENCE:${Math.floor(Date.parse("2026-09-12T09:30:00+00:00") / 1000)}`));
  // The four escapes of RFC 5545 TEXT: "\;" and "\," in the file are "\\;" and "\\," here.
  assert.ok(unfolded.includes("SUMMARY:Réunion des parents\\; rentrée\\, Petite Section"));
  assert.ok(unfolded.includes("DESCRIPTION:Ordre du jour :\\n1. Rentrée"));
  assert.ok(unfolded.includes("LOCATION:Salle 1"));
  assert.ok(unfolded.includes("STATUS:CONFIRMED"));
  assert.ok(unfolded.includes("TZID:Africa/Algiers") && unfolded.includes("TZOFFSETTO:+0100"));
  // A long Arabic title folds on a character boundary, never inside one.
  const arabic = "اجتماع أولياء التلاميذ للدخول المدرسي الجديد في القسم الصغير بالروضة";
  const folded = foldLine(`SUMMARY:${arabic}`);
  assert.ok(folded.includes("\r\n "));
  for (const l of folded.split("\r\n")) assert.ok(encoder.encode(l).length <= 75);
  assert.equal(folded.replace(/\r\n /g, ""), `SUMMARY:${arabic}`);
});

test("an all-day event is a DATE with an exclusive end; a cancelled one says so", () => {
  const { buildEventIcs } = ics;
  // 23 Sept 00:00 Algiers is 22 Sept 23:00Z; the stored end is the next midnight.
  const text = buildEventIcs({
    id: "e1", title: "Sortie au parc", startAt: "2026-09-22T23:00:00+00:00", endAt: "2026-09-23T23:00:00+00:00",
    allDay: true, cancelled: true, updatedAt: "2026-09-12T09:30:00+00:00",
  }, "Roudatek");
  const lines = text.replace(/\r\n /g, "").split("\r\n");
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20260923"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20260924"));
  assert.ok(lines.includes("STATUS:CANCELLED"));
  assert.ok(!lines.some((l) => l.startsWith("LOCATION") || l.startsWith("DESCRIPTION")));
  // No end stored: one day; a timed row with no end has no DTEND at all.
  const oneDay = buildEventIcs({ id: "e2", title: "x", startAt: "2026-09-22T23:00:00+00:00", allDay: true, cancelled: false, updatedAt: "" }, "R");
  assert.ok(oneDay.includes("DTEND;VALUE=DATE:20260924"));
  assert.ok(oneDay.includes("SEQUENCE:0"));
  const visit = buildEventIcs({ id: "e3", title: "Hospital visit", startAt: "2026-09-01T08:00:00+00:00", endAt: "2026-09-01T08:00:00+00:00", allDay: false, cancelled: false, updatedAt: "2026-09-01T00:00:00Z" }, "R");
  assert.ok(visit.includes("DTSTART;TZID=Africa/Algiers:20260901T090000") && visit.includes("DTEND;TZID=Africa/Algiers:20260901T090000"));
  const noEnd = buildEventIcs({ id: "e4", title: "x", startAt: "2026-09-01T08:00:00+00:00", endAt: null, allDay: false, cancelled: false, updatedAt: "2026-09-01T00:00:00Z" }, "R");
  assert.ok(!noEnd.includes("DTEND"));
});
