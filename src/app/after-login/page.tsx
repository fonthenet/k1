import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";

/**
 * Where you land after signing in, decided by who you are.
 *
 * The login form used to push everyone to /dashboard. Staff belong there;
 * a parent does not, and only got to their portal because /dashboard's
 * requireStaff() bounced them. That worked, but it meant a parent's first
 * navigation after logging in was to a staff URL — it sits in their history,
 * it is the page that flashes if the bounce is ever slow, and it makes
 * "parents can't reach their portal" a plausible bug report the day someone
 * changes that guard.
 *
 * Nothing renders here. getTenantContext() already handles the two cases this
 * page cannot: no session sends you back to /login, and no membership yet —
 * a parent whose enrolment request has not been approved — sends you to
 * /onboarding, which is where their pending file is explained.
 */
export default async function AfterLoginPage() {
  const ctx = await getTenantContext();
  redirect(ctx.isStaff ? "/dashboard" : "/portal");
}
