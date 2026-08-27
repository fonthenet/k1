import { createBrowserClient } from "@supabase/ssr";
import { isSessionOnly, REMEMBER_COOKIE } from "./session-preference";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];
}

/** Records the choice made on the sign-in form, before the session is created. */
export function setRememberPreference(remember: boolean) {
  // The marker itself is a session cookie: on a shared device nothing about
  // this visit should outlive the browser.
  document.cookie = remember
    ? `${REMEMBER_COOKIE}=; Max-Age=0; path=/`
    : `${REMEMBER_COOKIE}=0; path=/; SameSite=Lax`;
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Supabase defaults to a ~400-day cookie. When the user has said this is a
    // shared device, drop the lifetime so the session ends with the browser.
    isSessionOnly(readCookie)
      ? { cookieOptions: { maxAge: undefined } }
      : undefined
  );
}
