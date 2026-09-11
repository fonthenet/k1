import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// Defined in ./locales so client components can import them too — see the note
// there. Re-exported here because most of the app already imports them from
// this module.
export { LOCALES, DEFAULT_LOCALE, type Locale } from "./locales";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./locales";

// Each module owns its namespace file in messages/{locale}/{ns}.json.
const NAMESPACES = [
  "common", "notifications", "landing", "landingFeatures", "landingCta", "auth", "dashboard", "reports", "children", "enroll",
  "attendance", "staff", "billing", "accounting", "classes", "activities",
  "comms", "portal", "settings", "kiosk", "sessions", "tasks", "credentials", "platform", "support", "weather", "learning", "scheduler",
];

export default getRequestConfig(async ({ requestLocale }) => {
  // An EXPLICIT locale wins over the cookie.
  //
  // This used to ignore its argument and always read the cookie, so
  // `getTranslations({ locale: "ar" })` quietly returned whatever language the
  // reader happened to be in. Two places ask for a specific language and both
  // were silently broken by it: the payslip, which Algerian administrative
  // practice requires to carry French AND Arabic on one sheet and which was
  // printing the same language twice, and the founder wizard naming a new
  // establishment's structures in both.
  //
  // Nothing else changes: every ordinary render passes no locale, falls
  // through to the cookie, and behaves exactly as before.
  const asked = await requestLocale;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("kg-locale")?.value;
  const locale: Locale = LOCALES.includes(asked as Locale)
    ? (asked as Locale)
    : LOCALES.includes(cookieLocale as Locale)
      ? (cookieLocale as Locale)
      : DEFAULT_LOCALE;

  const messages: Record<string, unknown> = {};
  for (const ns of NAMESPACES) {
    try {
      messages[ns] = (await import(`../../messages/${locale}/${ns}.json`)).default;
    } catch {
      // namespace not written yet — fine
    }
  }
  return { locale, messages };
});
