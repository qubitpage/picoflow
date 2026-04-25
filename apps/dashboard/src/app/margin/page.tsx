import { computeMargin } from "@picoflow/nanometer-core";
import { NetworkTabs } from "@/app/components/NetworkTabs";
import { ProofArtifacts } from "@/app/components/ProofArtifacts";
import { fetchChains, isNetworkSelected, networkName, normalizeNetwork } from "@/lib/chains";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LiveMargin = {
  window_sec: number;
  revenue_atomic: string;
  cost_atomic: string;
  margin_atomic: string;
  margin_bps: number;
  by_provider: Array<{ provider: string; cost_atomic: string; calls: number }>;
};

type NetworkMargin = {
  network_id: number;
  calls: string;
  revenue_atomic: string;
  cost_atomic: string;
};

async function fetchLiveMargin(): Promise<LiveMargin | null> {
  // Same-origin server-side fetch. We're inside the Next dashboard container,
  // /api/* is proxied to the sellers process by nginx in prod and rewritten in
  // dev via next.config.mjs. Use the public origin so the proxy chain matches
  // what judges hit.
  const base = process.env.PICOFLOW_API_BASE ?? process.env.NEXT_PUBLIC_API_BASE ?? "https://picoflow.qubitpage.com";
  try {
    const r = await fetch(`${base}/api/margin/report?window_sec=86400`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as LiveMargin;
  } catch {
    return null;
  }
}

function fmtAtomicAsUsdc(atomic: string): string {
  const n = Number(atomic);
  if (!Number.isFinite(n)) return atomic;
  return (n / 1_000_000).toFixed(6);
}

async function loadNetworkMargins(): Promise<NetworkMargin[]> {
  try {
    const r = await db.query<NetworkMargin>(`
      WITH costs AS (
        SELECT action_id, SUM(atomic_cost) AS cost_atomic
        FROM provider_costs
        GROUP BY action_id
      )
      SELECT a.network_id,
             COUNT(*)::text AS calls,
             COALESCE(SUM(a.price_atomic)::text, '0') AS revenue_atomic,
             COALESCE(SUM(COALESCE(c.cost_atomic, 0))::text, '0') AS cost_atomic
      FROM actions a
      LEFT JOIN costs c ON c.action_id = a.action_id
      WHERE a.status = 'completed'
      GROUP BY a.network_id
      ORDER BY SUM(a.price_atomic) DESC NULLS LAST
    `);
    return r.rows;
  } catch {
    return [];
  }
}

export default async function MarginPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const selectedNetwork = normalizeNetwork(params.network);
  const [live, networkMargins, chainsResp] = await Promise.all([fetchLiveMargin(), loadNetworkMargins(), fetchChains()]);
  const chains = chainsResp?.items ?? [];
  const visibleMargins = networkMargins.filter((m) => isNetworkSelected(m.network_id, selectedNetwork, chains));
  const counts: Record<string, string> = {
    all: String(networkMargins.reduce((a, m) => a + Number(m.calls), 0)),
    mainnet: String(networkMargins.filter((m) => isNetworkSelected(m.network_id, "mainnet", chains)).reduce((a, m) => a + Number(m.calls), 0)),
    testnet: String(networkMargins.filter((m) => isNetworkSelected(m.network_id, "testnet", chains)).reduce((a, m) => a + Number(m.calls), 0)),
  };
  for (const m of networkMargins) counts[String(m.network_id)] = m.calls;
  const reports = [computeMargin(0.001, 1000), computeMargin(0.005, 1000), computeMargin(0.01, 1000)];
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold">Margin economics</h1>
      <p className="text-ink/70 max-w-2xl">
        Why nanopayments matter — at sub-cent prices, card processors cannot transact at the unit economics.
        PicoFlow shows live real-funds operation on Arbitrum One while Arc Testnet proves the USDC-gas target path for Arc Mainnet.
      </p>

      {chains.length > 0 ? (
        <NetworkTabs basePath="/margin" selected={selectedNetwork} chains={chains} counts={counts} title="Margin network tabs" note="Select All for the portfolio view or inspect each connected mainnet/testnet separately. New chains from /api/chains appear here automatically." />
      ) : null}

      <ProofArtifacts title="Margin proof anchors" />

      <section className="grid md:grid-cols-3 gap-4">
        {visibleMargins.map((m) => {
          const revenue = Number(m.revenue_atomic || 0);
          const cost = Number(m.cost_atomic || 0);
          const margin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
          return (
            <div key={m.network_id} className="card">
              <div className="text-xs uppercase tracking-wider text-ink/50">{networkName(m.network_id, chains)}</div>
              <div className="mt-2 font-mono text-2xl">{margin.toFixed(2)}%</div>
              <div className="mt-2 text-xs text-ink/60">{m.calls} completed calls</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-ink/50">Revenue</span><div className="font-mono">${fmtAtomicAsUsdc(m.revenue_atomic)}</div></div>
                <div><span className="text-ink/50">Cost</span><div className="font-mono">${fmtAtomicAsUsdc(m.cost_atomic)}</div></div>
              </div>
            </div>
          );
        })}
        {visibleMargins.length === 0 ? <div className="card text-sm text-ink/50">No completed calls recorded for this network view yet.</div> : null}
      </section>

      {live ? (
        <section className="card border-emerald/30">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">
              Live measured margin
              <span className="ml-3 text-emerald text-sm">last {Math.round(live.window_sec / 3600)}h</span>
            </h2>
            <span className="text-xs text-ink/50">source: <code>/api/margin/report</code> (real <code>provider_costs</code> rows)</span>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
            <div><div className="text-ink/60 text-xs uppercase">Revenue</div><div className="font-mono">${fmtAtomicAsUsdc(live.revenue_atomic)} USDC</div></div>
            <div><div className="text-ink/60 text-xs uppercase">Upstream cost</div><div className="font-mono">${fmtAtomicAsUsdc(live.cost_atomic)} USDC</div></div>
            <div><div className="text-ink/60 text-xs uppercase">Gross margin</div><div className="font-mono text-emerald">{(live.margin_bps / 100).toFixed(2)}%</div></div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
              <tr><th className="py-2">Provider</th><th>Calls</th><th>Cost (USDC)</th></tr>
            </thead>
            <tbody>
              {live.by_provider.map((p) => (
                <tr key={p.provider} className="border-t border-ink/5">
                  <td className="py-2">{p.provider}</td>
                  <td className="font-mono text-xs">{p.calls}</td>
                  <td className="font-mono text-xs">${fmtAtomicAsUsdc(p.cost_atomic)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-ink/50 mt-3">
            Honesty rule: rows tagged <code>source=synthesized</code> (fallback when an upstream key
            is missing) record <code>cost_atomic=0</code>, so margin reflects only calls that actually
            cost us money. Token-priced providers split prompt vs completion at the published rate
            cards (Featherless $0.10/1M, AI/ML API $0.15/$0.60 per 1M).
          </p>
        </section>
      ) : (
        <section className="card border-coral/30">
          <h2 className="text-lg font-semibold mb-2">Live measured margin unavailable</h2>
          <p className="text-sm text-ink/60">
            Could not reach <code>/api/margin/report</code>. Run a demo or hit a paid endpoint to
            populate <code>provider_costs</code>.
          </p>
        </section>
      )}

      {reports.map((rep) => (
        <section key={rep.price_usdc} className="card">
          <h2 className="text-lg font-semibold mb-3">
            Per-call price ${rep.price_usdc.toFixed(6)} USDC, {rep.n_calls.toLocaleString()} calls
            <span className="ml-3 text-emerald text-sm">best: {rep.best_scheme}</span>
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
              <tr><th className="py-2">Rail</th><th>Fee per call</th><th>Net per call</th><th>Margin %</th><th>Viable?</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {rep.rows.map((r) => (
                <tr key={r.scheme} className={`border-t border-ink/5 ${r.scheme === rep.best_scheme ? "bg-emerald/5" : ""}`}>
                  <td className="py-2">{r.scheme}</td>
                  <td className="font-mono text-xs">${r.fee_usdc.toFixed(6)}</td>
                  <td className="font-mono text-xs">${r.net_usdc.toFixed(6)}</td>
                  <td className="font-mono text-xs">{r.margin_pct.toFixed(1)}%</td>
                  <td>{r.viable ? <span className="text-emerald">yes</span> : <span className="text-coral">no</span>}</td>
                  <td className="text-xs text-ink/60">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
