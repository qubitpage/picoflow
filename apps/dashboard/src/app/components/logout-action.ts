"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/session";

export async function dashboardLogout(): Promise<void> {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
  redirect("/login");
}
