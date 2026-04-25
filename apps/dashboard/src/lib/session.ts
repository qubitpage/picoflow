import { cookies } from "next/headers";

export const SESSION_COOKIE = "pf_session";

const SELLER_BASE = process.env.SELLER_BASE ?? "http://sellers:3030";

export type CurrentUser = {
  user_id: string;
  org_id: string;
  email: string;
  org_name: string;
  role: string;
};

/** Server-side: read the cookie, ask the seller who it belongs to. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const r = await fetch(`${SELLER_BASE}/api/auth/me`, {
      method: "GET",
      headers: { "x-pf-session": token },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { user?: CurrentUser };
    return j.user ?? null;
  } catch {
    return null;
  }
}

/** Server-side: forward an arbitrary request to the seller carrying the session. */
export async function sellerFetchAuthed(path: string, init: RequestInit = {}): Promise<Response> {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value ?? "";
  const headers = new Headers(init.headers);
  if (token) headers.set("x-pf-session", token);
  return fetch(`${SELLER_BASE}${path}`, { ...init, headers, cache: "no-store" });
}

/**
 * Role hierarchy: admin > seller > public. `requireRole("seller")` allows
 * both sellers and admins. Returns the user when allowed, null when not (the
 * caller is responsible for redirecting / rendering the 403 view).
 */
export async function requireRole(min: "admin" | "seller" | "public"): Promise<CurrentUser | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const rank: Record<string, number> = { public: 1, seller: 2, owner: 2, admin: 3 };
  const have = rank[u.role] ?? 0;
  const need = rank[min] ?? 99;
  return have >= need ? u : null;
}
