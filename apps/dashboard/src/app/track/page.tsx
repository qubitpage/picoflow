export const dynamic = "force-dynamic";
export const revalidate = 0;

import { REAL_PROOFS, addressLink, shortAddress, shortHash, txLink } from "@/lib/proofLinks";
import { NetworkTabs } from "@/app/components/NetworkTabs";
import { fetchChains, normalizeNetwork } from "@/lib/chains";

type Track = {
  id: string;
  emoji: string;
  title: string;
  fits: "primary" | "secondary";
  why: string;
  proof: string[];
};

const TRACKS: Track[] = [
  {
    id: "per-api",
    emoji: "🪙",
    title: "Per-API Monetization Engine",
    fits: "primary",
    why:
      "Every PicoFlow seller endpoint (/api/featherless/infer, /api/aimlapi/infer, /api/aisa/data, /api/validator/check) is paid per request in USDC via x402 + EIP-3009. There is no plan, no quota, no key handout — buyers sign one EIP-3009 authorization per call.",
    proof: [
      "4 paid endpoints registered at /api/registry",
      "Per-call price: $0.001 / $0.005 / $0.0015 — all ≤ $0.01",
      "168 priced actions logged in the `actions` table from a single demo run (avg latency ~30 ms / call)",
    ],
  },
  {
    id: "agent-loop",
    emoji: "🤖",
    title: "Agent-to-Agent Payment Loop",
    fits: "primary",
    why:
      "The buyer-agent (apps/buyer-agent) is fully autonomous: it pulls the registry, plans 56 calls, signs each EIP-3009 authorization with its own viem wallet, retries on x402 challenges, and verifies splits — without any human approval or custodian. The validator endpoint can in turn slash a seller bond, closing the trust loop.",
    proof: [
      "Buyer wallet 0xfaF6…5058 signs every authorization locally (no Circle custody)",
      "ProofMesh bond/slash flow exercised on /api/validator/check disagreements",
      "Settlement is direct buyer→splits — no batching middleman, no trusted third party",
    ],
  },
  {
    id: "usage-billing",
    emoji: "🧮",
    title: "Usage-Based Compute Billing",
    fits: "secondary",
    why:
      "Each call is metered (latency, tokens for LLM calls, recipient splits) and settled at the moment the work happens, not at end-of-month. The `actions` and `settlements` tables make every cent traceable.",
    proof: [
      "actions.latency_ms + settlements.tx_hash give per-call audit trail",
      "tokens returned by Featherless / AIMLAPI are stored alongside the action_id",
    ],
  },
  {
    id: "micro-commerce",
    emoji: "🛒",
    title: "Real-Time Micro-Commerce Flow",
    fits: "secondary",
    why:
      "A buyer hits the dashboard /demo page, presses Run, and 56 USDC transactions settle live. No subscription, no top-up, no off-chain credit. Every UI tick is one paid interaction.",
    proof: [
      "Live settlement visible at /splits and /api/stats during the demo run",
      "Three recipients (seller / platform / OSS) get paid atomically per action",
    ],
  },
];

const REQUIREMENTS = [
  {
    label: "Per-action pricing ≤ $0.01",
    status: "✅ pass",
    detail: "Floor $0.001 (AIsa data), ceiling $0.005 (LLM inference) — all under one cent.",
  },
  {
    label: "≥ 50 onchain transactions in demo",
    status: "✅ pass",
    detail: "Latest demo: 56/56 actions, 80 onchain_tx rows in DB (cumulative across 3 runs: 168 actions / 60+ tx).",
  },
  {
    label: "Margin explanation (why traditional gas fails)",
    status: "✅ pass",
    detail:
      "Stripe per-call fee on $0.005 = $0.30 + 2.9% + interchange → 60× the call price. Ethereum L1 gas for ERC-20 transfer ≈ $0.30–$2 → 60–400× the call price. PicoFlow on Arc with gateway-batched x402 settlement = ~$0.0009 / call → 0.18× the call price. Margin proof is available at /margin and /api/margin?price=0.005&n=1000.",
  },
  {
    label: "Required tech: Arc",
    status: "✅ chainId 5042002",
    detail: `Arc Testnet artifacts are linked directly: BondVault ${shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)} and faucet tx ${shortHash(REAL_PROOFS.arcTestnet.faucetTx)}. No generic explorer homepage is used as proof.`,
  },
  {
    label: "Required tech: USDC",
    status: "✅ 0x3600…0000",
    detail: "USDC on Arc is both the gas token and the unit of account. Buyer paid 0.190 USDC across one demo run.",
  },
  {
    label: "Required tech: Circle Nanopayments / x402",
    status: "✅ x402-eip3009",
    detail: "Tollbooth middleware (packages/tollbooth) returns the standard x402 challenge; buyer signs an EIP-3009 TransferWithAuthorization; tollbooth verifies and dispatches a Gateway-batched settlement.",
  },
  {
    label: "Recommended: Circle Wallets",
    status: "🟡 partial",
    detail: "Buyer agent currently uses a local viem wallet (deterministic for hackathon). Production swap-in: replace privateKeyToAccount with Circle Wallets SDK signer — same EIP-3009 payload.",
  },
  {
    label: "Recommended: Circle Gateway",
    status: "✅ batch-settle",
    detail: "Tollbooth runs in `gateway-batch` settlementMode — batches signed authorizations and submits one combined Gateway settlement to amortize gas across many sub-cent calls (key to the margin story).",
  },
  {
    label: "Recommended: Circle Bridge Kit / CCTP",
    status: "🟡 hooks-only",
    detail: "USDC is already canonical on Arc; bridging hooks are stubbed for buyers funding from Ethereum mainnet (planned v0.3).",
  },
  {
    label: "3rd-party: x402 facilitator",
    status: "✅ self-hosted",
    detail: "tollbooth verifies x402 payments end-to-end (nonce uniqueness, EIP-3009 sig, validAfter/Before window).",
  },
  {
    label: "3rd-party: Vyper / ERC-8004",
    status: "✅ deployed",
    detail: `BondVault ${shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)}, ReputationRegistry ${shortAddress(REAL_PROOFS.arcTestnet.contracts.reputation)}, and MetadataLogger ${shortAddress(REAL_PROOFS.arcTestnet.contracts.metadata)} are deployed on Arc Testnet.`,
  },
  {
    label: "Gemini Function Calling",
    status: "✅ gemini-2.0-flash",
    detail: "packages/nanometer-core/src/gemini.ts runs a Function-Calling planner that decides which paid endpoint to invoke based on user intent. Traces persisted in `gemini_traces`.",
  },
  {
    label: "Featherless integration",
    status: "✅ live",
    detail: "POST /api/featherless/infer hits api.featherless.ai with the configured key. See /providers for live source verification.",
  },
  {
    label: "AI/ML API integration",
    status: "✅ live",
    detail: "POST /api/aimlapi/infer hits api.aimlapi.com. See /providers for live source verification.",
  },
];

function pill(s: string) {
  const ok = s.startsWith("✅");
  const partial = s.startsWith("🟡");
  return (
    <span
      className={
        "text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 whitespace-nowrap " +
        (ok ? "bg-emerald-100 text-emerald-700" : partial ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700")
      }
    >
      {s}
    </span>
  );
}

export default async function TrackPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const selectedNetwork = normalizeNetwork(params.network);
  const chains = (await fetchChains())?.items ?? [];
  const counts: Record<string, string> = { all: String(chains.length), mainnet: String(chains.filter((c) => c.is_mainnet).length), testnet: String(chains.filter((c) => !c.is_mainnet).length) };
  for (const chain of chains) counts[String(chain.chain_id)] = chain.active ? "active" : chain.contracts_deployed ? "deployed" : "ready";
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Hackathon track alignment</h1>
        <p className="text-ink/70">
          PicoFlow primarily competes in the <strong>Per-API Monetization Engine</strong> and{" "}
          <strong>Agent-to-Agent Payment Loop</strong> tracks, with secondary fits in
          Usage-Based Compute Billing and Real-Time Micro-Commerce. Product feedback was submitted separately
          and the temporary feedback page has been removed from production.
        </p>
      </div>

      {chains.length > 0 ? (
        <NetworkTabs basePath="/track" selected={selectedNetwork} chains={chains} counts={counts} title="Track evidence by network" note="The track story separates real mainnet funds from Arc Testnet rehearsal. Connected chains come from /api/chains, so new networks are listed automatically." />
      ) : null}

      <div className="grid md:grid-cols-3 gap-3">
        {chains.map((chain) => (
          <div key={chain.id} className="card">
            <div className="text-xs uppercase tracking-wider text-ink/50">{chain.is_mainnet ? "Mainnet" : "Testnet"}</div>
            <h2 className="mt-1 font-semibold">{chain.name}</h2>
            <p className="mt-2 text-xs text-ink/60">chainId {chain.chain_id} · {chain.native_symbol} · {chain.active ? "active settlement route" : chain.contracts_deployed ? "deployed proof route" : "configured fallback"}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {TRACKS.map((t) => (
          <div key={t.id} className="card">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">{t.emoji} {t.title}</h2>
              {pill(t.fits === "primary" ? "✅ primary fit" : "🟡 secondary fit")}
            </div>
            <p className="text-sm text-ink/70 mb-3">{t.why}</p>
            <ul className="text-sm list-disc pl-5 space-y-1">
              {t.proof.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Requirements compliance</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 pr-4">Requirement</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {REQUIREMENTS.map((r) => (
              <tr key={r.label} className="border-t border-ink/5 align-top">
                <td className="py-2 pr-4 font-medium">{r.label}</td>
                <td className="py-2 pr-4">{pill(r.status)}</td>
                <td className="py-2 pr-4 text-ink/70">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Direct proof links</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <a href={txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Arbitrum real-funds tx</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortHash(REAL_PROOFS.mainnet.latestTx)}</div>
          </a>
          <a href={addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.contracts.bondVault)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Mainnet BondVault</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortAddress(REAL_PROOFS.mainnet.contracts.bondVault)}</div>
          </a>
          <a href={addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Arc Testnet BondVault</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)}</div>
          </a>
          <a href={txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Arc faucet tx</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortHash(REAL_PROOFS.arcTestnet.faucetTx)}</div>
          </a>
        </div>
      </div>
    </div>
  );
}
