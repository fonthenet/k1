/**
 * The configuration the app cannot run without, checked in one place.
 *
 * These were read as `process.env.NEXT_PUBLIC_SUPABASE_URL!` at three call
 * sites — the non-null assertion silences TypeScript but does nothing at
 * runtime, so a missing variable reached `createServerClient(undefined, …)`
 * and threw from inside a library. In middleware that surfaces as
 * MIDDLEWARE_INVOCATION_FAILED on every route, with nothing anywhere naming
 * the actual cause.
 *
 * Read at module scope on purpose: Next inlines `process.env.NEXT_PUBLIC_*`
 * at build time only where it appears as a static expression.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** The Supabase variables that are absent. Empty array means we are configured. */
export function missingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return missing;
}

export function isSupabaseConfigured(): boolean {
  return missingSupabaseEnv().length === 0;
}

/**
 * The Supabase connection, or an error that says exactly which variable is
 * missing and where to set it. Anything that talks to the database goes
 * through here, so a misconfigured deployment reports itself in one sentence
 * instead of as a stack trace from inside @supabase/ssr.
 */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const missing = missingSupabaseEnv();
  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured: ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } missing. Set ${missing.length === 1 ? "it" : "them"} in .env.local for ` +
        `local development, or in the hosting provider's environment variables ` +
        `for a deployment. The app cannot authenticate anyone without ${
          missing.length === 1 ? "it" : "them"
        }.`
    );
  }
  return { url: SUPABASE_URL as string, anonKey: SUPABASE_ANON_KEY as string };
}
