/**
 * Shared Vultr API helpers — READ-ONLY base.
 *
 * This module deliberately exposes ONLY GET helpers and a guarded `safePost`
 * wrapper. Destructive verbs (DELETE / halt / reinstall) are NOT exported and
 * are explicitly forbidden — see the safety guards below.
 *
 * Per user directive (April 2026):
 *   "make sure you dont delete any instance in vultr"
 */

const VULTR_BASE = "https://api.vultr.com/v2";

export interface VultrInstance {
  id: string;
  os: string;
  ram: number;
  disk: number;
  main_ip: string;
  v6_main_ip?: string;
  vcpu_count: number;
  region: string;
  plan: string;
  date_created: string;
  status: string;
  power_status: string;
  server_status: string;
  hostname: string;
  label: string;
  tags?: string[];
}

export interface VultrPlan {
  id: string;
  vcpu_count: number;
  ram: number;
  disk: number;
  bandwidth: number;
  monthly_cost: number;
  type: string;
  locations: string[];
}

export interface VultrOs {
  id: number;
  name: string;
  arch: string;
  family: string;
}

export interface VultrSshKey {
  id: string;
  name: string;
  ssh_key: string;
  date_created: string;
}

/**
 * Hard-coded protected labels/tags. Any instance matching any of these is
 * treated as untouchable and is filtered out of every code path that could
 * possibly issue a mutating call.
 */
export const PROTECTED_TAG_SUBSTRINGS = [
  "do-not-delete",
  "carphacom",
  "beta",
  "live.qubitpage",
  "qubitstream",
  "demo",
  "federation-test",
  "tv",
  "streaming",
];
export const PROTECTED_LABEL_SUBSTRINGS = [
  "carphacom",
  "beta",
  "live.qubitpage",
  "qubitstream",
  "demo-qubitpage",
  "nordic-qubitpage",
  "sentinel-platform",
  "aios",
];

export function isProtectedInstance(inst: VultrInstance): boolean {
  const label = (inst.label ?? "").toLowerCase();
  const host = (inst.hostname ?? "").toLowerCase();
  if (PROTECTED_LABEL_SUBSTRINGS.some((p) => label.includes(p) || host.includes(p))) return true;
  const tags = (inst.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => PROTECTED_TAG_SUBSTRINGS.some((p) => t.includes(p)))) return true;
  return false;
}

function getKey(): string {
  const key = process.env.VULTR_API_KEY;
  if (!key) throw new Error("VULTR_API_KEY is not set in environment");
  return key;
}

async function vultrFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getKey()}`,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  return fetch(`${VULTR_BASE}${path}`, { ...init, headers });
}

export async function vultrGet<T = unknown>(path: string): Promise<T> {
  const res = await vultrFetch(path, { method: "GET" });
  if (!res.ok) throw new Error(`Vultr GET ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * Guarded POST. Refuses any path that contains destructive verbs.
 */
export async function safePost<T = unknown>(path: string, body: unknown): Promise<T> {
  const lower = path.toLowerCase();
  const banned = ["/halt", "/reinstall", "/destroy", "/restore"];
  if (banned.some((b) => lower.includes(b))) {
    throw new Error(`SAFETY: refusing destructive POST to ${path}`);
  }
  const res = await vultrFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Vultr POST ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function listInstances(): Promise<VultrInstance[]> {
  const data = await vultrGet<{ instances: VultrInstance[] }>("/instances?per_page=500");
  return data.instances ?? [];
}

export async function listPlans(): Promise<VultrPlan[]> {
  const data = await vultrGet<{ plans: VultrPlan[] }>("/plans?per_page=500");
  return data.plans ?? [];
}

export async function listOs(): Promise<VultrOs[]> {
  const data = await vultrGet<{ os: VultrOs[] }>("/os?per_page=500");
  return data.os ?? [];
}

export async function listSshKeys(): Promise<VultrSshKey[]> {
  const data = await vultrGet<{ ssh_keys: VultrSshKey[] }>("/ssh-keys?per_page=500");
  return data.ssh_keys ?? [];
}

export async function getInstance(id: string): Promise<VultrInstance> {
  const data = await vultrGet<{ instance: VultrInstance }>(`/instances/${id}`);
  return data.instance;
}
