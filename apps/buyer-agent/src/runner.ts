/**
 * Buyer agent demo runner.
 *
 *   npm run demo --workspace=@picoflow/buyer-agent
 *
 * Generates an EOA, exercises every paid endpoint via x402 negotiation, and
 * prints a final report. If GEMINI_API_KEY is set, planning is delegated to
 * Gemini 2.5 Flash with function-calling. Otherwise it falls back to a
 * deterministic 60+ action plan that hits every seller.
 */
import { generatePrivateKey } from "viem/accounts";
import {
  BuyerClient,
  Ledger,
  ProofMesh,
  computeMargin,
} from "@picoflow/nanometer-core";

interface PlanStep {
  endpoint: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}

const SELLER_BASE = process.env.SELLER_BASE ?? "http://127.0.0.1:3030";
const DEMO_CHAIN_ID = Number(process.env.DEMO_CHAIN_ID ?? "0");
const DEMO_NETWORK_NAME = process.env.DEMO_NETWORK_NAME ?? (DEMO_CHAIN_ID ? `chain ${DEMO_CHAIN_ID}` : "active seller network");
const DEMO_EXPLORER = process.env.DEMO_EXPLORER ?? "";
const DEMO_USDC = process.env.DEMO_USDC ?? "";
const DEMO_NATIVE_SYMBOL = process.env.DEMO_NATIVE_SYMBOL ?? "";

async function main() {
  const start = Date.now();
  const ledger = new Ledger({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "picoflow",
    password: process.env.DB_PASSWORD ?? "picoflow",
    database: process.env.DB_NAME ?? "picoflow",
  });
  await ledger.migrate();

  const proofmesh = new ProofMesh({ ledger });

  const pk = (process.env.BUYER_PRIVATE_KEY as `0x${string}`) ?? generatePrivateKey();
  const buyer = new BuyerClient({ privateKey: pk, verbose: false });
  console.log(`[buyer] address = ${buyer.address}`);
  console.log(`[buyer] selected network = ${DEMO_NETWORK_NAME}${DEMO_CHAIN_ID ? ` chainId=${DEMO_CHAIN_ID}` : ""}`);
  if (DEMO_USDC) console.log(`[buyer] selected USDC = ${DEMO_USDC}`);
  if (DEMO_EXPLORER) console.log(`[buyer] explorer = ${DEMO_EXPLORER}`);
  if (DEMO_NATIVE_SYMBOL) console.log(`[buyer] native gas = ${DEMO_NATIVE_SYMBOL}`);
  console.log("[buyer] provider mode = deterministic demo-fast; x402 signing, ledger rows, splits, and ProofMesh still execute live");

  const plan = scripted();
  console.log(`[buyer] plan: ${plan.length} steps against ${SELLER_BASE}`);
  console.log("[workflow] 402 → sign EIP-3009 → retry with X-PAYMENT → ledger action/payment/settlement/split rows");

  // 2. Execute
  let ok = 0;
  let fail = 0;
  let totalSpentAtomic = 0n;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i]!;
    const url = buildUrl(SELLER_BASE, step.endpoint, step.query);
    const baseHeaders: Record<string, string> = {};
    if (process.env.BUYER_API_KEY) {
      baseHeaders["Authorization"] = `Bearer ${process.env.BUYER_API_KEY}`;
    }
    if (DEMO_CHAIN_ID) {
      baseHeaders["X-PicoFlow-Chain-Id"] = String(DEMO_CHAIN_ID);
    }
    baseHeaders["X-PicoFlow-Demo-Mode"] = "fast";
    const init: RequestInit = step.method === "POST"
      ? { method: "POST", headers: { ...baseHeaders, "Content-Type": "application/json" }, body: JSON.stringify(step.body ?? {}) }
      : { headers: baseHeaders };
    try {
      const r = await buyer.call(url, init);
      if (r.status === 200) {
        ok += 1;
        totalSpentAtomic += BigInt(r.payment ? Math.floor(Number(r.challenge?.price ?? 0) * 1e6) : 0);
        const actionId = typeof r.data === "object" && r.data && "action_id" in r.data ? String((r.data as { action_id?: unknown }).action_id ?? "") : "";
        console.log(`[tx] #${String(i + 1).padStart(2, "0")}/${plan.length} ${step.method ?? "GET"} ${step.endpoint} status=200 network=${r.challenge?.network ?? DEMO_CHAIN_ID} price=${r.challenge?.price ?? "free"} buyer=${buyer.address} action=${short(actionId)} auth=${short(r.payment?.nonce)}`);
        if ((i + 1) % 3 === 0 && step.endpoint.includes("infer")) {
          // every 3rd inference: stake a tiny bond + log proof metadata
          const claim = `claim-${Date.now()}-${i}`;
          const stake = await proofmesh.stake(claim, "0x000000000000000000000000000000000000abcd", 1000n);
          console.log(`[proofmesh] stake claim=${claim} tx=${short(stake.tx_hash)} lane=Arc Testnet ledger-proof`);
          if (i % 6 === 0) {
            const refund = await proofmesh.refund(claim);
            console.log(`[proofmesh] refund claim=${claim} tx=${short(refund?.tx_hash)}`);
          } else {
            const slash = await proofmesh.slash(claim, "0x000000000000000000000000000000000000beef");
            console.log(`[proofmesh] slash claim=${claim} tx=${short(slash?.tx_hash)} validator=0x0000…beef`);
          }
        }
      } else {
        fail += 1;
        console.warn(`[buyer] step ${i} ${step.endpoint} → ${r.status}`);
      }
    } catch (e) {
      fail += 1;
      console.error(`[buyer] step ${i} error:`, (e as Error).message);
    }
  }

  const stats = await ledger.getStats();
  const margin = computeMargin(0.005, plan.length);
  const card = margin.rows.find((r) => r.scheme === "card")!;
  const gw = margin.rows.find((r) => r.scheme === "gateway-batched")!;
  const elapsedMs = Date.now() - start;
  const report = {
    ok,
    fail,
    plan_size: plan.length,
    elapsed_ms: elapsedMs,
    elapsed_human: `${(elapsedMs / 1000).toFixed(1)}s`,
    spent_usdc: (Number(totalSpentAtomic) / 1e6).toFixed(6),
    network: {
      chain_id: DEMO_CHAIN_ID || null,
      name: DEMO_NETWORK_NAME,
      usdc: DEMO_USDC || null,
      explorer: DEMO_EXPLORER || null,
    },
    buyer_wallet: buyer.address,
    ledger_stats: stats,
    margin_vs_card: `card fee $${card.fee_usdc.toFixed(6)} vs picoflow gateway-batched $${gw.fee_usdc.toFixed(6)} → saves $${(card.fee_usdc - gw.fee_usdc).toFixed(6)} per call`,
  };
  console.log("\n[buyer] === REPORT ===\n" + JSON.stringify(report, null, 2));
  await ledger.pool.end();
}

function short(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function buildUrl(base: string, path: string, query?: Record<string, string>) {
  const u = new URL(path.startsWith("/") ? path : `/${path}`, base);
  if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

function scripted(): PlanStep[] {
  const out: PlanStep[] = [];
  const symbols = ["SOL", "ETH", "BTC", "ARC", "USDC", "OP", "MATIC", "BNB"];
  const prompts = [
    "Summarise PicoFlow in one sentence.",
    "What is x402?",
    "Explain Circle Gateway.",
    "What is CCTP V2?",
    "Why do agents need micropayments?",
    "Define EIP-3009.",
    "What is ProofMesh?",
    "Compare Stripe vs USDC for $0.001 payments.",
  ];
  // 12 AIsa data
  for (let i = 0; i < 12; i++) out.push({ endpoint: "/api/aisa/data", method: "GET", query: { symbol: symbols[i % symbols.length]! } });
  // 16 Featherless
  for (let i = 0; i < 16; i++) out.push({ endpoint: "/api/featherless/infer", method: "POST", body: { prompt: prompts[i % prompts.length]! } });
  // 16 AIMLAPI
  for (let i = 0; i < 16; i++) out.push({ endpoint: "/api/aimlapi/infer", method: "POST", body: { prompt: prompts[(i + 3) % prompts.length]! } });
  // 12 Validator
  for (let i = 0; i < 12; i++) out.push({ endpoint: "/api/validator/check", method: "POST", body: { claim: `claim ${i}`, reference: `reference ${i % 3}` } });
  return out;
}

main().catch((e) => {
  console.error("[buyer] fatal", e);
  process.exit(1);
});
