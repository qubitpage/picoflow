"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/session";

const SELLER_BASE = process.env.SELLER_BASE ?? "http://sellers:3030";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export type AuthFormState = { error?: string } | undefined;

export async function signupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const org_name = String(formData.get("org_name") ?? "").trim();
  if (!email || !password) return { error: "Email and password are required." };

  let r: Response;
  try {
    r = await fetch(`${SELLER_BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, org_name }),
      cache: "no-store",
    });
  } catch (err) {
    return { error: `Could not reach the seller API: ${(err as Error).message}` };
  }
  const j = (await r.json().catch(() => ({}))) as { session?: string; ttl_sec?: number; error?: string };
  if (!r.ok || !j.session) return { error: j.error ?? `Signup failed (${r.status}).` };

  const c = await cookies();
  c.set(SESSION_COOKIE, j.session, { ...COOKIE_OPTS, maxAge: j.ttl_sec ?? 60 * 60 * 24 * 14 });
  redirect("/account");
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  let r: Response;
  try {
    r = await fetch(`${SELLER_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch (err) {
    return { error: `Could not reach the seller API: ${(err as Error).message}` };
  }
  const j = (await r.json().catch(() => ({}))) as { session?: string; ttl_sec?: number; error?: string };
  if (!r.ok || !j.session) return { error: j.error ?? `Login failed (${r.status}).` };

  const c = await cookies();
  c.set(SESSION_COOKIE, j.session, { ...COOKIE_OPTS, maxAge: j.ttl_sec ?? 60 * 60 * 24 * 14 });
  redirect("/account");
}

export async function logoutAction(): Promise<void> {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
  redirect("/");
}
