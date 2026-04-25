import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { NetworkBadge } from "./components/NetworkBadge";
import { REAL_PROOFS, addressLink, shortAddress, shortHash, txLink } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  other: {
    "base:app_id": "69eca5f48502c283edbf948e",
  },
};

type LandingStats = {
  actions: string;
  completed: string;
  revenue_atomic: string;
  provider_cost_atomic: string;
  settlements: string;
  proof_events: string;
};

const EMPTY_STATS: LandingStats = {
  actions: "0",
  completed: "0",
  revenue_atomic: "0",
  provider_cost_atomic: "0",
  settlements: "0",
  proof_events: "0",
};

async function loadLandingStats(): Promise<LandingStats> {
  try {
    const r = await db.query<LandingStats>(`
      SELECT
        (SELECT COUNT(*)::text FROM actions) AS actions,
        (SELECT COUNT(*)::text FROM actions WHERE status='completed') AS completed,
        COALESCE((SELECT SUM(price_atomic)::text FROM actions WHERE status='completed'), '0') AS revenue_atomic,
        COALESCE((SELECT SUM(atomic_cost)::text FROM provider_costs), '0') AS provider_cost_atomic,
        (SELECT COUNT(*)::text FROM settlements) AS settlements,
        (SELECT COUNT(*)::text FROM onchain_tx) AS proof_events
    `);
    return r.rows[0] ?? EMPTY_STATS;
  } catch {
    return EMPTY_STATS;
  }
}

function usdc(atomic: string): string {
  return (Number(atomic || 0) / 1e6).toFixed(6);
}

export default async function LandingPage() {
  const [user, stats] = await Promise.all([getCurrentUser(), loadLandingStats()]);
  const proofCards = [
    {
      title: "Real money proof today",
      eyebrow: "Arbitrum One · chainId 42161",
      body:
        "The public demo is live on Arbitrum One with real USDC rails, public addresses, ledger rows, and explorer links. It is the production-style proof that the same PicoFlow accounting works with real funds.",
      links: [
        ["Real USDC tx", txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx), shortHash(REAL_PROOFS.mainnet.latestTx)],
        ["USDC", addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.usdc), shortAddress(REAL_PROOFS.mainnet.usdc)],
      ],
    },
    {
      title: "Arc path proven safely",
      eyebrow: "Arc Testnet · chainId 5042002",
      body:
        "Arc is still testnet, so we use it honestly: contracts, USDC-gas behavior, ProofMesh events, and settlement semantics are rehearsed there without pretending test funds are mainnet money.",
      links: [
        ["BondVault", addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault), shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)],
        ["Faucet tx", txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx), shortHash(REAL_PROOFS.arcTestnet.faucetTx)],
      ],
    },
    {
      title: "Arc Mainnet ready",
      eyebrow: "Drop-in once Circle publishes it",
      body:
        "The app is chain-configured: same API keys, same ledger state machine, same Gateway batch worker, and same Vyper contracts can be redeployed when Arc Mainnet becomes available.",
      links: [
        ["Mainnet contract", addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.contracts.bondVault), shortAddress(REAL_PROOFS.mainnet.contracts.bondVault)],
        ["Arc contract", addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault), shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)],
      ],
    },
  ];
  const providerFlow = [
    "Customer sends a normal HTTPS request with a PicoFlow API key.",
    "PicoFlow checks org quota, computes the USDC price, and records the action.",
    "Gemini plans when a task needs routing; Featherless, AI/ML API, AIsa/Kraken, and validators perform the paid work.",
    "Provider cost, margin, settlement status, splits, and ProofMesh evidence are written to the ledger.",
    "The response returns headers such as x-pf-action-id, so anyone can inspect the exact proof row.",
  ];
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="card text-center py-12">
        <NetworkBadge />
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight max-w-3xl mx-auto">
          Charge <span className="text-indigo">$0.000001</span> per API call.
          <br />
          Get paid in USDC. No card processor. No invoicing.
        </h1>
        <p className="text-ink/70 mt-4 max-w-2xl mx-auto text-lg">
          PicoFlow wraps agent APIs with USDC-native metering. Every request gets a ledger proof,
          provider-cost row, settlement state, and revenue-split trail.
        </p>
        <p className="text-ink/60 mt-3 max-w-3xl mx-auto text-sm leading-relaxed">
          Arbitrum One is the live real-funds example today. Arc Testnet proves
          the sponsor-specific execution path while Arc Mainnet is not public yet.
          When Arc Mainnet launches, PicoFlow switches by chain configuration and
          redeployed contracts, not by rewriting the product.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          {user ? (
            <Link href="/account" className="btn btn-primary">
              Open your account →
            </Link>
          ) : (
            <>
              <Link href="/signup" className="btn btn-primary">
                Create a free account
              </Link>
              <Link href="/login" className="btn">
                Sign in
              </Link>
            </>
          )}
          <Link href="/dashboard" className="btn">
            See the live ledger
          </Link>
        </div>
        <p className="text-xs text-ink/50 mt-4">
          Free tier: 100,000 calls / month. No card on file. Live on Arbitrum
          One mainnet today (real USDC); Arc Mainnet drop-in ready.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8 max-w-4xl mx-auto text-left">
          {[
            ["Paid actions", stats.actions, "ledger rows"],
            ["Completed", stats.completed, "successful calls"],
            ["USDC billed", `$${usdc(stats.revenue_atomic)}`, "measured revenue"],
            ["Provider costs", `$${usdc(stats.provider_cost_atomic)}`, "recorded cost rows"],
          ].map(([label, value, help]) => (
            <div key={label} className="rounded-2xl border border-ink/10 bg-cream/70 p-4 shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold">{label}</div>
              <div className="text-2xl font-semibold mt-1">{value}</div>
              <div className="text-xs text-ink/50 mt-1">{help}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        {proofCards.map((card) => (
          <div key={card.title} className="card">
            <div className="text-[11px] uppercase tracking-wider text-indigo font-semibold">
              {card.eyebrow}
            </div>
            <h2 className="text-xl font-semibold mt-2">{card.title}</h2>
            <p className="text-sm text-ink/70 mt-2 leading-relaxed">{card.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {card.links.map(([label, href, value]) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="rounded-full border border-ink/15 bg-ink/[0.02] px-3 py-1 text-xs text-indigo hover:underline">
                  {label}: <span className="font-mono">{value}</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-indigo font-semibold">
              Plain-English concept
            </div>
            <h2 className="text-2xl font-semibold mt-2">A toll meter for APIs</h2>
            <p className="text-ink/70 mt-3 leading-relaxed">
              Imagine every API call has a tiny meter like electricity: one call,
              one transparent price, one proof that it happened. PicoFlow lets a
              seller expose an AI/data endpoint, lets a buyer pay with USDC per
              call, and lets both sides verify the result without invoices,
              prepaid credits, or a card processor that makes sub-cent pricing
              impossible.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/docs" className="btn btn-primary">Read the docs</Link>
              <Link href="/network" className="btn">Compare networks</Link>
              <Link href="/providers" className="btn">Provider status</Link>
            </div>
          </div>
          <ol className="space-y-2">
            {providerFlow.map((step, i) => (
              <li key={step} className="flex gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
                <span className="h-7 w-7 shrink-0 rounded-full bg-indigo text-cream text-xs font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-sm text-ink/70 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* How it works in 60 seconds */}
      <section>
        <div className="text-center mb-6">
          <h2 className="text-2xl font-semibold">How it works in 60 seconds</h2>
          <p className="text-ink/60 text-sm mt-1">
            Five steps. No blockchain knowledge required.
          </p>
        </div>
        <ol className="grid md:grid-cols-5 gap-4">
          {[
            {
              n: 1,
              t: "Sign up",
              d: "Email + password. We create your org instantly. Free 100k calls/month.",
            },
            {
              n: 2,
              t: "Mint an API key",
              d: "One click. We show your secret once. Format: pf_<prefix>_<secret>.",
            },
            {
              n: 3,
              t: "Add Bearer header",
              d: "Drop the key into your existing fetch / axios / curl call. That's it.",
            },
            {
              n: 4,
              t: "We meter & bill",
              d: "Each call records a USDC price. We sign EIP-3009 authorizations off-chain.",
            },
            {
              n: 5,
              t: "Settle + prove",
              d: "Today: real-funds mainnet proof on Arbitrum One. Arc Testnet: sponsor-native rehearsal. Arc Mainnet: drop-in target.",
            },
          ].map((s) => (
            <li key={s.n} className="card">
              <div className="w-8 h-8 rounded-full bg-indigo text-cream flex items-center justify-center font-semibold text-sm mb-2">
                {s.n}
              </div>
              <div className="font-semibold">{s.t}</div>
              <p className="text-xs text-ink/60 mt-1 leading-relaxed">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Code sample */}
      <section className="card">
        <h2 className="text-xl font-semibold mb-2">It looks exactly like a normal API call</h2>
        <p className="text-ink/60 text-sm mb-4">
          The only thing that changes is one HTTP header. No SDK to install.
          Your code stays the same.
        </p>
        <pre className="bg-ink/5 rounded-lg p-4 overflow-x-auto text-xs leading-relaxed font-mono">
      {`$auth = "Bearer $env:PICOFLOW_API_KEY"
      curl https://picoflow.qubitpage.com/api/featherless/infer \\
        -H "Authorization: $auth" \\
  -H "content-type: application/json" \\
  -d '{"model":"mistralai/Mistral-Nemo-Instruct-2407","prompt":"Hello"}'

# Response includes:
#   x-pf-action-id    - your meter row, look it up in the ledger
#   x-pf-price-usdc   - exactly what was charged ($0.0005)
#   x-pf-batch-id     - which settlement batch this is in`}
        </pre>
      </section>

      {/* Why bother */}
      <section className="grid md:grid-cols-3 gap-4">
        {[
          {
            t: "Card fees kill sub-cent pricing",
            d: "Stripe charges $0.30 + 2.9 %. Your $0.001 API call would lose $0.299. PicoFlow's per-call cost is $0.000009.",
          },
          {
            t: "No KYC, no prepaid credits",
            d: "Your agent customers don't open accounts. They authorize a USDC amount per call, signed in their wallet.",
          },
          {
            t: "Open ledger, real proof",
            d: "Every call appears in our public ledger. Every settlement has an Arc tx hash. No vendor lock-in.",
          },
        ].map((b) => (
          <div key={b.t} className="card">
            <div className="font-semibold">{b.t}</div>
            <p className="text-sm text-ink/70 mt-2 leading-relaxed">{b.d}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section className="card">
        <h2 className="text-xl font-semibold mb-4">Pricing — no surprises</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border border-ink/10 rounded-xl p-4">
            <div className="text-sm font-semibold uppercase tracking-wider text-ink/50">Free</div>
            <div className="text-3xl font-semibold mt-1">$0</div>
            <div className="text-xs text-ink/60 mt-1">100,000 calls / month</div>
            <ul className="text-xs text-ink/70 mt-3 space-y-1 list-disc pl-4">
              <li>Public ledger</li>
              <li>Arc Testnet settlement</li>
              <li>Community support</li>
            </ul>
          </div>
          <div className="border-2 border-indigo rounded-xl p-4 bg-indigo/5">
            <div className="text-sm font-semibold uppercase tracking-wider text-indigo">Growth</div>
            <div className="text-3xl font-semibold mt-1">2 %</div>
            <div className="text-xs text-ink/60 mt-1">of revenue settled, no fixed fee</div>
            <ul className="text-xs text-ink/70 mt-3 space-y-1 list-disc pl-4">
              <li>10M calls / month included</li>
              <li>Mainnet Arc settlement</li>
              <li>Email support, 24h SLA</li>
            </ul>
          </div>
          <div className="border border-ink/10 rounded-xl p-4">
            <div className="text-sm font-semibold uppercase tracking-wider text-ink/50">Enterprise</div>
            <div className="text-3xl font-semibold mt-1">Talk to us</div>
            <div className="text-xs text-ink/60 mt-1">custom volume + SLA</div>
            <ul className="text-xs text-ink/70 mt-3 space-y-1 list-disc pl-4">
              <li>Dedicated gateway worker</li>
              <li>Private chain support</li>
              <li>On-call engineering</li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="card text-center">
        <h2 className="text-2xl font-semibold">Ready to charge your first cent?</h2>
        <p className="text-ink/60 mt-2">Sign up takes 30 seconds. Mint a key, paste it into your code, you're billing.</p>
        <div className="mt-4 flex justify-center gap-3">
          {user ? (
            <Link href="/account" className="btn btn-primary">Go to your account</Link>
          ) : (
            <Link href="/signup" className="btn btn-primary">Create a free account</Link>
          )}
        </div>
      </section>
    </div>
  );
}
