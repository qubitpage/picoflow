import { headers } from "next/headers";
import { NetworkTabs } from "@/app/components/NetworkTabs";
import { ProofArtifacts } from "@/app/components/ProofArtifacts";
import { fetchChains } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Probe = {
  name: string;
  endpoint: string;
  price_usdc: string;
  key_present: boolean;
  source: string;
  latency_ms: number;
  sample: string;
  ok: boolean;
};
type StatusPayload = { ts: number; probes: Probe[] };

async function load(): Promise<StatusPayload> {
  try {
    // Server-side fetch — must use absolute URL. Inside the container, sellers is reachable
    // at http://sellers:3030. Outside, we'd hit https://picoflow.qubitpage.com/api.
    const base = process.env.SELLER_BASE ?? "http://sellers:3030";
    const r = await fetch(`${base}/api/providers/status`, { cache: "no-store" });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return (await r.json()) as StatusPayload;
  } catch {
    return { ts: Date.now(), probes: [] };
  }
}

function badge(ok: boolean, label: string) {
  return (
    <span
      className={
        "text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 " +
        (ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800")
      }
    >
      {label}
    </span>
  );
}

export default async function ProvidersPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await headers(); // force dynamic
  const params = (await searchParams) ?? {};
  const selectedNetwork = (Array.isArray(params.network) ? params.network[0] : params.network) ?? "all";
  const [data, chainsResp] = await Promise.all([load(), fetchChains()]);
  const chains = chainsResp?.items ?? [];
  const counts: Record<string, string> = { all: String(chains.length), mainnet: String(chains.filter((c) => c.is_mainnet).length), testnet: String(chains.filter((c) => !c.is_mainnet).length) };
  for (const chain of chains) counts[String(chain.chain_id)] = chain.active ? "active" : chain.contracts_deployed ? "deployed" : "ready";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">AI Providers — live status</h1>
        <p className="text-ink/70">
          Each row is a paid endpoint exposed by PicoFlow. We probe the upstream provider
          live (one tiny prompt) and show whether the integration is hitting the real API
          (<code className="kbd">-real</code> source), a real public data fallback
          (<code className="kbd">kraken-public</code>), or the deterministic emergency fallback
          (<code className="kbd">synthesized</code>).
        </p>
      </div>

      {chains.length > 0 ? (
        <NetworkTabs basePath="/providers" selected={selectedNetwork} chains={chains} counts={counts} title="Provider settlement networks" note="Providers are chain-independent; settlement routing is dynamic. Arbitrum One is the current live real-funds proof, Arc Testnet is the sponsor-native rehearsal, and future connected networks appear automatically." />
      ) : null}

      <ProofArtifacts title="Provider settlement proof anchors" />

      <div className="grid md:grid-cols-3 gap-3">
        {chains.map((chain) => (
          <div key={chain.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{chain.name}</h2>
              <span className={(chain.is_mainnet ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800") + " rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider"}>{chain.is_mainnet ? "mainnet" : "testnet"}</span>
            </div>
            <p className="mt-2 text-xs text-ink/60">chainId {chain.chain_id} · {chain.native_symbol} · {chain.active ? "active seller routing" : chain.contracts_deployed ? "contracts deployed" : "configured"}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2 pr-4">Paid endpoint</th>
              <th className="py-2 pr-4">Price / call</th>
              <th className="py-2 pr-4">Key</th>
              <th className="py-2 pr-4">Source</th>
              <th className="py-2 pr-4">Latency</th>
              <th className="py-2 pr-4">Sample reply</th>
            </tr>
          </thead>
          <tbody>
            {data.probes.map((p) => (
              <tr key={p.endpoint} className="border-t border-ink/5 align-top">
                <td className="py-2 pr-4 font-medium">{p.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{p.endpoint}</td>
                <td className="py-2 pr-4 font-mono">${p.price_usdc}</td>
                <td className="py-2 pr-4">{badge(p.key_present, p.key_present ? "configured" : "n/a")}</td>
                <td className="py-2 pr-4">{badge(p.ok, p.source)}</td>
                <td className="py-2 pr-4 font-mono">{p.latency_ms} ms</td>
                <td className="py-2 pr-4 text-ink/70 max-w-md break-words">{p.sample || "—"}</td>
              </tr>
            ))}
            {data.probes.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-ink/50">
                  Provider status endpoint unreachable.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">Featherless</h2>
          <p className="text-sm text-ink/70">
            Open-model inference gateway used by the <code>/api/featherless/infer</code> seller endpoint.
            Pricing is flat <strong>$0.005 / call</strong>, authorized with x402 + EIP-3009 and routed to the active USDC network.
            Today the real-funds public proof is Arbitrum One; Arc Testnet proves the Arc-native path.
            Featherless gives PicoFlow access to a wide catalog of specialized models (coding, medical,
            multilingual) without us hosting any GPUs — perfect for an agentic marketplace where buyers
            shop by capability, not provider.
          </p>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">AI/ML API</h2>
          <p className="text-sm text-ink/70">
            OpenAI-compatible aggregator (Gemini, Claude, GPT, etc.) used by{" "}
            <code>/api/aimlapi/infer</code>. Same flat <strong>$0.005 / call</strong> pricing.
            Lets PicoFlow route a single buyer prompt to whichever frontier model is cheapest /
            fastest while keeping one billing surface: USDC per action, independent of the selected connected network.
          </p>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">AIsa data ($0.001)</h2>
          <p className="text-sm text-ink/70">
            Premium real-time data slot (price + sentiment per symbol). If an AIsa production key
            is configured, PicoFlow uses it directly; otherwise it falls back to live Kraken public
            market data before using the deterministic emergency synthesizer. Demonstrates the{" "}
            <strong>≤ $0.01</strong> requirement at the floor without pretending a missing AIsa key exists.
          </p>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold mb-2">Validator ($0.0015)</h2>
          <p className="text-sm text-ink/70">
            PicoFlow&apos;s in-house verifier. A buyer can pay $0.0015 to cross-check a paid AI
            reply; on disagreement the validator can recommend slashing the seller&apos;s bond
            (ProofMesh, Phase 7 / ERC-8004 trust layer).
          </p>
        </div>
      </div>
    </div>
  );
}
