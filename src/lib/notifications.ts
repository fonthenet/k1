import { formatDZD, formatTime, intlLocale, listFormat } from "@/lib/format";
import type { Locale } from "@/i18n/request";
import { blocksNounKey, sectionsFor, toLearningProfile } from "@/lib/child-day";

/** Every event the platform can notify about. Keep in sync with the DB triggers
 *  in supabase/migrations/0012_kg_notifications.sql and 0049_kg_parent_notifications.sql
 *  and with the allow-list 0159 puts on kg_notifications.type (extended by 0164). */
export const NOTIFICATION_TYPES = [
  "message", "incident", "announcement", "application",
  "checkin", "checkout", "daily_report", "task", "activity_request",
  "parent_update", "payment_overdue", "consent_changed",
  // 0049 — everything that happens to a child now reaches that child's family.
  "pickup_changed", "guardian_access_changed", "allergy_changed", "health_changed",
  "incident_updated", "enrollment_changed",
  "invoice_issued", "payment_recorded", "payment_reversed", "fee_changed",
  "attendance_flagged", "activity_decision", "session_published",
  // 0057 — the applicant hears every admissions decision.
  "application_status",
  // 0090 — a class event reaches that class's families and nobody else.
  // 0159 — its payload carries `kind` (created / changed / removed /
  // cancelled / reminder) and the row is worded by it.
  "event",
  // 0140 — a child moved between the structures of the building (kg_move_child).
  "structure_changed",
  // 0159 — the calendar reaches the people it concerns: a confirmed closure
  // (created / confirmed / reminder), a therapy appointment (created /
  // rescheduled / changed / cancelled / reminder), a test or exam date
  // (created / changed), a leave decision (approved / rejected).
  "closure", "session_scheduled", "assessment_scheduled", "leave",
  // 0164 — the dossier d'inscription: a family paper reached the register
  // (office), a paper was refused or the last required one was accepted
  // (family). The second carries `kind` (rejected / complete); never one
  // push per accepted paper.
  "document_received", "document_reviewed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface KgNotification {
  id: string;
  tenant_id: string | null;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A payload date that is one, or undefined — nothing else reaches a URL. */
function isoDay(raw: string | undefined): string | undefined {
  return raw && ISO_DATE.test(raw) ? raw : undefined;
}

/** FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE: `<bdi dir="auto">` for plain text. */
const FSI = "\u2068";
const PDI = "\u2069";

/**
 * An instant the payload carries, in the one shape `new Date()` parses
 * everywhere. Rows written through to_jsonb(timestamptz) already are
 * ("2026-09-22T16:00:00+00:00"); a row an older trigger wrote with `::text`
 * ("2026-09-22 16:00:00+00") is a string Safari refuses, so its space becomes
 * the T and a bare "+00" gains its minutes. A plain date is left alone.
 */
export function isoInstant(raw: string): string {
  const s = raw.trim();
  if (!s.includes(" ")) return s;
  return s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
}

/**
 * `notifications.types.<type>` — a title and a body, and for a type whose
 * payload carries `kind`, one title per kind and, where a kind needs its own
 * sentence, one body per kind. `range`/`single` bodies are picked by whether
 * the payload spans days (a closure, a leave). Every part beyond title/body
 * is optional: a bundle that predates a kind falls back to the type's title.
 */
interface NotificationTemplate {
  title: string;
  body: string;
  kinds?: Record<string, string>;
  bodies?: Record<string, string>;
  parts?: DigestParts;
}

/** Where tapping a notification should land the reader. */
export function notificationHref(n: Pick<KgNotification, "type" | "data">, isParent: boolean): string {
  const d = n.data ?? {};
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : undefined);

  switch (n.type) {
    case "message":
      return s("threadId")
        ? isParent ? `/portal/messages/${s("threadId")}` : `/messages/${s("threadId")}`
        : isParent ? "/portal/messages" : "/messages";
    case "incident":
      return isParent ? "/portal" : s("incidentId") ? `/incidents/${s("incidentId")}` : "/incidents";
    case "announcement":
      return isParent ? "/portal/announcements" : "/announcements";
    // The calendar on the event's day with the event named in the query —
    // never /calendar/<id>. An event can be deleted (deleting a CLASS cascades
    // its events away) while the notification survives; a detail route would
    // 404 on exactly the alert a parent taps first, whereas the day view
    // opens, says the event is gone, and still shows the day. A row written
    // before the payload carried a date lands on the calendar itself.
    case "event": {
      const day = isoDay(s("date"));
      const event = s("eventId");
      if (isParent) {
        return day ? `/portal/calendar?date=${day}${event ? `&event=${event}` : ""}` : "/portal/calendar";
      }
      return day ? `/calendar?view=day&date=${day}${event ? `&event=${event}` : ""}` : "/calendar";
    }
    // A closure is a day, not a record: land on that day of the calendar.
    case "closure": {
      const day = isoDay(s("date"));
      if (isParent) return day ? `/portal/calendar?date=${day}` : "/portal/calendar";
      return day ? `/calendar?date=${day}` : "/calendar";
    }
    // Families only today (the therapist has the sessions screen); the staff
    // branch exists so a future therapist row lands on the appointment and
    // not on the dashboard.
    case "session_scheduled": {
      const day = isoDay(s("date"));
      if (isParent) return day ? `/portal/calendar?date=${day}` : "/portal/calendar";
      return s("sessionId") ? `/sessions/${s("sessionId")}` : "/sessions";
    }
    case "assessment_scheduled": {
      const day = isoDay(s("date"));
      if (isParent) return day ? `/portal/calendar?date=${day}` : "/portal/calendar";
      return s("assessmentId") ? `/learning/assessments/${s("assessmentId")}` : "/learning/assessments";
    }
    // The member's own request, decided: the leaves screen lists it with the answer.
    case "leave":
      return "/staff/leaves";
    case "application":
      // A parent's own application lands on their children, not on the office's
      // review queue — /applications is staff-only and would bounce them.
      if (isParent) return "/portal/children";
      return s("applicationId") ? `/applications/${s("applicationId")}` : "/applications";
    case "checkin":
    case "checkout":
      return isParent && s("childId") ? `/portal/children/${s("childId")}` : "/attendance";
    // The journal row lands on the DAY it tells about — the family on the
    // child's day page, the staff on the Journal screen of that date — so a
    // digest read on Sunday morning still opens Thursday. A row written before
    // the payload carried a date keeps the child's record.
    case "daily_report": {
      const date = isoDay(s("date"));
      if (isParent) {
        const child = s("childId");
        if (!child) return "/portal";
        return date ? `/portal/children/${child}/day/${date}` : `/portal/children/${child}`;
      }
      return date ? `/attendance/journal?date=${date}` : "/attendance";
    }
    case "attendance_flagged":
      return isParent && s("childId")
        ? `/portal/children/${s("childId")}?tab=attendance`
        : "/attendance";
    case "task":
      return "/tasks";
    case "payment_overdue":
      // Finance-only digest (0026 fans it out to owner/admin/accountant), so it
      // always lands on the arrears list — a parent is never a recipient.
      return "/billing/arrears";
    case "parent_update":
      // Staff-only: land on the child's record where the change now lives.
      return s("childId") ? `/children/${s("childId")}` : "/children";
    // ── Parent-only, from 0049 (plus consent_changed from 0045) ──────────
    // Each lands on the tab where the change actually lives. Sending a family
    // to the journal to read about a permission is how a notification stops
    // being worth opening.
    case "consent_changed":
    case "pickup_changed":
    case "guardian_access_changed":
      return s("childId") ? `/portal/children/${s("childId")}?tab=permissions` : "/portal";
    case "allergy_changed":
    case "health_changed":
      return s("childId") ? `/portal/children/${s("childId")}?tab=health` : "/portal";
    case "activity_decision":
      return s("childId") ? `/portal/children/${s("childId")}?tab=activities` : "/portal";
    case "session_published":
      return s("childId") ? `/portal/children/${s("childId")}?tab=journal` : "/portal";
    case "incident_updated":
      return isParent ? "/portal" : s("incidentId") ? `/incidents/${s("incidentId")}` : "/incidents";
    case "enrollment_changed":
      return "/portal/children";
    case "application_status":
      // The pending-requests list lives on the children page; an approved
      // application has become a real child card on the same page.
      return "/portal/children";
    case "invoice_issued":
    case "payment_recorded":
    case "payment_reversed":
    case "fee_changed":
      return "/portal/payments";
    case "activity_request":
      return s("childId") ? `/children/${s("childId")}` : "/activities";
    // The family lands on the child, whose card now says which structure; staff
    // land on the same child's record, where the transfer history lives.
    case "structure_changed":
      return s("childId")
        ? isParent ? `/portal/children/${s("childId")}` : `/children/${s("childId")}`
        : isParent ? "/portal/children" : "/children";
    // 0164 — a paper lands where it is reviewed or fixed. Staff open the
    // application while the file is pending and the child's Dossier tab once
    // it exists; the family opens the child's Dossier tab after approval and
    // its own pending file (/enroll/dossier, tenant-less: a first-time
    // applicant has no membership and /portal would bounce them) before.
    case "document_received":
    case "document_reviewed": {
      const child = s("childId");
      const application = s("applicationId");
      if (isParent) {
        if (n.type === "document_received") return "/portal";
        return child
          ? `/portal/children/${child}?tab=permissions`
          : application ? `/enroll/dossier/${application}` : "/portal/children";
      }
      return application ? `/applications/${application}` : child ? `/children/${child}?tab=documents` : "/applications";
    }
    default:
      return isParent ? "/portal" : "/dashboard";
  }
}

/**
 * Renders a notification's title/body for one locale.
 *
 * The database stores a structured `type` + `data`, never a rendered sentence,
 * so the same row can be read in Arabic by one parent and English by another.
 * `title`/`body` on the row are only a fallback for a type this build predates.
 */
export function renderNotification(
  n: Pick<KgNotification, "type" | "title" | "body" | "data">,
  messages: Record<string, unknown>,
  locale: Locale
): { title: string; body: string } {
  const m = messages as {
    types?: Record<string, NotificationTemplate>;
    // The daily journal digest: a mood is a word the reader's language picks.
    moods?: Record<string, string>;
    consentTypes?: Record<string, string>;
    consentStates?: Record<string, string>;
    // 0049 — every enum a payload can carry has a map here. Nothing that the
    // database wrote in one language is ever shown to a reader of another.
    actions?: Record<string, string>;
    allergySeverities?: Record<string, string>;
    healthFields?: Record<string, string>;
    incidentFields?: Record<string, string>;
    enrollmentStates?: Record<string, string>;
    applicationStatuses?: Record<string, string>;
    attendanceStatuses?: Record<string, string>;
    activityStates?: Record<string, string>;
    paymentMethods?: Record<string, string>;
    // 0159 — the calendar's enums: a therapy type, a test-or-exam, a leave type.
    sessionTypes?: Record<string, string>;
    assessmentKinds?: Record<string, string>;
    leaveTypes?: Record<string, string>;
  };
  const types = m.types;
  const tpl = types?.[n.type];
  if (!tpl) return { title: n.title, body: n.body ?? "" };

  const d = (n.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const tag = intlLocale(locale);

  // A clock, from an instant the payload carries. `time` is a timestamptz in
  // jsonb (the 0097 shape, ISO 8601 with an offset) or '' for an all-day row;
  // `at` is the older key the arrival rows still use. Formatted in Algiers,
  // never in the reader's device zone.
  const clock = (iso: string) =>
    iso
      ? new Intl.DateTimeFormat(tag, {
          hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Algiers",
        }).format(new Date(isoInstant(iso)))
      : "";
  const time = clock(str("time") || str("at"));
  const endTime = clock(str("endTime"));

  // Money is rendered here, not in SQL: the digest row carries a raw `amount`,
  // so an Arabic reader gets "12 000 دج" and a French one "12 000 DA" from the
  // same row. `title` (the amount the database pre-formatted) is the fallback
  // for a row written before this build.
  const rawAmount =
    typeof d.amount === "number"
      ? d.amount
      : typeof d.amount === "string" && d.amount.trim() !== ""
        ? Number(d.amount)
        : NaN;
  const amount = Number.isFinite(rawAmount) ? formatDZD(rawAmount, locale) : n.title;

  // A date the payload names (a due date, the day a child was absent). Rendered
  // from the event's own date, never from when the row happened to be written:
  // an evening push about a morning absence is worth nothing to a parent.
  const dayOf = (raw: string) =>
    raw
      ? new Intl.DateTimeFormat(tag, {
          day: "numeric", month: "long", timeZone: "Africa/Algiers",
        }).format(new Date(isoInstant(raw)))
      : "";
  const rawDate = str("date") || str("due");
  const rawEndDate = str("endDate");
  const date = dayOf(rawDate);
  // The last day of a closure or a leave; '' when the row is one day long,
  // so a range template is only picked when there is a range to say.
  const endDate = rawEndDate && rawEndDate !== rawDate ? dayOf(rawEndDate) : "";

  // Changed fields arrive as an array of NAMES. Translating each and joining
  // with the locale's own list separator is the whole reason SQL never builds
  // this sentence: "medications and allergies" and "الأدوية والحساسية" do not
  // share a word order.
  const fieldMap = n.type === "incident_updated" ? m.incidentFields : m.healthFields;
  const rawFields = Array.isArray(d.fields) ? (d.fields as unknown[]) : [];
  const fields = listFormat(locale)
    .format(rawFields.filter((f): f is string => typeof f === "string")
      .map((f) => fieldMap?.[f] ?? f));

  const previousRaw = typeof d.previousAmount === "number" ? d.previousAmount : NaN;

  // The row's own title is person-typed text — an event's name, a holiday's,
  // a member's — dropped into a sentence written in the reader's language.
  // Isolating it (FSI … PDI, the bidi equivalent of <bdi dir="auto">) keeps
  // "Nouvel événement — اجتماع الأولياء" from pulling the dash and the French
  // words into the Arabic run in a push banner, where there is no markup.
  // A closure's name is stored in both scripts and picked by locale; so is a
  // requirement's (0164): the register names the paper in French and Arabic,
  // and "وثيقة مرفوضة — شهادة الميلاد" must not read "— Extrait de naissance".
  const bilingualName = n.type === "closure" || n.type === "document_received" || n.type === "document_reviewed";
  const ownName = bilingualName ? (locale === "ar" && str("nameAr")) || str("name") || n.title : n.title;
  const name = ownName ? `${FSI}${ownName}${PDI}` : "";

  const vars: Record<string, string> = {
    // A child is named in both scripts on the record; a payload that carries
    // the Arabic name (`childNameAr`) shows it to an Arabic reader, so the row
    // above "آدم عمراني" reads "يوميات آدم عمراني", never "يوميات Adam Amrani".
    // A payload written before the sender carried it keeps the Latin name,
    // the same fallback className and structure below already use.
    child: (locale === "ar" && str("childNameAr")) || str("childName"),
    activity: str("activityName"),
    name,
    text: n.body ?? "",
    time,
    endTime,
    date,
    endDate,
    count: typeof d.count === "number" ? String(d.count) : str("count"),
    amount,
    previousAmount: Number.isFinite(previousRaw) ? formatDZD(previousRaw, locale) : "",
    fields,
    // Consent notifications carry the type and the decision as data, never as
    // a sentence, so the family reads them in their own language.
    consent: m.consentTypes?.[str("consentType")] ?? str("consentType"),
    state: m.consentStates?.[str("state")] ?? str("state"),
    // 0049 payloads. Each is an enum the database wrote; each is looked up.
    action: m.actions?.[str("action")] ?? str("action"),
    person: str("person"),
    allergen: str("allergen"),
    severity: m.allergySeverities?.[str("severity")] ?? str("severity"),
    status:
      n.type === "application_status"
        ? (m.applicationStatuses?.[str("status")] ?? str("status"))
        : n.type === "enrollment_changed"
        ? (m.enrollmentStates?.[str("status")] ?? str("status"))
        : n.type === "attendance_flagged"
          ? (m.attendanceStatuses?.[str("status")] ?? str("status"))
          : (m.activityStates?.[str("status")] ?? str("status")),
    method: m.paymentMethods?.[str("method")] ?? str("method"),
    receipt: str("receipt"),
    invoiceNo: str("invoiceNo"),
    plan: str("plan"),
    reason: str("reason"),
    // Which class a trip belongs to. A guardian with children in two classes
    // otherwise reads two identical-looking rows. A payload that carries the
    // Arabic name too (structure_changed does) shows it to an Arabic reader.
    className: (locale === "ar" && str("classNameAr")) || str("className"),
    // What the event actually is. Staff type it; until now nobody read it.
    description: str("description"),
    // Which structure a child now belongs to (0140), or which one a closure
    // shuts (0159; '' for the whole building). The payload carries both
    // scripts because a structure is named by the director in both; an Arabic
    // reader gets the Arabic name when there is one and the French otherwise —
    // never a blank.
    structure: (locale === "ar" && str("structureNameAr")) || str("structureName"),
    // 0159 — where an event or an appointment takes place, printed once from
    // the stored name (never "Salle Salle 3"); '' when no room is booked, and
    // the separator collapse below swallows the empty segment.
    room: (locale === "ar" && str("roomNameAr")) || str("roomName"),
    // 0159 — the calendar's enums, each a word the reader's language picks.
    sessionType: m.sessionTypes?.[str("sessionType")] ?? str("sessionType"),
    therapist: str("therapist"),
    assessmentKind: m.assessmentKinds?.[str("assessmentKind")] ?? str("assessmentKind"),
    leaveType: m.leaveTypes?.[str("leaveType")] ?? str("leaveType"),
  };
  // A template is a plain `{var}` substitution with no conditionals, so an
  // absent value used to leave its separator behind — "3 September · 09:00 · "
  // for an event with no class. Collapse the empty segments instead of writing
  // a different template for every combination that can be missing: the
  // filled line is cut at its separators, the blank pieces dropped, the rest
  // joined again. (The earlier regex pass ate the space before a dot when two
  // neighbouring segments were both empty — an all-day event with no room
  // read "23 septembre· 1re année".)
  const fill = (s: string) =>
    s
      .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "")
      .split(/\s*·\s*/)
      .map((part) => part.replace(/\s{2,}/g, " ").trim())
      .filter(Boolean)
      .join(" · ");
  // What happened decides the title: a payload with `kind` (an event created,
  // changed, removed, cancelled or reminded; a closure confirmed; an
  // appointment rescheduled; a leave approved) reads that kind's title, and
  // its own body where the kind has one ("will not take place"). A row that
  // spans days reads the range body when the type has one. Everything falls
  // back to the type's plain title and body, so a bundle that predates a kind
  // still says something true.
  const kind = str("kind");
  const titleTpl = (kind && tpl.kinds?.[kind]) || tpl.title;
  const bodyTpl =
    (kind && tpl.bodies?.[kind]) ||
    (endDate ? tpl.bodies?.range : tpl.bodies?.single) ||
    tpl.body;
  // The automatic daily journal (0152) carries counts and enums, never a
  // sentence; its body is assembled here from flat keys, one part per fact,
  // in the order the child's day page lays its sections out. A row the
  // educator published by hand (`source: 'journal'`) and every row written
  // before the sender existed keep the template body.
  if (n.type === "daily_report" && d.source === "digest") {
    const body = digestParts(d, tpl.parts, m.moods, locale).join(" · ");
    return { title: fill(titleTpl).trim(), body: fill(body).trim() };
  }
  return { title: fill(titleTpl).trim(), body: fill(bodyTpl).trim() };
}

/** The six CLDR categories, all present in every locale (the merge script
 *  enforces key parity; fr and en repeat `other`). */
type PluralForms = Record<"zero" | "one" | "two" | "few" | "many" | "other", string>;

/** `notifications.types.daily_report.parts` — see messages/_pending or the
 *  merged notifications.json. Optional throughout: a reader whose bundle
 *  predates the keys gets a shorter row, never a crash. */
interface DigestParts {
  arrived?: string;
  lessons?: Partial<Record<"academic" | "therapy" | "other", Partial<PluralForms>>>;
  menu?: string;
  eaten?: Partial<Record<"all" | "half" | "little" | "none", string>>;
  nap?: string;
  noNap?: string;
  photos?: Partial<PluralForms>;
  incidents?: Partial<PluralForms>;
}

/**
 * The digest body, part by part, in the profile's section order (D7/D15).
 *
 * Plurals go through Intl.PluralRules rather than ICU: the payload is a
 * handful of integers, and Arabic needs its dual and its 3–10 form for
 * "حصتان" and "3 حصص" — categories a `{n} x` template cannot express. A part
 * is rendered only when its fact exists, so `zero` is never read and a day
 * with no nap recorded says nothing about naps. Arrival and incidents were
 * pushed the moment they happened; here they are context, and incidents come
 * last so a serious one is the word the eye stops on.
 */
function digestParts(
  d: Record<string, unknown>,
  parts: DigestParts | undefined,
  moods: Record<string, string> | undefined,
  locale: Locale
): string[] {
  if (!parts) return [];
  const profile = toLearningProfile(d.profile);
  const rules = new Intl.PluralRules(intlLocale(locale));
  const num = (k: string): number => {
    const v = d[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : NaN;
  };
  const text = (k: string): string | null => (typeof d[k] === "string" ? (d[k] as string) : null);
  const counted = (forms: Partial<PluralForms> | undefined, n: number): string | null => {
    const s = forms?.[rules.select(n) as keyof PluralForms] ?? forms?.other;
    return s ? s.replace("{n}", String(n)) : null;
  };
  const eatsHere = profile === "care" || profile === "development" || profile === "activities";

  const out: string[] = [];
  const push = (s: string | null | undefined) => { if (s) out.push(s); };
  for (const section of sectionsFor(profile)) {
    switch (section) {
      case "presence": {
        const arrivedAt = text("arrivedAt");
        if (arrivedAt && parts.arrived) push(parts.arrived.replace("{time}", formatTime(arrivedAt, locale)));
        break;
      }
      case "blocks": {
        const n = num("lessons");
        if (n > 0) push(counted(parts.lessons?.[blocksNounKey(profile)], n));
        break;
      }
      case "meals": {
        const eaten = text("eaten");
        if (eatsHere && eaten && parts.eaten?.[eaten as keyof NonNullable<DigestParts["eaten"]>]) {
          push(parts.eaten[eaten as keyof NonNullable<DigestParts["eaten"]>]);
        } else if (d.menu === true || d.menu === "true") {
          push(parts.menu);
        }
        break;
      }
      case "napMood": {
        const nap = num("napMinutes");
        if (nap > 0 && parts.nap) push(parts.nap.replace("{min}", String(nap)));
        else if (nap === 0) push(parts.noNap);
        const mood = text("mood");
        if (mood) push(moods?.[mood]);
        break;
      }
      case "photos": {
        const n = num("photos");
        if (n > 0) push(counted(parts.photos, n));
        break;
      }
      case "incidents": {
        const n = num("incidents");
        if (n > 0) push(counted(parts.incidents, n));
        break;
      }
      // Sessions and the educator's notes are text the payload never carries.
      default:
        break;
    }
  }
  return out;
}
