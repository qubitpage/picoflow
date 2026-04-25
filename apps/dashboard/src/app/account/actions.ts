"use server";

import { revalidatePath } from "next/cache";
import { sellerFetchAuthed } from "@/lib/session";

export type MintResult = { full_key?: string; key_id?: string; error?: string } | undefined;

export async function mintKeyAction(_prev: MintResult, formData: FormData): Promise<MintResult> {
  const label = String(formData.get("label") ?? "default").trim() || "default";
  let r: Response;
  try {
    r = await sellerFetchAuthed("/api/me/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
  } catch (err) {
    return { error: `Could not reach the seller API: ${(err as Error).message}` };
  }
  const j = (await r.json().catch(() => ({}))) as { full_key?: string; key_id?: string; error?: string };
  if (!r.ok || !j.full_key) return { error: j.error ?? `Mint failed (${r.status})` };
  revalidatePath("/account");
  return { full_key: j.full_key, key_id: j.key_id };
}

export async function revokeKeyAction(formData: FormData): Promise<void> {
  const key_id = String(formData.get("key_id") ?? "");
  if (!key_id) return;
  await sellerFetchAuthed(`/api/me/keys/${encodeURIComponent(key_id)}/revoke`, { method: "POST" });
  revalidatePath("/account");
}
