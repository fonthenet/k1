import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isSessionOnly, toSessionCookie } from "@/lib/supabase/session-preference";
import { requireSupabaseEnv } from "@/lib/env";

export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            const sessionOnly = isSessionOnly((n) => cookieStore.get(n)?.value);
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, sessionOnly ? toSessionCookie(options) : options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes sessions.
          }
        },
      },
    }
  );
}
