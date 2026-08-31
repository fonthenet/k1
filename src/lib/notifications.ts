import { formatDZD } from "@/lib/format";
import type { Locale } from "@/i18n/request";

/** Every event the platform can notify about. Keep in sync with the DB triggers
 *  in supabase/migrations/0012_kg_notifications.sql and 0049_kg_parent_notifications.sql. */
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
  "event",
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
    // A LIST, never /calendar/<id>. An event can be deleted — and deleting a
    // CLASS cascades its events away — while the notification survives, so a
    // detail route would 404 on exactly the alert a parent taps first. The
    // parent's "Coming up" lives on the portal home; staff have the calendar.
    case "event":
      return isParent ? "/portal" : "/calendar";
    case "application":
      // A parent's own application lands on their children, not on the office's
      // review queue — /applications is staff-only and would bounce them.
      if (isParent) return "/portal/children";
      return s("applicationId") ? `/applications/${s("applicationId")}` : "/applications";
    case "checkin":
    case "checkout":
    case "daily_report":
      return isParent && s("childId") ? `/portal/children/${s("childId")}` : "/attendance";
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
    types?: Record<string, { title: string; body: string }>;
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
  };
  const types = m.types;
  const tpl = types?.[n.type];
  if (!tpl) return { title: n.title, body: n.body ?? "" };

  const d = (n.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");

  const at = str("time") || str("at");
  const time = at
    ? new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : locale === "en" ? "en-GB" : "fr-DZ", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Algiers",
      }).format(new Date(at))
    : "";

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
  const intlLocale = locale === "ar" ? "ar-DZ" : locale === "en" ? "en-GB" : "fr-DZ";
  const rawDate = str("date") || str("due");
  const date = rawDate
    ? new Intl.DateTimeFormat(intlLocale, {
        day: "numeric", month: "long", timeZone: "Africa/Algiers",
      }).format(new Date(rawDate))
    : "";

  // Changed fields arrive as an array of NAMES. Translating each and joining
  // with the locale's own list separator is the whole reason SQL never builds
  // this sentence: "medications and allergies" and "الأدوية والحساسية" do not
  // share a word order.
  const fieldMap = n.type === "incident_updated" ? m.incidentFields : m.healthFields;
  const rawFields = Array.isArray(d.fields) ? (d.fields as unknown[]) : [];
  const fields = new Intl.ListFormat(intlLocale, { style: "long", type: "conjunction" })
    .format(rawFields.filter((f): f is string => typeof f === "string")
      .map((f) => fieldMap?.[f] ?? f));

  const previousRaw = typeof d.previousAmount === "number" ? d.previousAmount : NaN;

  const vars: Record<string, string> = {
    child: str("childName"),
    activity: str("activityName"),
    name: n.title,
    text: n.body ?? "",
    time,
    date,
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
    // otherwise reads two identical-looking rows.
    className: str("className"),
    // What the event actually is. Staff type it; until now nobody read it.
    description: str("description"),
  };
  // A template is a plain `{var}` substitution with no conditionals, so an
  // absent value used to leave its separator behind — "3 September · 09:00 · "
  // for an event with no class. Collapse the empty segments instead of writing
  // a different template for every combination that can be missing.
  const fill = (s: string) =>
    s
      .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "")
      .replace(/\s*·\s*(?=·)/g, "")
      .replace(/^\s*·\s*|\s*·\s*$/g, "")
      .replace(/\s{2,}/g, " ");
  return { title: fill(tpl.title).trim(), body: fill(tpl.body).trim() };
}
