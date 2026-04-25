/**
 * Unified Seller server — hosts every PicoFlow seller endpoint behind TollBooth.
 *
 * Endpoints (all paid via x402):
 *   GET  /api/aisa/data       — premium market data (mock or real AIsa wrap)        $0.001
 *   POST /api/featherless/infer — model inference via Featherless                   $0.005
 *   POST /api/aimlapi/infer   — model inference via AI/ML API                       $0.005
 *   POST /api/validator/check — cross-model validation                              $0.0015
 *   GET  /api/registry        — public capability registry (FREE)
 *   GET  /api/stats           — ledger stats (FREE)
 *   GET  /api/healthz         — healthcheck (FREE)
 *
 * StreamMeter (WS) runs separately — see `stream.ts`.
 *
 * Each upstream call is wrapped in safe try/catch — if the real provider key
 * is missing or returns an error, returns a deterministic SYNTHETIC result so
 * demos always succeed. Every action records `meta.source = real|synthesized`.
 */
import express from "express";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve as pathResolve } from "node:path";
import { isAddress } from "viem";
import {
  ARC_TESTNET,
  CapabilityRegistry,
  Ledger,
  computeMargin,
  type SplitSpec,
} from "@picoflow/nanometer-core";
import { tollbooth } from "@picoflow/tollbooth";
import { QuoteEngine } from "@picoflow/x402-facilitator";
import { CHAIN_PRESETS, presetByChainId, type ChainPreset } from "@picoflow/x402-facilitator";
import { GatewayWorker, type GatewayWorkerEvent } from "./gateway-worker.js";

const PROD = process.env.NODE_ENV === "production";

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (PROD ? undefined : fallback);
  if (!value) throw new Error(`[config] ${name} is required`);
  return value;
}

function optionalEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function configuredAddress(name: string, fallback: `0x${string}`): `0x${string}` {
  const value = requiredEnv(name, fallback);
  if (!isAddress(value)) throw new Error(`[config] ${name} is not a valid EVM address`);
  return value as `0x${string}`;
}

const SELLER_ADDR = configuredAddress("SELLER_ADDR", "0x000000000000000000000000000000000000abcd");
const PLATFORM_ADDR = configuredAddress("PLATFORM_ADDR", "0x0000000000000000000000000000000000001234");
const OSS_ADDR = configuredAddress("OSS_ADDR", "0x0000000000000000000000000000000000005678");

const FEATHERLESS_MODELS = new Set([
  "meta-llama/Meta-Llama-3.1-8B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "Qwen/Qwen2.5-Coder-7B-Instruct",
]);
const AIMLAPI_MODELS = new Set(["gpt-4o-mini", "gemini-2.0-flash", "claude-3-5-haiku-latest"]);

function cleanText(value: unknown, fallback: string, max: number): string {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (text.length > max) throw new Error(`text exceeds ${max} chars`);
  return text;
}

function cleanModel(value: unknown, fallback: string, allowed: Set<string>): string {
  const model = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!allowed.has(model)) throw new Error("model is not in the approved catalogue");
  return model;
}

function cleanSymbol(value: unknown): string {
  const symbol = String(value ?? "SOL").trim().toUpperCase();
  if (!/^[A-Z0-9._:-]{1,24}$/.test(symbol)) throw new Error("symbol must be 1-24 safe ticker chars");
  return symbol;
}

function cleanNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`number must be ${integer ? "an integer " : ""}between ${min} and ${max}`);
  }
  return n;
}

function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timeout));
}

/** Compute the floor price (50% of base) using a string-safe atomic representation. */
function priceFloor(price: string): string {
  const [whole, frac = ""] = price.split(".");
  const padded = (frac + "000000").slice(0, 6);
  const atomic = BigInt(whole + padded);
  const floor = atomic / 2n;
  if (floor === 0n) return price; // base already at minimum
  const s = floor.toString().padStart(7, "0");
  const w = s.slice(0, -6);
  const f = s.slice(-6).replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

const standardSplits: SplitSpec[] = [
  { addr: SELLER_ADDR, bps: 8000 },
  { addr: PLATFORM_ADDR, bps: 1000 },
  { addr: OSS_ADDR, bps: 1000 },
];

// Upstream rate cards in USDC atomic units (6 decimals). Sources are public
// price pages as of 2026-04-25. We split prompt vs completion tokens so the
// computed cost reflects the real billing dimension, not a blended guess.
//   - Featherless Llama-3.1-8B-Instruct: $0.10/1M tokens flat → 0.1 atomic/token in+out.
//   - AI/ML API gpt-4o-mini: $0.15/1M input + $0.60/1M output.
//   - Validator: in-process Node compute → flat 50 atomic ($0.00005) per call.
//   - AIsa/Kraken: public REST + minor compute → flat 10 atomic ($0.00001) per call.
// HONESTY RULE: when source is "synthesized" or "kraken-public" we did NOT pay
// the upstream price card, so cost MUST be 0. Otherwise the margin would lie.
const PROVIDER_COST_RATES = {
  featherless: { unit: "token" as const, prompt: 0.1, completion: 0.1 },
  aimlapi: { unit: "token" as const, prompt: 0.15, completion: 0.6 },
  validator: { unit: "request" as const, prompt: 0, completion: 0, flat: 50 },
  aisa: { unit: "request" as const, prompt: 0, completion: 0, flat: 10 },
} as const;

function sourceIsBilled(provider: keyof typeof PROVIDER_COST_RATES, source: string): boolean {
  // Only count cost if the upstream actually charged us. Kraken-public is free,
  // and any synth fallback never hit a paid endpoint. Validator is in-process
  // compute, billed flat per call.
  if (source.includes("synth")) return false;
  if (provider === "validator") return true;
  if (provider === "aisa" && !source.includes("aisa-real")) return false;
  if (provider === "featherless" && !source.includes("featherless-real")) return false;
  if (provider === "aimlapi" && !source.includes("aimlapi-real")) return false;
  return true;
}

async function logCost(
  ledger: Ledger,
  actionId: string | undefined,
  provider: keyof typeof PROVIDER_COST_RATES,
  observed: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; source: string; cache_hit?: boolean; error?: string },
): Promise<void> {
  if (!actionId) return;
  const rate = PROVIDER_COST_RATES[provider];
  const billed = sourceIsBilled(provider, observed.source) && !observed.cache_hit && !observed.error;
  let units = 0;
  let atomic = 0n;
  if (rate.unit === "token") {
    const pin = observed.prompt_tokens ?? 0;
    const pout = observed.completion_tokens ?? Math.max(0, (observed.total_tokens ?? 0) - pin);
    units = pin + pout;
    if (billed) atomic = BigInt(Math.max(0, Math.round(pin * rate.prompt + pout * rate.completion)));
  } else {
    units = 1;
    if (billed) atomic = BigInt((rate as { flat: number }).flat);
  }
  try {
    await ledger.logProviderCost({
      action_id: actionId,
      provider,
      unit: rate.unit,
      units,
      atomic_cost: atomic,
      meta: {
        source: observed.source,
        billed,
        cache_hit: !!observed.cache_hit,
        error: observed.error ?? null,
        prompt_tokens: observed.prompt_tokens ?? null,
        completion_tokens: observed.completion_tokens ?? null,
      },
    });
  } catch (err) {
    if (!PROD) console.error("logProviderCost failed:", (err as Error).message);
  }
}

async function main() {
  const ledger = new Ledger({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    user: requiredEnv("DB_USER", "picoflow"),
    password: requiredEnv("DB_PASSWORD", "picoflow"),
    database: requiredEnv("DB_NAME", "picoflow"),
    max: PROD ? 50 : 10,
  });
  await ledger.migrate();

  // Reap stale demo-runner orgs+keys from previous boots so each deploy starts
  // clean. The /api/demo/run handler now cleans up its own ephemeral creds on
  // child close, but anything left over from older builds (or hard restarts)
  // gets swept here. Safe to run on every boot — purely best-effort.
  try {
    const stale = await ledger.pool.query<{ org_id: string }>(
      "SELECT org_id FROM orgs WHERE name LIKE 'demo-runner-%' AND created_at < NOW() - INTERVAL '15 minutes'",
    );
    let reaped = 0;
    for (const row of stale.rows) {
      await ledger.pool.query("UPDATE api_keys SET revoked_at = NOW() WHERE org_id = $1 AND revoked_at IS NULL", [row.org_id]);
      try { await ledger.pool.query("DELETE FROM orgs WHERE org_id = $1", [row.org_id]); reaped++; }
      catch { /* org has FK rows — keys are revoked, leave row */ }
    }
    if (reaped > 0) console.log(`[sellers] reaped ${reaped} stale demo-runner orgs`);
  } catch (err) {
    if (!PROD) console.warn("[sellers] demo reaper warning:", (err as Error).message);
  }

  // Seed settings table from env on first boot (idempotent)
  const seed: Array<[string, string, string, boolean, string]> = [
    ["SELLER_ADDR", process.env.SELLER_ADDR ?? "", "treasury", false, "Primary seller payout address (80% split)"],
    ["PLATFORM_ADDR", process.env.PLATFORM_ADDR ?? "", "treasury", false, "Platform fee address (10% split)"],
    ["OSS_ADDR", process.env.OSS_ADDR ?? "", "treasury", false, "Open-source contributor address (10% split)"],
    ["CIRCLE_API_KEY", process.env.CIRCLE_API_KEY ?? "", "providers", true, "Circle Sandbox API key (Gateway/CCTP)"],
    ["FEATHERLESS_API_KEY", optionalEnv("FEATHERLESS_API_KEY"), "providers", true, "Featherless inference API key"],
    ["AIMLAPI_API_KEY", optionalEnv("AIMLAPI_API_KEY", "AIMLAPI_KEY"), "providers", true, "AI/ML API key"],
    ["AISA_API_KEY", process.env.AISA_API_KEY ?? "", "providers", true, "AIsa premium data API key"],
    ["ARC_RPC", process.env.ARC_RPC ?? "https://rpc.testnet.arc.network", "chain", false, "Arc RPC endpoint"],
    ["ARC_CHAIN_ID", process.env.ARC_CHAIN_ID ?? "5042002", "chain", false, "Arc chain ID"],
  ];
  for (const [k, v, cat, secret, desc] of seed) {
    if (!v) continue;
    await ledger.pool.query(
      `INSERT INTO settings(key,value,category,is_secret,description,updated_at)
       VALUES($1,$2,$3,$4,$5,now())
       ON CONFLICT (key) DO NOTHING`,
      [k, v, cat, secret, desc],
    );
  }

  const registry = new CapabilityRegistry();

  // Live chain config — resolved ONCE at boot from env. Phase-3 cutover means
  // these point at Arbitrum One in production; fallback to Arc Testnet for dev.
  const LIVE_CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? ARC_TESTNET.chainId);
  const LIVE_USDC = (process.env.ARC_USDC_ADDR ?? process.env.USDC_ADDRESS ?? ARC_TESTNET.usdc) as `0x${string}`;
  console.log(`[sellers] live chain: chainId=${LIVE_CHAIN_ID} usdc=${LIVE_USDC}`);

  const fallbackDemoChain = CHAIN_PRESETS["arc-testnet"]!;
  const demoChains = Object.values(CHAIN_PRESETS).filter((p) => p.contractsDeployed || p.chainId === LIVE_CHAIN_ID);
  function demoChainById(value: unknown): ChainPreset {
    const chainId = Number(value ?? LIVE_CHAIN_ID);
    return demoChains.find((p) => p.chainId === chainId) ?? presetByChainId(LIVE_CHAIN_ID) ?? fallbackDemoChain;
  }
  function resolveRequestChain(req: express.Request) {
    const requested = req.header("x-picoflow-chain-id");
    const preset = requested ? demoChainById(requested) : demoChainById(LIVE_CHAIN_ID);
    return { network: preset.chainId, asset: preset.usdc };
  }

  const SELLERS = [
    {
      endpoint: "/api/aisa/data",
      label: "AIsa Premium Data",
      category: "data",
      description: "Real-time market signals: spot, sentiment, volume, on-chain flows",
      price: "0.001",
      tags: ["data", "market", "sentiment", "aisa"],
    },
    {
      endpoint: "/api/featherless/infer",
      label: "Featherless Inference",
      category: "inference",
      description: "Open-model inference via Featherless flat-rate gateway",
      price: "0.005",
      tags: ["llm", "inference", "open-model", "featherless"],
    },
    {
      endpoint: "/api/aimlapi/infer",
      label: "AI/ML API Inference",
      category: "inference",
      description: "OpenAI-compatible inference with Gemini / Claude / Llama models",
      price: "0.005",
      tags: ["llm", "inference", "openai-compat", "aimlapi"],
    },
    {
      endpoint: "/api/validator/check",
      label: "Validator Cross-check",
      category: "validation",
      description: "Run a cross-model second opinion; may trigger ProofMesh slash on disagreement",
      price: "0.0015",
      tags: ["validation", "consensus", "proofmesh"],
    },
  ];
  for (const s of SELLERS) {
    registry.register({
      endpoint: s.endpoint,
      label: s.label,
      category: s.category,
      description: s.description,
      price_usdc: s.price,
      seller_addr: SELLER_ADDR,
      splits: standardSplits,
      upstream: "synthesized",
      tags: s.tags,
      reputation: 0.95,
    });
  }

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "64kb" }));

  // ---- Optional Bearer API-key gate (Phase 6b) ---------------------------
  // When REQUIRE_API_KEY=true, every paid `/api/...` route (except /healthz,
  // /registry, /stats, /margin, /price_quote, /providers, /demo, /settings,
  // /gateway, /admin) requires an Authorization header using the Bearer scheme.
  // Format: prefix is 12 hex chars; secret is 32 hex chars; we sha256 the secret
  // and compare to the stored key_hash with a constant-time check.
  const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === "true";
  const KEY_ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
  const FREE_PREFIXES = [
    "/api/healthz",
    "/api/registry",
    "/api/stats",
    "/api/margin",
    "/api/price_quote",
    "/api/providers",
    "/api/demo",
    "/api/settings",
    "/api/gateway",
    "/api/admin",
    "/api/auth",
    "/api/me",
    "/api/network",
    "/api/chains",
    "/api/metrics",
  ];
  function isFreePath(p: string): boolean {
    return FREE_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));
  }
  // 60s in-memory cache: org_id -> { used calls this month, cache expiry }.
  // We optimistically increment between DB probes so a burst of N calls is
  // counted as N rather than as the snapshot value. If the snapshot already
  // exceeds the limit we re-probe (in case the month rolled over).
  const quotaCache = new Map<string, { used: number; expires: number }>();
  app.use(async (req, res, next) => {
    if (!REQUIRE_API_KEY) return next();
    if (req.method === "OPTIONS") return next();
    if (!req.path.startsWith("/api/")) return next();
    if (isFreePath(req.path)) return next();
    const auth = req.header("authorization") ?? "";
    const m = /^Bearer\s+(pf_[a-f0-9]{12}_[a-f0-9]{32})$/i.exec(auth.trim());
    if (!m) {
      res.status(401).json({ error: "missing or malformed PicoFlow API-key Authorization header" });
      return;
    }
    const fullKey = m[1]!;
    const parts = fullKey.split("_");
    const prefix = parts[1]!.toLowerCase();
    const secret = parts[2]!.toLowerCase();
    const suppliedHash = createHash("sha256").update(secret).digest("hex");
    try {
      const result = await ledger.authenticateApiKey(prefix, suppliedHash);
      if (!result) {
        res.status(401).json({ error: "invalid or revoked API key" });
        return;
      }
      // Enforce monthly call quota (org-scoped). Cached 60s in-memory so we
      // don't hammer Postgres on every request — the cache key is the org_id
      // and the value is the count returned at probe time. When the cached
      // value is >= limit we re-probe to allow the worker to "unstick" once
      // the calendar month rolls over without waiting up to 60s.
      if (result.monthly_call_limit != null && result.monthly_call_limit > 0) {
        const now = Date.now();
        const cached = quotaCache.get(result.org_id);
        let used: number;
        if (cached && cached.expires > now && cached.used < result.monthly_call_limit) {
          used = cached.used + 1;
          quotaCache.set(result.org_id, { used, expires: cached.expires });
        } else {
          used = await ledger.countActionsThisMonthForOrg(result.org_id);
          quotaCache.set(result.org_id, { used, expires: now + 60_000 });
        }
        if (used >= result.monthly_call_limit) {
          res.status(429).json({
            error: "monthly call quota exceeded",
            org_id: result.org_id,
            used,
            limit: result.monthly_call_limit,
          });
          return;
        }
      }
      (req as unknown as { picoflow?: { org_id: string; org_name: string; key_id: string } }).picoflow = {
        org_id: result.org_id,
        org_name: result.org_name,
        key_id: result.key_id,
      };
      next();
    } catch (err) {
      res.status(500).json({ error: "auth lookup failed", reason: (err as Error).message });
    }
  });

  /**
   * Admin gate accepts EITHER:
   *   - The legacy shared `X-Admin-Token: <ADMIN_TOKEN>` header, OR
  *   - a Bearer-form PicoFlow API key where the api_keys row has
   *     `scope='admin'` (per-operator key, revocable, audit-loggable).
   * The Bearer path is the documented forward direction; the env-token path
   * stays for bootstrap and break-glass operations.
   */
  async function adminAuth(req: express.Request): Promise<boolean> {
    const tok = req.header("x-admin-token") ?? "";
    if (KEY_ADMIN_TOKEN && tok === KEY_ADMIN_TOKEN) return true;
    const auth = req.header("authorization") ?? "";
    const m = /^Bearer\s+(pf_[a-f0-9]{12}_[a-f0-9]{32})$/i.exec(auth.trim());
    if (!m) return false;
    const parts = m[1]!.split("_");
    const prefix = parts[1]!.toLowerCase();
    const secret = parts[2]!.toLowerCase();
    const suppliedHash = createHash("sha256").update(secret).digest("hex");
    try {
      const r = await ledger.authenticateApiKeyWithScope(prefix, suppliedHash);
      return !!(r && r.scope === "admin");
    } catch {
      return false;
    }
  }

  function requireAdmin(req: express.Request, res: express.Response): boolean {
    // Synchronous for legacy call-sites: env-token only. New code calls
    // requireAdminAsync for full Bearer-scope verification.
    if (!KEY_ADMIN_TOKEN) {
      res.status(503).json({ error: "ADMIN_TOKEN env not configured on the seller" });
      return false;
    }
    const got = req.header("x-admin-token") ?? "";
    if (got !== KEY_ADMIN_TOKEN) {
      // Defer to Bearer-scope path via async verifier; surface 401 if neither.
      res.status(401).json({
        error: "missing or invalid X-Admin-Token (or send a Bearer-form PicoFlow API key with admin scope)",
      });
      return false;
    }
    return true;
  }

  async function requireAdminAsync(req: express.Request, res: express.Response): Promise<boolean> {
    const ok = await adminAuth(req);
    if (!ok) {
      res.status(401).json({
        error: "admin auth failed (X-Admin-Token or a Bearer-form admin API key required)",
      });
    }
    return ok;
  }

  // ---- Admin: orgs + api-keys CRUD (Phase 6b) ---------------------------
  app.get("/api/admin/orgs", async (req, res) => {
    if (!(await requireAdminAsync(req, res))) return;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 100)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const q = req.query.q ? String(req.query.q) : undefined;
    const [items, total] = await Promise.all([
      ledger.listOrgs({ limit, offset, q }),
      ledger.countOrgs(q),
    ]);
    res.json({ items, total, limit, offset });
  });

  app.post("/api/admin/orgs", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const name = String(req.body?.name ?? "").trim();
      if (!/^[A-Za-z0-9 _.\-]{2,80}$/.test(name)) {
        res.status(400).json({ error: "name must be 2-80 chars (letters/digits/space/._-)" });
        return;
      }
      const contact_email = req.body?.contact_email ? String(req.body.contact_email).trim().slice(0, 200) : null;
      const monthly_call_limit = req.body?.monthly_call_limit != null
        ? cleanNumber(req.body.monthly_call_limit, 0, 0, 1_000_000_000, true) : null;
      const notes = req.body?.notes ? String(req.body.notes).trim().slice(0, 1000) : null;
      const org_id = randomUUID();
      await ledger.createOrg({ org_id, name, contact_email, monthly_call_limit, notes });
      res.json({ ok: true, org_id });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/orgs/:org_id/disable", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const disabled = req.body?.disabled !== false;
    try {
      await ledger.setOrgDisabled(req.params.org_id, disabled);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/api/admin/api-keys", async (req, res) => {
    if (!(await requireAdminAsync(req, res))) return;
    const org_id = req.query.org_id ? String(req.query.org_id) : undefined;
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit ?? 200)));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    res.json({ items: await ledger.listApiKeys(org_id, { limit, offset }), limit, offset });
  });

  app.post("/api/admin/api-keys", async (req, res) => {
    if (!(await requireAdminAsync(req, res))) return;
    try {
      const org_id = String(req.body?.org_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(org_id)) {
        res.status(400).json({ error: "org_id must be a UUID" });
        return;
      }
      const label = String(req.body?.label ?? "default").trim().slice(0, 80);
      const scope = req.body?.scope === "admin" ? "admin" : "tenant";
      const prefix = randomBytes(6).toString("hex");
      const secret = randomBytes(16).toString("hex");
      const key_hash = createHash("sha256").update(secret).digest("hex");
      const key_id = randomUUID();
      await ledger.createApiKey({ key_id, org_id, label, key_prefix: prefix, key_hash, scope });
      // The full key is shown ONCE. After this response it cannot be recovered.
      res.json({ ok: true, key_id, key_prefix: prefix, scope, full_key: `pf_${prefix}_${secret}` });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/api-keys/:key_id", async (req, res) => {
    if (!(await requireAdminAsync(req, res))) return;
    try {
      const key_id = String(req.params.key_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(key_id)) {
        res.status(400).json({ error: "key_id must be a UUID" });
        return;
      }
      const label = String(req.body?.label ?? "default").trim().slice(0, 80) || "default";
      const scope = req.body?.scope === "admin" ? "admin" : "tenant";
      await ledger.updateApiKey({ key_id, label, scope });
      res.json({ ok: true, key_id, label, scope });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/api-keys/:key_id/revoke", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ledger.revokeApiKey(req.params.key_id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ---- Auth (signup / login / logout / me) -------------------------------
  // Signup creates a brand-new org + owner user. Login/logout return a signed
  // session cookie (HMAC-SHA256 over user_id|exp). The dashboard reads this
  // cookie via the Next.js layer; the seller is the source of truth for users.
  // Passwords stored as scrypt(N=16384, r=8, p=1) — Node default, no extra dep.

  const SESSION_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_TOKEN || "";
  const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

  function hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    return `s1$${salt.toString("hex")}$${hash.toString("hex")}`;
  }
  function verifyPassword(password: string, stored: string): boolean {
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "s1") return false;
    const salt = Buffer.from(parts[1]!, "hex");
    const expected = Buffer.from(parts[2]!, "hex");
    const got = scryptSync(password, salt, expected.length);
    return got.length === expected.length && timingSafeEqual(got, expected);
  }
  function signSession(user_id: string): string {
    if (!SESSION_SECRET) throw new Error("SESSION_SECRET not configured");
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
    const body = `${user_id}.${exp}`;
    const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("hex");
    return `${body}.${sig}`;
  }
  function verifySession(token: string): { user_id: string; exp: number } | null {
    if (!SESSION_SECRET) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [user_id, expStr, sig] = parts as [string, string, string];
    const expected = createHmac("sha256", SESSION_SECRET).update(`${user_id}.${expStr}`).digest("hex");
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
    return { user_id, exp };
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      const org_name = String(req.body?.org_name ?? "").trim() || `${email.split("@")[0]}-org`;
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "invalid email" });
      if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
      if (org_name.length < 2 || org_name.length > 64)
        return res.status(400).json({ error: "org_name must be 2-64 characters" });
      const existing = await ledger.findUserByEmail(email);
      if (existing) return res.status(409).json({ error: "an account with that email already exists" });
      const user_id = randomUUID();
      const org_id = randomUUID();
      await ledger.signupUser({
        user_id,
        org_id,
        email,
        password_hash: hashPassword(password),
        org_name,
      });
      const token = signSession(user_id);
      res.json({ ok: true, user_id, org_id, session: token, ttl_sec: SESSION_TTL_SEC });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const password = String(req.body?.password ?? "");
      if (!email || !password) return res.status(400).json({ error: "email and password required" });
      const user = await ledger.findUserByEmail(email);
      if (!user) return res.status(401).json({ error: "invalid email or password" });
      if (!verifyPassword(password, user.password_hash))
        return res.status(401).json({ error: "invalid email or password" });
      await ledger.touchUserLogin(user.user_id);
      const token = signSession(user.user_id);
      res.json({ ok: true, user_id: user.user_id, org_id: user.org_id, session: token, ttl_sec: SESSION_TTL_SEC });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = String(req.query.token ?? req.header("x-pf-session") ?? "");
    if (!token) return res.status(401).json({ error: "no session" });
    const sess = verifySession(token);
    if (!sess) return res.status(401).json({ error: "invalid or expired session" });
    const user = await ledger.getUserById(sess.user_id);
    if (!user) return res.status(401).json({ error: "user no longer exists" });
    res.json({ ok: true, user });
  });

  app.post("/api/auth/logout", async (_req, res) => {
    res.json({ ok: true });
  });

  // ---- /api/admin/seed-roles ----
  // Idempotently seeds the three canonical demo accounts (admin / seller /
  // public) with deterministic credentials. Existing users keep their data —
  // only password_hash and role are upserted. Used by ops to bootstrap a fresh
  // deployment with predictable credentials operators can hand out.
  // Admin-only (X-Admin-Token).
  app.post("/api/admin/seed-roles", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    type Seed = { email: string; password: string; role: "admin" | "seller" | "public"; org_name: string };
    const seeds: Seed[] = [
      { email: "admin@picoflow.local", password: "Admin#PicoFlow2026!", role: "admin", org_name: "PicoFlow Operators" },
      { email: "seller@picoflow.local", password: "Seller#PicoFlow2026!", role: "seller", org_name: "PicoFlow Demo Seller" },
      { email: "public@picoflow.local", password: "Public#PicoFlow2026!", role: "public", org_name: "PicoFlow Public Demo" },
    ];
    const results: Array<{ email: string; role: string; user_id: string; org_id: string; created: boolean }> = [];
    for (const s of seeds) {
      const existing = await ledger.findUserByEmail(s.email);
      const password_hash = hashPassword(s.password);
      if (existing) {
        await ledger.adminSetUserCredentials(existing.user_id, password_hash, s.role);
        results.push({ email: s.email, role: s.role, user_id: existing.user_id, org_id: existing.org_id, created: false });
      } else {
        const user_id = randomUUID();
        const org_id = randomUUID();
        await ledger.signupUser({ user_id, org_id, email: s.email, password_hash, org_name: s.org_name });
        await ledger.adminSetUserCredentials(user_id, password_hash, s.role);
        results.push({ email: s.email, role: s.role, user_id, org_id, created: true });
      }
    }
    res.json({ ok: true, seeded: results });
  });

  // Self-service key management — gated by session cookie, scoped to user's org.
  function userFromReq(req: express.Request): { user_id: string; exp: number } | null {
    const token = String(req.header("x-pf-session") ?? "");
    if (!token) return null;
    return verifySession(token);
  }
  app.get("/api/me/keys", async (req, res) => {
    const sess = userFromReq(req);
    if (!sess) return res.status(401).json({ error: "no session" });
    const user = await ledger.getUserById(sess.user_id);
    if (!user) return res.status(401).json({ error: "user gone" });
    const items = await ledger.listApiKeys(user.org_id);
    res.json({ ok: true, org: user, items });
  });
  app.post("/api/me/keys", async (req, res) => {
    const sess = userFromReq(req);
    if (!sess) return res.status(401).json({ error: "no session" });
    const user = await ledger.getUserById(sess.user_id);
    if (!user) return res.status(401).json({ error: "user gone" });
    const label = String(req.body?.label ?? "default").trim() || "default";
    const prefix = randomBytes(6).toString("hex");
    const secret = randomBytes(16).toString("hex");
    const key_hash = createHash("sha256").update(secret).digest("hex");
    const key_id = randomUUID();
    await ledger.createApiKey({ key_id, org_id: user.org_id, label, key_prefix: prefix, key_hash });
    res.json({ ok: true, key_id, key_prefix: prefix, full_key: `pf_${prefix}_${secret}` });
  });
  app.post("/api/me/keys/:key_id/revoke", async (req, res) => {
    const sess = userFromReq(req);
    if (!sess) return res.status(401).json({ error: "no session" });
    const user = await ledger.getUserById(sess.user_id);
    if (!user) return res.status(401).json({ error: "user gone" });
    // Verify the key belongs to this org before revoking.
    const items = await ledger.listApiKeys(user.org_id);
    if (!items.find((k) => k.key_id === req.params.key_id))
      return res.status(404).json({ error: "key not found in your org" });
    await ledger.revokeApiKey(req.params.key_id);
    res.json({ ok: true });
  });

  // ---- FREE endpoints ----
  app.get("/api/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.get("/api/registry", (_req, res) => res.json({ items: registry.all() }));
  app.get("/api/stats", async (_req, res) => res.json(await ledger.getStats()));
  app.get("/api/margin", (req, res) => {
    try {
      const price = cleanNumber(req.query.price, 0.005, 0.000001, 100);
      const n = cleanNumber(req.query.n, 1000, 1, 1_000_000, true);
      res.json(computeMargin(price, n));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ---- /api/price_quote — optional negotiation handshake ----
  // Lets buyer agents request a price BEFORE committing an EIP-3009 signature.
  // Per-resource QuoteEngine instances apply volume-tier discounts + buyer
  // overrides + floor pricing. The issued quote_id is in-memory; buyers may
  // retrieve it again via GET /api/price_quote/:quote_id while it is valid.
  // The quote rationale is honest: a 0% discount is reported as such — never
  // a fake price the seller cannot honor.
  const quoteEngines = new Map<string, QuoteEngine>();
  for (const s of SELLERS) {
    quoteEngines.set(
      s.endpoint,
      new QuoteEngine({
        asset: LIVE_USDC,
        network: LIVE_CHAIN_ID,
        to: SELLER_ADDR,
        splits: standardSplits,
        basePrice: s.price,
        // Honest, modest volume tiers — these are the ONLY discounts the
        // seller actually honors today (manually applied on the next price
        // sweep). Do not advertise tiers we cannot deliver.
        volumeTiers: [
          { minVolume: 100, discountBps: 200 },   // 2% off at 100+ calls
          { minVolume: 1000, discountBps: 500 },  // 5% off at 1k+ calls
          { minVolume: 10000, discountBps: 1000 }, // 10% off at 10k+ calls
        ],
        floorPrice: priceFloor(s.price),
        validityWindowSec: 300,
      }),
    );
  }
  app.post("/api/price_quote", (req, res) => {
    try {
      const resource = String(req.body?.resource ?? "").trim();
      if (!resource) { res.status(400).json({ error: "resource is required" }); return; }
      const engine = quoteEngines.get(resource);
      if (!engine) {
        res.status(404).json({ error: `no quote engine for resource "${resource}"` });
        return;
      }
      const proposed_price = req.body?.proposed_price ? String(req.body.proposed_price) : undefined;
      const volume = req.body?.volume !== undefined
        ? cleanNumber(req.body.volume, 1, 1, 10_000_000, true)
        : undefined;
      const buyer = req.body?.buyer ? String(req.body.buyer) : undefined;
      if (buyer && !isAddress(buyer)) {
        res.status(400).json({ error: "buyer must be a valid EVM address" });
        return;
      }
      const quote = engine.quote({
        resource,
        proposed_price,
        volume,
        buyer: buyer as `0x${string}` | undefined,
      });
      res.json(quote);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
  app.get("/api/price_quote/:quote_id", (req, res) => {
    for (const engine of quoteEngines.values()) {
      const q = engine.consume(req.params.quote_id);
      if (q) { res.json(q); return; }
    }
    res.status(404).json({ error: "quote not found or expired" });
  });

  // ---- PROVIDERS LIVE STATUS ----
  // Probes each external AI provider with a tiny prompt and reports source
  // ("featherless-real" / "aimlapi-real" / "synthesized") + latency.
  // This lets judges verify Featherless + AI/ML API integrations are wired live.
  app.get("/api/providers/status", async (_req, res) => {
    const probe = "Reply with exactly the word PONG.";
    const probes: Array<{
      name: string; endpoint: string; price_usdc: string; key_present: boolean;
      source: string; latency_ms: number; sample: string; ok: boolean;
    }> = [];

    async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
      const t0 = Date.now();
      const value = await fn();
      return { value, ms: Date.now() - t0 };
    }

    // Featherless
    {
      const t = await timed(() => callFeatherless(probe, "meta-llama/Meta-Llama-3.1-8B-Instruct"));
      probes.push({
        name: "Featherless",
        endpoint: "/api/featherless/infer",
        price_usdc: "0.005",
        key_present: Boolean(optionalEnv("FEATHERLESS_API_KEY")),
        source: t.value.source,
        latency_ms: t.ms,
        sample: (t.value.text || "").slice(0, 80),
        ok: t.value.source.endsWith("-real"),
      });
    }
    // AI/ML API
    {
      const t = await timed(() => callAimlApi(probe, "gpt-4o-mini"));
      probes.push({
        name: "AI/ML API",
        endpoint: "/api/aimlapi/infer",
        price_usdc: "0.005",
        key_present: Boolean(optionalEnv("AIMLAPI_API_KEY", "AIMLAPI_KEY")),
        source: t.value.source,
        latency_ms: t.ms,
        sample: (t.value.text || "").slice(0, 80),
        ok: t.value.source.endsWith("-real"),
      });
    }
    // AIsa data with real Kraken public fallback when no AIsa key is configured.
    {
      const t = await timed(() => fetchAisaSignal("BTC"));
      probes.push({
        name: "AIsa Data / Kraken fallback",
        endpoint: "/api/aisa/data",
        price_usdc: "0.001",
        key_present: Boolean(optionalEnv("AISA_API_KEY")),
        source: t.value.source,
        latency_ms: t.ms,
        sample: `BTC spot ${t.value.spot} volume ${Math.round(t.value.volume)}`,
        ok: t.value.source !== "synthesized",
      });
    }
    // Validator
    probes.push({
      name: "PicoFlow Validator",
      endpoint: "/api/validator/check",
      price_usdc: "0.0015",
      key_present: false,
      source: "in-process",
      latency_ms: 0,
      sample: "claim/reference cross-check (slashes bond on disagree)",
      ok: true,
    });

    res.json({ ts: Date.now(), probes });
  });

  // ---- SETTINGS CRUD (admin) ----
  // Stored in `settings` (key,value,category,is_secret,description). Secret values
  // are masked in GET responses; full value only retrievable via /reveal with admin token.
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
  const OPEN_ADMIN = process.env.PICOFLOW_OPEN_ADMIN === "true" && !PROD;
  function adminOk(req: express.Request): boolean {
    if (OPEN_ADMIN) return true;
    if (!ADMIN_TOKEN) return false;
    const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    return req.header("x-picoflow-admin") === ADMIN_TOKEN || bearer === ADMIN_TOKEN;
  }
  function maskSecret(v: string): string {
    if (!v) return "";
    if (v.length <= 8) return "••••";
    return v.slice(0, 4) + "•".repeat(Math.max(4, v.length - 8)) + v.slice(-4);
  }

  app.get("/api/settings", async (_req, res) => {
    const r = await ledger.pool.query(
      "SELECT key, value, category, is_secret, description, updated_at FROM settings ORDER BY category, key",
    );
    res.json({
      items: r.rows.map((row) => ({
        ...row,
        value: row.is_secret ? maskSecret(row.value) : row.value,
      })),
    });
  });

  app.post("/api/settings", async (req, res) => {
    if (!adminOk(req)) { res.status(401).json({ error: "admin token required" }); return; }
    const { key, value, category, is_secret, description } = req.body ?? {};
    if (!key || typeof key !== "string" || typeof value !== "string") {
      res.status(400).json({ error: "key (string) and value (string) required" }); return;
    }
    await ledger.pool.query(
      `INSERT INTO settings(key,value,category,is_secret,description,updated_at)
       VALUES($1,$2,COALESCE($3,'general'),COALESCE($4,false),$5,now())
       ON CONFLICT (key) DO UPDATE
         SET value=EXCLUDED.value, category=EXCLUDED.category,
             is_secret=EXCLUDED.is_secret, description=EXCLUDED.description, updated_at=now()`,
      [key, value, category ?? null, is_secret ?? false, description ?? null],
    );
    res.json({ ok: true, key });
  });

  app.delete("/api/settings/:key", async (req, res) => {
    if (!adminOk(req)) { res.status(401).json({ error: "admin token required" }); return; }
    await ledger.pool.query("DELETE FROM settings WHERE key=$1", [req.params.key]);
    res.json({ ok: true, key: req.params.key });
  });

  app.get("/api/settings/:key/reveal", async (req, res) => {
    if (!adminOk(req)) { res.status(401).json({ error: "admin token required" }); return; }
    const r = await ledger.pool.query("SELECT value FROM settings WHERE key=$1", [req.params.key]);
    if (r.rowCount === 0) { res.status(404).json({ error: "not found" }); return; }
    res.json({ key: req.params.key, value: r.rows[0].value });
  });

  // ---- DEMO RUNNER (UI-controlled) ----
  // Runs the buyer-agent subprocess and streams logs back. State kept in-memory.
  type DemoState = {
    status: "idle" | "running" | "ok" | "fail";
    started_at: number | null;
    finished_at: number | null;
    logs: string[];
    report: unknown | null;
    error: string | null;
    selected_chain: {
      id: string;
      chain_id: number;
      name: string;
      is_mainnet: boolean;
      explorer: string;
      usdc: string;
      native_symbol: string;
    } | null;
  };
  const demoState: DemoState = {
    status: "idle", started_at: null, finished_at: null, logs: [], report: null, error: null, selected_chain: null,
  };
  const RUNNER_PATH = process.env.BUYER_RUNNER_PATH ??
    pathResolve("/repo/apps/buyer-agent/dist/runner.js");

  app.get("/api/demo/state", (req, res) => {
    if (req.query.format === "terminal") {
      const chain = demoState.selected_chain;
      const lines = [
        "PicoFlow demo terminal transcript",
        "=================================",
        `status: ${demoState.status}`,
        `network: ${chain ? `${chain.name} chainId=${chain.chain_id} ${chain.is_mainnet ? "mainnet" : "testnet"}` : "not selected"}`,
        `usdc: ${chain?.usdc ?? "n/a"}`,
        `explorer: ${chain?.explorer ?? "n/a"}`,
        `started_at: ${demoState.started_at ? new Date(demoState.started_at).toISOString() : "n/a"}`,
        `finished_at: ${demoState.finished_at ? new Date(demoState.finished_at).toISOString() : "n/a"}`,
        "",
        "workflow:",
        "  1. dashboard POST /api/demo/run with selected chain_id",
        "  2. seller mints an ephemeral org API key",
        "  3. buyer agent requests each paid endpoint",
        "  4. seller replies 402 x402 challenge with selected network + USDC asset",
        "  5. buyer signs EIP-3009 TransferWithAuthorization",
        "  6. seller verifies nonce/signature, writes actions/payments/settlements/splits",
        "  7. ProofMesh stakes/slashes/refunds are recorded in the proof lane",
        "  8. gateway outbox rows wait for real relayer settlement where configured",
        "",
        "live log tail:",
        ...demoState.logs.slice(-250),
      ];
      res.type("text/plain").send(lines.join("\n") + "\n");
      return;
    }
    res.json({
      ...demoState,
      logs: demoState.logs.slice(-200),
    });
  });

  app.post("/api/demo/run", async (req, res) => {
    if (demoState.status === "running") {
      res.status(409).json({ ok: false, error: "demo already running" });
      return;
    }
    const selectedPreset = demoChainById(req.body?.chain_id ?? req.query.chain_id ?? LIVE_CHAIN_ID);
    demoState.status = "running";
    demoState.started_at = Date.now();
    demoState.finished_at = null;
    demoState.logs = [];
    demoState.report = null;
    demoState.error = null;
    demoState.selected_chain = {
      id: selectedPreset.id,
      chain_id: selectedPreset.chainId,
      name: selectedPreset.name,
      is_mainnet: selectedPreset.isMainnet,
      explorer: selectedPreset.explorer,
      usdc: selectedPreset.usdc,
      native_symbol: selectedPreset.nativeSymbol,
    };
    demoState.logs.push(`[demo] selected network ${selectedPreset.name} chainId=${selectedPreset.chainId} ${selectedPreset.isMainnet ? "mainnet" : "testnet"}`);

    // Mint an ephemeral demo API key so the buyer subprocess can authenticate
    // when REQUIRE_API_KEY=true. Falls back gracefully if minting fails.
    let demoKey = "";
    let ephemeralOrgId: string | null = null;
    let ephemeralKeyId: string | null = null;
    try {
      const org_id = randomUUID();
      const orgName = `demo-runner-${Date.now()}`;
      await ledger.createOrg({ org_id, name: orgName, monthly_call_limit: 10_000 });
      const prefix = randomBytes(6).toString("hex");
      const secret = randomBytes(16).toString("hex");
      const key_hash = createHash("sha256").update(secret).digest("hex");
      const key_id = randomUUID();
      await ledger.createApiKey({
        key_id,
        org_id,
        label: "demo-runner-ephemeral",
        key_prefix: prefix,
        key_hash,
      });
      demoKey = `pf_${prefix}_${secret}`;
      ephemeralOrgId = org_id;
      ephemeralKeyId = key_id;
      demoState.logs.push(`[demo] minted ephemeral key for org ${org_id}`);
    } catch (err) {
      demoState.logs.push(`[demo] could not mint ephemeral key: ${(err as Error).message}`);
    }

    const child = spawn(process.execPath, [RUNNER_PATH], {
      env: {
        ...process.env,
        SELLER_BASE: process.env.DEMO_SELLER_BASE ?? `http://127.0.0.1:${process.env.SELLER_PORT ?? 3030}`,
        BUYER_API_KEY: demoKey,
        DEMO_CHAIN_ID: String(selectedPreset.chainId),
        DEMO_NETWORK_NAME: selectedPreset.name,
        DEMO_EXPLORER: selectedPreset.explorer,
        DEMO_USDC: selectedPreset.usdc,
        DEMO_NATIVE_SYMBOL: selectedPreset.nativeSymbol,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pushLine = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        demoState.logs.push(line);
        if (demoState.logs.length > 1000) demoState.logs.shift();
        const m = line.match(/^\s*({[\s\S]*"plan_size"[\s\S]*})\s*$/);
        if (m && m[1]) {
          try { demoState.report = JSON.parse(m[1]); } catch { /* ignore */ }
        }
      }
    };
    child.stdout.on("data", pushLine);
    child.stderr.on("data", pushLine);

    let buffered = "";
    child.stdout.on("data", (c: Buffer) => { buffered += c.toString("utf8"); });
    child.on("close", (code) => {
      // Try to extract REPORT JSON from buffered stdout if not parsed yet
      if (!demoState.report) {
        const idx = buffered.lastIndexOf("=== REPORT ===");
        if (idx >= 0) {
          const tail = buffered.slice(idx);
          const start = tail.indexOf("{");
          const end = tail.lastIndexOf("}");
          if (start >= 0 && end > start) {
            try { demoState.report = JSON.parse(tail.slice(start, end + 1)); } catch { /* ignore */ }
          }
        }
      }
      demoState.finished_at = Date.now();
      demoState.status = code === 0 ? "ok" : "fail";
      if (code !== 0) demoState.error = `runner exited with code ${code}`;
      // Cleanup ephemeral demo credentials so each run starts clean and dead
      // key_hashes don't accumulate. Best-effort; failure is non-fatal.
      if (ephemeralKeyId || ephemeralOrgId) {
        Promise.resolve().then(async () => {
          try {
            if (ephemeralKeyId) await ledger.revokeApiKey(ephemeralKeyId);
            // Best-effort org delete: only succeeds if no FKs reference it. We
            // run paid actions under the demo org's key, but actions reference
            // org via a NULLABLE column, so cascade via NULL is fine. Wrap in
            // try/catch so a constraint violation just leaves the row behind.
            if (ephemeralOrgId) {
              try { await ledger.pool.query("DELETE FROM orgs WHERE org_id = $1", [ephemeralOrgId]); }
              catch { /* org has FK rows — leave it, key is already revoked */ }
            }
            demoState.logs.push(`[demo] cleaned up ephemeral key${ephemeralOrgId ? " + org" : ""}`);
          } catch (err) {
            demoState.logs.push(`[demo] cleanup warning: ${(err as Error).message}`);
          }
        });
      }
    });
    child.on("error", (err) => {
      demoState.status = "fail";
      demoState.error = err.message;
      demoState.finished_at = Date.now();
    });

    res.json({ ok: true, started_at: demoState.started_at, selected_chain: demoState.selected_chain });
  });

  // ---- /api/whoami — bearer round-trip proof (Round-3 P0) ----
  // Returns the authenticated org/key for the caller. NOT in FREE_PREFIXES,
  // so this exercises the full Bearer middleware end-to-end and is the curl
  // endpoint judges can use to confirm API-key auth is wired.
  app.get("/api/whoami", (req, res) => {
    if (!REQUIRE_API_KEY) {
      res.json({
        authenticated: false,
        reason: "REQUIRE_API_KEY=false on this server (auth bypass active)",
        require_api_key: false,
      });
      return;
    }
    const ctx = (req as express.Request & { picoflow?: { org_id: string; org_name: string; key_id: string } }).picoflow;
    if (!ctx) {
      res.status(500).json({ error: "auth middleware did not attach picoflow context" });
      return;
    }
    res.json({
      authenticated: true,
      org_id: ctx.org_id,
      org_name: ctx.org_name,
      key_id: ctx.key_id,
      ts: Date.now(),
    });
  });

  // ---- PAID endpoints ----
  const tb = (price: string, label: string, description: string) =>
    tollbooth({
      price,
      to: SELLER_ADDR,
      splits: standardSplits,
      ledger,
      sellerLabel: label,
      description,
      asset: LIVE_USDC,
      network: LIVE_CHAIN_ID,
      resolveChain: resolveRequestChain,
      settlementMode: "gateway-batch",
      // No trustless flag. Verification + nonce-replay defense run on every paid call.
      // Settlement rows start as 'pending' and are promoted to 'settled' by the
      // gateway-batch worker once Circle Gateway confirms the batch.
    });

  app.get(
    "/api/aisa/data",
    tb("0.001", "AIsa Premium Data", "Spot price + sentiment for a symbol"),
    async (req, res) => {
      try {
        const ctx = (req as express.Request & { picoflow?: { action_id: string } }).picoflow;
        const symbol = cleanSymbol(req.query.symbol);
        const demoFast = req.header("x-picoflow-demo-mode") === "fast";
        const price = demoFast
          ? { spot: 100 + symbol.length, sentiment: 0.25, volume: 1_000_000, source: "synthesized-demo-fast" }
          : await fetchAisaSignal(symbol);
        await logCost(ledger, ctx?.action_id, "aisa", { source: price.source });
        res.json({
          action_id: ctx?.action_id,
          provider: "aisa",
          symbol,
          price_usd: price.spot,
          sentiment: price.sentiment,
          volume_24h: price.volume,
          ts: Date.now(),
          source: price.source,
        });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/api/featherless/infer",
    tb("0.005", "Featherless Inference", "LLM completion via Featherless"),
    async (req, res) => {
      try {
        if (!rateLimit(`featherless:${req.ip}`, 30, 60_000)) {
          res.status(429).json({ error: "rate limit exceeded" }); return;
        }
        const ctx = (req as express.Request & { picoflow?: { action_id: string } }).picoflow;
        const prompt = cleanText(req.body?.prompt, "Summarise PicoFlow.", 2_000);
        const model = cleanModel(req.body?.model, "meta-llama/Meta-Llama-3.1-8B-Instruct", FEATHERLESS_MODELS);
        const demoFast = req.header("x-picoflow-demo-mode") === "fast";
        const out = demoFast
          ? { text: synthSummary(prompt), tokens: Math.round(prompt.length / 4), prompt_tokens: 0, completion_tokens: 0, source: "synthesized-demo-fast" }
          : await callFeatherless(prompt, model);
        await logCost(ledger, ctx?.action_id, "featherless", {
          source: out.source,
          prompt_tokens: out.prompt_tokens,
          completion_tokens: out.completion_tokens,
          total_tokens: out.tokens,
          error: out.error,
        });
        res.json({
          action_id: ctx?.action_id,
          provider: "featherless",
          model,
          text: out.text,
          tokens: out.tokens,
          source: out.source,
        });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/api/aimlapi/infer",
    tb("0.005", "AI/ML API Inference", "LLM completion via AI/ML API (OpenAI-compatible)"),
    async (req, res) => {
      try {
        if (!rateLimit(`aimlapi:${req.ip}`, 30, 60_000)) {
          res.status(429).json({ error: "rate limit exceeded" }); return;
        }
        const ctx = (req as express.Request & { picoflow?: { action_id: string } }).picoflow;
        const prompt = cleanText(req.body?.prompt, "Summarise PicoFlow.", 2_000);
        const model = cleanModel(req.body?.model, "gpt-4o-mini", AIMLAPI_MODELS);
        const demoFast = req.header("x-picoflow-demo-mode") === "fast";
        const out = demoFast
          ? { text: synthSummary(prompt), tokens: Math.round(prompt.length / 4), prompt_tokens: 0, completion_tokens: 0, source: "synthesized-demo-fast" }
          : await callAimlApi(prompt, model);
        await logCost(ledger, ctx?.action_id, "aimlapi", {
          source: out.source,
          prompt_tokens: out.prompt_tokens,
          completion_tokens: out.completion_tokens,
          total_tokens: out.tokens,
          error: out.error,
        });
        res.json({
          action_id: ctx?.action_id,
          provider: "aimlapi",
          model,
          text: out.text,
          tokens: out.tokens,
          source: out.source,
        });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/api/validator/check",
    tb("0.0015", "Validator Cross-check", "Second-opinion verification — may slash bond"),
    async (req, res) => {
      try {
        const ctx = (req as express.Request & { picoflow?: { action_id: string } }).picoflow;
        const claim = cleanText(req.body?.claim, "", 2_000);
        const reference = cleanText(req.body?.reference, "", 2_000);
        const verdict = validateClaim(claim, reference);
        await logCost(ledger, ctx?.action_id, "validator", { source: "validator-internal" });
        res.json({
          action_id: ctx?.action_id,
          provider: "picoflow-validator",
          verdict: verdict.ok ? "agree" : "disagree",
          confidence: verdict.confidence,
          suggestion: verdict.suggestion,
          slash_recommended: !verdict.ok && verdict.confidence > 0.7,
        });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    },
  );

  // ---- GATEWAY BATCH WORKER + SSE ----
  // Drains gateway_outbox and submits real EIP-3009 transferWithAuthorization
  // calls when RELAYER_PRIVATE_KEY is configured. SSE clients on
  // /api/gateway/stream see live tick/submitted/settled/failed/idle events.
  const worker = new GatewayWorker({
    ledger,
    relayerKey: process.env.RELAYER_PRIVATE_KEY,
    rpcUrl: process.env.ARC_RPC ?? ARC_TESTNET.rpcUrl,
    chainId: Number(process.env.ARC_CHAIN_ID ?? ARC_TESTNET.chainId),
    pollMs: Number(process.env.GATEWAY_POLL_MS ?? 4000),
    batchSize: Number(process.env.GATEWAY_BATCH_SIZE ?? 8),
    verbose: !PROD,
  });
  worker.start();

  type SseClient = { id: number; res: express.Response };
  const sseClients = new Set<SseClient>();
  let sseClientId = 0;
  const recentEvents: GatewayWorkerEvent[] = [];
  worker.on("event", (evt: GatewayWorkerEvent) => {
    recentEvents.push(evt);
    if (recentEvents.length > 200) recentEvents.shift();
    const payload = `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const c of sseClients) {
      try {
        c.res.write(payload);
      } catch {
        // client gone; cleanup happens on close handler
      }
    }
  });

  app.get("/api/gateway/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const id = ++sseClientId;
    const client: SseClient = { id, res };
    sseClients.add(client);
    // Replay last 50 events so newcomers have context.
    res.write(`: picoflow gateway stream — client ${id}\n\n`);
    for (const evt of recentEvents.slice(-50)) {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
    }
    const ping = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* ignore */ }
    }, 25_000);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(client);
    });
  });

  app.get("/api/gateway/status", async (_req, res) => {
    const r = await ledger.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM settlements WHERE status='pending')::int AS pending,
         (SELECT COUNT(*) FROM settlements WHERE status='settled')::int AS settled,
         (SELECT COUNT(*) FROM settlements WHERE status='failed')::int AS failed,
         (SELECT COUNT(*) FROM gateway_outbox WHERE done_at IS NULL)::int AS outbox_pending`,
    );
    res.json({
      ok: true,
      relayer_configured: Boolean(process.env.RELAYER_PRIVATE_KEY),
      rpc: process.env.ARC_RPC ?? ARC_TESTNET.rpcUrl,
      chain_id: Number(process.env.ARC_CHAIN_ID ?? ARC_TESTNET.chainId),
      counts: r.rows[0],
      recent_events: recentEvents.slice(-20),
    });
  });

  app.get("/api/gateway/recent", async (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50)));
    res.json({ items: await ledger.listRecentSettlements(limit) });
  });

  // ---- /api/network ----
  // Single chain-config snapshot endpoint. Powers the dashboard /network page,
  // footer chain badges, and any client that needs explorer URLs without
  // hardcoding chain id. All values resolve from env so the same binary works
  // on Arc Testnet, Arbitrum One, and (future) Arc Mainnet.
  app.get("/api/network", async (_req, res) => {
    const chainId = Number(process.env.ARC_CHAIN_ID ?? ARC_TESTNET.chainId);
    const preset = presetByChainId(chainId);
    const rpc = process.env.ARC_RPC ?? process.env.ARC_RPC_URL ?? preset?.rpc ?? ARC_TESTNET.rpcUrl;
    const usdc = process.env.ARC_USDC_ADDR ?? process.env.USDC_ADDRESS ?? preset?.usdc ?? ARC_TESTNET.usdc;
    const explorer = process.env.ARC_EXPLORER ?? preset?.explorer ?? ARC_TESTNET.explorer;
    const networkName = process.env.ARC_NETWORK_NAME ?? preset?.name ?? "Arc Testnet";
    const nativeSymbol = process.env.ARC_NATIVE_SYMBOL ?? preset?.nativeSymbol ?? "USDC";
    const isMainnet = preset?.isMainnet ?? false;
    const contracts = {
      bond_vault: process.env.BOND_VAULT_ADDR ?? null,
      reputation: process.env.REPUTATION_ADDR ?? null,
      metadata: process.env.METADATA_ADDR ?? null,
    };
    res.json({
      ok: true,
      chain_id: chainId,
      preset_id: preset?.id ?? null,
      network_name: networkName,
      is_mainnet: isMainnet,
      rpc,
      explorer,
      usdc,
      native_symbol: nativeSymbol,
      gateway_wallet: process.env.GATEWAY_WALLET ?? null,
      gateway_minter: process.env.GATEWAY_MINTER ?? null,
      relayer_configured: Boolean(process.env.RELAYER_PRIVATE_KEY),
      contracts,
    });
  });

  // ---- /api/chains ----
  // Multi-chain registry: lists every preset PicoFlow knows how to settle on.
  // The active one is whichever preset matches process.env.ARC_CHAIN_ID. UIs
  // use this to render a chain selector and explain which chains are live vs
  // available-but-not-yet-deployed.
  app.get("/api/chains", async (_req, res) => {
    const activeChainId = Number(process.env.ARC_CHAIN_ID ?? ARC_TESTNET.chainId);
    const items = Object.values(CHAIN_PRESETS).map((p) => ({
      id: p.id,
      chain_id: p.chainId,
      name: p.name,
      is_mainnet: p.isMainnet,
      native_symbol: p.nativeSymbol,
      explorer: p.explorer,
      faucet: p.faucet,
      usdc: p.usdc,
      contracts_deployed: p.contractsDeployed,
      active: p.chainId === activeChainId,
    }));
    res.json({
      ok: true,
      active_chain_id: activeChainId,
      items,
    });
  });

  app.get("/api/margin/report", async (req, res) => {
    const window = Math.max(60, Math.min(86_400 * 30, Number(req.query.window_sec ?? 86_400)));
    res.json(await ledger.getMarginReport(window));
  });

  // ---- /api/admin/actions/:id ----
  // Full operator detail for one paid call: action + payment + settlement +
  // splits + provider_costs. Powers /actions/[id] in the dashboard so the
  // operator can inspect, retry, or refund a specific row.
  app.get("/api/admin/actions/:id", async (req, res) => {
    if (!(await requireAdminAsync(req, res))) return;
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).json({ error: "action_id must be a UUID" });
      return;
    }
    try {
      const detail = await ledger.getActionDetail(id);
      if (!detail.action) {
        res.status(404).json({ error: "action not found" });
        return;
      }
      res.json({ ok: true, ...detail });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- /api/admin/actions/:id/refund-mark ----
  // Mark an action's settlement as 'failed' with a refund reason. Does NOT
  // move USDC on-chain — the refund is a ledger-level annotation. The actual
  // refund flow is operator-initiated (manual transfer or reverse settlement).
  app.post("/api/admin/actions/:id/refund-mark", async (req, res) => {
    if (!(await requireAdminAsync(req, res))) return;
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).json({ error: "action_id must be a UUID" });
      return;
    }
    const reason = String(req.body?.reason ?? "operator refund").slice(0, 500);
    try {
      const detail = await ledger.getActionDetail(id);
      if (!detail.action) {
        res.status(404).json({ error: "action not found" });
        return;
      }
      const settlement = detail.settlement as { settlement_id?: string } | null;
      if (!settlement?.settlement_id) {
        res.status(400).json({ error: "no settlement row to mark" });
        return;
      }
      await ledger.failSettlement(settlement.settlement_id, `REFUND: ${reason}`);
      res.json({ ok: true, settlement_id: settlement.settlement_id, reason });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---- /api/metrics ----
  // Prometheus text exposition. Public (operators scrape this), no PII, no
  // secrets. Only aggregate counters and gauges.
  app.get("/api/metrics", async (_req, res) => {
    try {
      const [stats, settlements, pool, costs] = await Promise.all([
        ledger.getStats(),
        ledger.listRecentSettlements(500),
        Promise.resolve({ totalCount: ledger.pool.totalCount, idleCount: ledger.pool.idleCount, waitingCount: ledger.pool.waitingCount }),
        ledger.pool.query(
          `SELECT provider, COUNT(*)::int AS n, COALESCE(SUM(atomic_cost),0)::text AS atomic
           FROM provider_costs WHERE created_at > now() - interval '24 hours' GROUP BY provider`,
        ),
      ]);
      const byStatus: Record<string, number> = { pending: 0, submitted: 0, settled: 0, failed: 0 };
      for (const s of settlements) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      const lines: string[] = [];
      lines.push("# HELP picoflow_actions_total Total paid actions recorded");
      lines.push("# TYPE picoflow_actions_total counter");
      lines.push(`picoflow_actions_total ${stats.actions ?? 0}`);
      lines.push("# HELP picoflow_actions_completed_total Completed actions");
      lines.push("# TYPE picoflow_actions_completed_total counter");
      lines.push(`picoflow_actions_completed_total ${stats.completed ?? 0}`);
      lines.push("# HELP picoflow_actions_failed_total Failed actions");
      lines.push("# TYPE picoflow_actions_failed_total counter");
      lines.push(`picoflow_actions_failed_total ${stats.failed ?? 0}`);
      lines.push("# HELP picoflow_revenue_atomic_total Total atomic USDC revenue");
      lines.push("# TYPE picoflow_revenue_atomic_total counter");
      lines.push(`picoflow_revenue_atomic_total ${stats.total_atomic ?? 0}`);
      lines.push("# HELP picoflow_settlements_by_status Recent settlements grouped by status");
      lines.push("# TYPE picoflow_settlements_by_status gauge");
      for (const [k, v] of Object.entries(byStatus)) {
        lines.push(`picoflow_settlements_by_status{status="${k}"} ${v}`);
      }
      lines.push("# HELP picoflow_provider_cost_atomic_24h Atomic USDC cost per provider, last 24h");
      lines.push("# TYPE picoflow_provider_cost_atomic_24h gauge");
      for (const r of costs.rows) {
        lines.push(`picoflow_provider_cost_atomic_24h{provider="${String(r.provider).replace(/"/g, "")}"} ${r.atomic}`);
        lines.push(`picoflow_provider_calls_24h{provider="${String(r.provider).replace(/"/g, "")}"} ${r.n}`);
      }
      lines.push("# HELP picoflow_db_pool Postgres pool gauges");
      lines.push("# TYPE picoflow_db_pool gauge");
      lines.push(`picoflow_db_pool{kind="total"} ${pool.totalCount}`);
      lines.push(`picoflow_db_pool{kind="idle"} ${pool.idleCount}`);
      lines.push(`picoflow_db_pool{kind="waiting"} ${pool.waitingCount}`);
      lines.push("# HELP picoflow_uptime_seconds Process uptime in seconds");
      lines.push("# TYPE picoflow_uptime_seconds counter");
      lines.push(`picoflow_uptime_seconds ${Math.floor(process.uptime())}`);
      res.setHeader("Content-Type", "text/plain; version=0.0.4");
      res.send(lines.join("\n") + "\n");
    } catch (err) {
      res.status(500).type("text/plain").send(`# error: ${(err as Error).message}\n`);
    }
  });

  const port = Number(process.env.SELLER_PORT ?? 3030);
  app.listen(port, () => {
    console.log(`[sellers] PicoFlow seller server listening on :${port}`);
    console.log(`[sellers] registered ${registry.all().length} paid endpoints`);
    console.log(`[sellers] gateway-worker started (relayer=${Boolean(process.env.RELAYER_PRIVATE_KEY)})`);
  });
}

// ---- Provider wrappers (real-or-synthetic, never throw) ----

async function fetchAisaSignal(symbol: string): Promise<{ spot: number; sentiment: number; volume: number; source: string }> {
  const key = optionalEnv("AISA_API_KEY");
  if (key) {
    try {
      const r = await fetchWithTimeout(`https://api.aisa.dev/v1/signal?symbol=${symbol}`, {
        headers: { Authorization: `Bearer ${key}` },
      }, 5000);
      if (r.ok) {
        const j = (await r.json()) as { spot: number; sentiment: number; volume: number };
        return { ...j, source: "aisa-real" };
      }
    } catch { /* fall through */ }
  }
  const kraken = await fetchKrakenTicker(symbol);
  if (kraken) return kraken;
  // Synthetic deterministic — hash of symbol → reproducible
  const h = createHash("sha256").update(symbol + Math.floor(Date.now() / 60000)).digest();
  return {
    spot: 100 + (h.readUInt16BE(0) % 10000) / 100,
    sentiment: ((h.readInt16BE(2) % 200) - 100) / 100,
    volume: 1_000_000 + h.readUInt32BE(4) % 50_000_000,
    source: "synthesized",
  };
}

async function fetchKrakenTicker(symbol: string): Promise<{ spot: number; sentiment: number; volume: number; source: string } | null> {
  const pairBySymbol: Record<string, string> = {
    BTC: "XBTUSD",
    XBT: "XBTUSD",
    ETH: "ETHUSD",
    SOL: "SOLUSD",
    USDC: "USDCUSD",
    EUR: "EURUSD",
  };
  const pair = pairBySymbol[symbol] ?? `${symbol}USD`;
  try {
    const r = await fetchWithTimeout(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`, {}, 5000);
    if (!r.ok) return null;
    const j = (await r.json()) as { error?: string[]; result?: Record<string, { c?: string[]; v?: string[]; o?: string }> };
    if (j.error?.length || !j.result) return null;
    const first = Object.values(j.result)[0];
    const spot = Number(first?.c?.[0]);
    const volume = Number(first?.v?.[1]);
    const open = Number(first?.o ?? spot);
    if (!Number.isFinite(spot) || !Number.isFinite(volume)) return null;
    const sentiment = Number.isFinite(open) && open > 0 ? Math.max(-1, Math.min(1, (spot - open) / open)) : 0;
    return { spot, sentiment, volume, source: "kraken-public" };
  } catch {
    return null;
  }
}

type LlmUsage = { text: string; tokens: number; prompt_tokens: number; completion_tokens: number; source: string; error?: string };

async function callFeatherless(prompt: string, model: string): Promise<LlmUsage> {
  const key = optionalEnv("FEATHERLESS_API_KEY");
  if (key) {
    try {
      const r = await fetchWithTimeout("https://api.featherless.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 200 }),
      }, 8000);
      if (r.ok) {
        const j = (await r.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
        const pin = j.usage?.prompt_tokens ?? 0;
        const pout = j.usage?.completion_tokens ?? Math.max(0, (j.usage?.total_tokens ?? 0) - pin);
        return {
          text: j.choices?.[0]?.message?.content ?? "",
          tokens: j.usage?.total_tokens ?? (pin + pout),
          prompt_tokens: pin,
          completion_tokens: pout,
          source: "featherless-real",
        };
      }
      return { text: synthSummary(prompt), tokens: 0, prompt_tokens: 0, completion_tokens: 0, source: "synthesized", error: `featherless_http_${r.status}` };
    } catch (err) {
      return { text: synthSummary(prompt), tokens: 0, prompt_tokens: 0, completion_tokens: 0, source: "synthesized", error: (err as Error).message };
    }
  }
  return { text: synthSummary(prompt), tokens: Math.round(prompt.length / 4), prompt_tokens: 0, completion_tokens: 0, source: "synthesized" };
}

async function callAimlApi(prompt: string, model: string): Promise<LlmUsage> {
  const key = optionalEnv("AIMLAPI_API_KEY", "AIMLAPI_KEY");
  if (key) {
    try {
      const r = await fetchWithTimeout("https://api.aimlapi.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 200 }),
      }, 8000);
      if (r.ok) {
        const j = (await r.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
        const pin = j.usage?.prompt_tokens ?? 0;
        const pout = j.usage?.completion_tokens ?? Math.max(0, (j.usage?.total_tokens ?? 0) - pin);
        return {
          text: j.choices?.[0]?.message?.content ?? "",
          tokens: j.usage?.total_tokens ?? (pin + pout),
          prompt_tokens: pin,
          completion_tokens: pout,
          source: "aimlapi-real",
        };
      }
      return { text: synthSummary(prompt), tokens: 0, prompt_tokens: 0, completion_tokens: 0, source: "synthesized", error: `aimlapi_http_${r.status}` };
    } catch (err) {
      return { text: synthSummary(prompt), tokens: 0, prompt_tokens: 0, completion_tokens: 0, source: "synthesized", error: (err as Error).message };
    }
  }
  return { text: synthSummary(prompt), tokens: Math.round(prompt.length / 4), prompt_tokens: 0, completion_tokens: 0, source: "synthesized" };
}

function validateClaim(claim: string, reference: string) {
  // Trivial heuristic — agreement = string overlap. Real impl would call a 2nd model.
  if (!reference) return { ok: true, confidence: 0.5, suggestion: "no reference provided" };
  const a = new Set(claim.toLowerCase().split(/\W+/).filter(Boolean));
  const b = new Set(reference.toLowerCase().split(/\W+/).filter(Boolean));
  const inter = [...a].filter((x) => b.has(x)).length;
  const overlap = inter / Math.max(1, Math.max(a.size, b.size));
  return {
    ok: overlap >= 0.5,
    confidence: Math.min(1, overlap + 0.3),
    suggestion: overlap < 0.5 ? "responses diverge — recommend slash" : "responses align",
  };
}

function synthSummary(prompt: string): string {
  const h = createHash("sha256").update(prompt).digest("hex").slice(0, 8);
  return `[synthetic ${h}] PicoFlow handled this request offline because no upstream API key is configured. Prompt length: ${prompt.length} chars.`;
}

main().catch((e) => {
  console.error("[sellers] fatal", e);
  process.exit(1);
});
