import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSessionOnly, toSessionCookie } from "@/lib/supabase/session-preference";

const PROTECTED_PREFIXES = [
  "/dashboard", "/children", "/applications", "/attendance", "/staff",
  "/billing", "/accounting", "/classes", "/activities", "/announcements",
  "/messages", "/calendar", "/menus", "/reports", "/settings", "/portal",
  "/kiosk", "/onboarding", "/incidents", "/sessions", "/tasks",
  "/notifications",
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

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
