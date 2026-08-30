import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSessionOnly, toSessionCookie } from "@/lib/supabase/session-preference";
import { missingSupabaseEnv } from "@/lib/env";

const PROTECTED_PREFIXES = [
  "/dashboard", "/children", "/applications", "/attendance", "/staff",
  "/billing", "/accounting", "/classes", "/activities", "/announcements",
  "/messages", "/calendar", "/menus", "/reports", "/settings", "/portal",
  "/kiosk", "/onboarding", "/incidents", "/sessions", "/tasks",
  "/notifications", "/after-login", "/my-pay",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  // Configuration is missing. This used to throw from inside @supabase/ssr,
  // and because middleware runs on EVERY route it took down the landing page
  // and the login page too — pages that need no database at all — surfacing as
  // MIDDLEWARE_INVOCATION_FAILED with nothing naming the cause.
  //
  // Fail closed where it matters and open where it does not: a protected route
  // is refused outright, because with no Supabase we cannot establish who
  // anyone is and must never wave them through. Everything public still
  // renders, so a misconfigured deployment shows its front door and one
  // legible message instead of a blanket 500.
  const missing = missingSupabaseEnv();
  if (missing.length > 0) {
    console.error(
      `[middleware] Supabase is not configured: ${missing.join(", ")} missing. ` +
        `Protected routes are refused until set.`
    );
    if (!isProtected) return NextResponse.next({ request });
    return new NextResponse(
      `This deployment is not configured yet: ${missing.join(", ")} missing.`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          // On a shared device the token refresh must not quietly restore a
          // year-long cookie the user opted out of.
          const sessionOnly = isSessionOnly((n) => request.cookies.get(n)?.value);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, sessionOnly ? toSessionCookie(options) : options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
