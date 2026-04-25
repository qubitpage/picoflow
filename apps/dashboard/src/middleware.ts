import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/admin", "/console", "/settings"];
const SESSION_COOKIE = "pf_session";

/**
 * Edge gate: any request to /admin /console /settings must carry either
 *   (a) a `pf_session` cookie (the page-level `requireRole()` then enforces
 *       the actual role and redirects non-admins to /login), or
 *   (b) HTTP Basic credentials matching DASHBOARD_ADMIN_USER/PASSWORD.
 *
 * Without either, redirect to /login with a `reason` hint. This makes the
 * dashboard navigable from a browser using the seeded role accounts (no
 * Basic-Auth popup), while keeping curl/CI access via Basic intact.
 */
function redirectToLogin(req: NextRequest, reason: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.next();
  }

  if (process.env.PICOFLOW_OPEN_FRONTEND_ADMIN === "true" && process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  // Session cookie path: let the page-level role guard decide.
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (session) return NextResponse.next();

  // Optional Basic-Auth fallback (kept for ops/CI scripts).
  const expectedUser = process.env.DASHBOARD_ADMIN_USER;
  const expectedPass = process.env.DASHBOARD_ADMIN_PASSWORD;
  const auth = req.headers.get("authorization");
  if (expectedUser && expectedPass && auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice("Basic ".length));
      const sep = decoded.indexOf(":");
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (user === expectedUser && pass === expectedPass) return NextResponse.next();
    } catch {
      /* fall through to redirect */
    }
  }

  return redirectToLogin(req, pathname.startsWith("/admin") ? "admin_only" : "seller_only");
}

export const config = {
  matcher: ["/admin/:path*", "/console/:path*", "/settings/:path*"],
};
