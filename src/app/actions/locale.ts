"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Switches the UI language, and remembers it on the account.
 *
 * The cookie is what next-intl reads, but the push dispatcher (0013/0075)
 * reads kg_profiles.locale — and until now nothing ever wrote that column
 * except the two profile forms, so every account sat on the schema default
 * and an Arabic-speaking family with a phone would have received its alerts
 * in French. Every language switcher in the product calls this action, so
 * this is the one place the two can be kept in step.
 *
 * An upsert, not an update: a person who has just signed up and switches
 * the language before creating or joining a crèche has no profile row yet
 * (profiles are born in kg_bootstrap_profile), and an UPDATE would match
 * nothing and lose the choice. pr_ins/pr_upd restrict both halves to the
 * caller's own row, and kg_bootstrap_profile later fills name and phone
 * around it without touching locale. A visitor with no session (landing
 * page, enrolment link) simply gets the cookie. A write failure is
 * deliberately not surfaced: the switch itself must never fail because the
 * profile row could not be touched.
 *
 * `remember: false` is for shared surfaces. The kiosk tablet's language
 * toggle is for whoever is standing at the door, not for the staff account
 * signed in on it — persisting that choice would flip the director's
 * notification language every time a parent tapped العربية.
 */
export async function setLocale(
  locale: "ar" | "en" | "fr",
  opts: { remember?: boolean } = {}
) {
  const cookieStore = await cookies();
  cookieStore.set("kg-locale", locale, { maxAge: 60 * 60 * 24 * 365, path: "/" });

  if (opts.remember !== false) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("kg_profiles")
        .upsert({ id: user.id, locale }, { onConflict: "id" });
    }
  }

  revalidatePath("/", "layout");
}

export async function setActiveTenant(tenantId: string) {
  const cookieStore = await cookies();
  cookieStore.set("kg-tenant", tenantId, { maxAge: 60 * 60 * 24 * 365, path: "/" });
  revalidatePath("/", "layout");
}
