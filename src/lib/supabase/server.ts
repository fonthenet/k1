import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isSessionOnly, toSessionCookie } from "@/lib/supabase/session-preference";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
