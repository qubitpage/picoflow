import Link from "next/link";
import { NetworkTabs } from "@/app/components/NetworkTabs";
import { ProofArtifacts } from "@/app/components/ProofArtifacts";
import { fetchChains, isNetworkSelected, networkName, normalizeNetwork, parsePage } from "@/lib/chains";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RegistryItem = { network_id: number; route: string; seller_label: string; price_human: string; method: string; count: string; revenue_atomic: string };

function fmt(atomic: string) {
  return (Number(atomic || 0) / 1e6).toFixed(6);
}

export default async function RegistryPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const selectedNetwork = normalizeNetwork(params.network);
  const page = parsePage(params.page);
  const pageSize = 20;
  let items: RegistryItem[] = [];
  try {
    const r = await db.query<RegistryItem>(`
      SELECT network_id, route, seller_label, MAX(price_human) AS price_human, MAX(method) AS method,
             COUNT(*)::text AS count, COALESCE(SUM(price_atomic)::text, '0') AS revenue_atomic
      FROM actions
      GROUP BY network_id, route, seller_label
      ORDER BY COUNT(*) DESC, SUM(price_atomic) DESC NULLS LAST
    `);
    items = r.rows;
  } catch { /* db not ready */ }
  const chains = (await fetchChains())?.items ?? [];
  const filtered = items.filter((i) => isNetworkSelected(i.network_id, selectedNetwork, chains));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const countFor = (network: string) => items.filter((i) => isNetworkSelected(i.network_id, network, chains)).reduce((a, i) => a + Number(i.count), 0);
  const counts: Record<string, string> = {
    all: String(countFor("all")),
    mainnet: String(countFor("mainnet")),
    testnet: String(countFor("testnet")),
  };
  for (const item of items) counts[String(item.network_id)] = String((Number(counts[String(item.network_id)] ?? 0) + Number(item.count)));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Capability Registry</h1>
      <p className="text-ink/70 max-w-2xl">
        Every paid endpoint discovered by buyer agents, split by connected network. Quotes are signed with x402 challenges,
        recorded in the ledger, and settled as Arbitrum One real-funds proof or Arc Testnet rehearsal until Arc Mainnet launches.
      </p>
      {chains.length > 0 ? (
        <NetworkTabs basePath="/registry" selected={selectedNetwork} chains={chains} counts={counts} title="Registry network tabs" note="The registry is dynamic: when a new chain is added to /api/chains, it becomes a tab here without hardcoded UI changes." />
      ) : null}
      <ProofArtifacts title="Registry proof anchors" />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
            <tr><th className="py-2">Network</th><th>Method</th><th>Route</th><th>Seller</th><th>Price (USDC)</th><th># Calls</th><th>Revenue</th></tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={7} className="py-4 text-ink/50">No endpoints recorded for this network view yet.</td></tr>
            ) : paged.map((i) => (
              <tr key={`${i.network_id}:${i.route}:${i.seller_label}`} className="border-t border-ink/5">
                <td className="py-2 text-xs text-ink/60">{networkName(i.network_id, chains)}</td>
                <td className="font-mono text-xs">{i.method}</td>
                <td className="font-mono text-xs">{i.route}</td>
                <td>{i.seller_label}</td>
                <td>{i.price_human}</td>
                <td>{i.count}</td>
                <td className="font-mono text-xs">{fmt(i.revenue_atomic)} USDC</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/registry?network=${encodeURIComponent(selectedNetwork)}&page=${Math.max(1, page - 1)}`}>Previous</Link>
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/registry?network=${encodeURIComponent(selectedNetwork)}&page=${Math.min(totalPages, page + 1)}`}>Next</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
