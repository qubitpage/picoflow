import Link from "next/link";
import { NetworkTabs } from "@/app/components/NetworkTabs";
import { ProofArtifacts } from "@/app/components/ProofArtifacts";
import { fetchChains, isNetworkSelected, networkName, normalizeNetwork, parsePage } from "@/lib/chains";
import { db } from "@/lib/db";
import { addressLink, isAddress } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SplitRow = {
  network_id: number;
  recipient_addr: string;
  seller_label: string;
  count: string;
  total_atomic: string;
  avg_bps: string;
};

type Totals = { network_id: number; recipient_addr: string; grand_atomic: string };
type NetworkStat = { network_id: number; split_rows: string; actions: string; total_atomic: string };

async function load(): Promise<{ rows: SplitRow[]; totals: Totals[]; networkStats: NetworkStat[]; grandTotal: bigint }> {
  let rows: SplitRow[] = [];
  let totals: Totals[] = [];
  let networkStats: NetworkStat[] = [];
  try {
    rows = (await db.query<SplitRow>(`
      SELECT COALESCE(a.network_id, 0) AS network_id,
             s.recipient_addr,
             COALESCE(a.seller_label, '(unknown)') AS seller_label,
             COUNT(*)::text AS count,
             SUM(s.amount_atomic)::text AS total_atomic,
             ROUND(AVG(s.bps))::text AS avg_bps
      FROM splits s
      LEFT JOIN actions a ON a.action_id = s.action_id
      GROUP BY COALESCE(a.network_id, 0), s.recipient_addr, a.seller_label
      ORDER BY SUM(s.amount_atomic) DESC
      LIMIT 1000
    `)).rows;
    totals = (await db.query<Totals>(`
      SELECT COALESCE(a.network_id, 0) AS network_id, s.recipient_addr, SUM(s.amount_atomic)::text AS grand_atomic
      FROM splits s
      LEFT JOIN actions a ON a.action_id = s.action_id
      GROUP BY COALESCE(a.network_id, 0), s.recipient_addr
      ORDER BY SUM(amount_atomic) DESC
    `)).rows;
    networkStats = (await db.query<NetworkStat>(`
      SELECT COALESCE(a.network_id, 0) AS network_id,
             COUNT(*)::text AS split_rows,
             COUNT(DISTINCT s.action_id)::text AS actions,
             COALESCE(SUM(s.amount_atomic)::text, '0') AS total_atomic
      FROM splits s
      LEFT JOIN actions a ON a.action_id = s.action_id
      GROUP BY COALESCE(a.network_id, 0)
      ORDER BY SUM(s.amount_atomic) DESC NULLS LAST
    `)).rows;
  } catch { /* db not ready */ }
  const grandTotal = totals.reduce((a, t) => a + BigInt(t.grand_atomic), 0n);
  return { rows, totals, networkStats, grandTotal };
}

function fmt(atomic: string | bigint) {
  return (Number(atomic) / 1e6).toFixed(6);
}
function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function SplitsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const selectedNetwork = normalizeNetwork(params.network);
  const page = parsePage(params.page);
  const pageSize = 25;
  const [{ rows, totals, networkStats, grandTotal }, chainsResp] = await Promise.all([load(), fetchChains()]);
  const chains = chainsResp?.items ?? [];
  const filteredRows = rows.filter((r) => isNetworkSelected(r.network_id, selectedNetwork, chains));
  const filteredTotals = totals.filter((t) => isNetworkSelected(t.network_id, selectedNetwork, chains));
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const selectedTotal = filteredTotals.reduce((a, t) => a + BigInt(t.grand_atomic), 0n);
  const max = filteredTotals[0] ? Number(filteredTotals[0].grand_atomic) : 1;
  const counts = Object.fromEntries(networkStats.map((s) => [String(s.network_id), s.split_rows]));
  counts.all = String(networkStats.reduce((a, s) => a + Number(s.split_rows), 0));
  counts.mainnet = String(networkStats.filter((s) => isNetworkSelected(s.network_id, "mainnet", chains)).reduce((a, s) => a + Number(s.split_rows), 0));
  counts.testnet = String(networkStats.filter((s) => isNetworkSelected(s.network_id, "testnet", chains)).reduce((a, s) => a + Number(s.split_rows), 0));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Revenue splits</h1>
        <p className="text-ink/70">Atomic 80/10/10 split per paid action, grouped by network, recipient, and seller. New chains from /api/chains appear automatically in the tabs.</p>
      </div>

      {chains.length > 0 ? (
        <NetworkTabs basePath="/splits" selected={selectedNetwork} chains={chains} counts={counts} title="Split network view" note="Use All for the full ledger, Mainnets for real-funds settlement, Testnets for Arc rehearsal, or pick an individual connected chain." />
      ) : null}

      <ProofArtifacts title="Split proof anchors" />

      <div className="grid md:grid-cols-3 gap-3">
        {networkStats.map((s) => (
          <div key={s.network_id} className="card">
            <div className="text-xs uppercase tracking-wider text-ink/50">{networkName(s.network_id, chains)}</div>
            <div className="font-mono text-2xl mt-1">{fmt(s.total_atomic)} <span className="text-ink/50 text-sm">USDC</span></div>
            <div className="text-xs text-ink/60 mt-2">{s.actions} actions · {s.split_rows} split rows</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-ink/50">Selected total</div>
          <div className="font-mono text-2xl">{fmt(selectedTotal)} <span className="text-ink/50 text-sm">USDC</span></div>
          <div className="text-xs text-ink/50 mt-1">All-time ledger: {fmt(grandTotal)} USDC</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-ink/50">Recipients</div>
          <div className="font-mono text-2xl">{filteredTotals.length}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-ink/50">Split rows</div>
          <div className="font-mono text-2xl">{filteredRows.length}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Recipient totals</h2>
        <ul className="space-y-2">
          {filteredTotals.map((t) => (
            <li key={`${t.network_id}:${t.recipient_addr}`} className="flex items-center gap-3">
              <span className="w-32 truncate text-xs text-ink/50">{networkName(t.network_id, chains)}</span>
              <span className="font-mono text-xs w-32 truncate" title={t.recipient_addr}>
                {isAddress(t.recipient_addr) ? <a href={addressLink(t.network_id, t.recipient_addr)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{short(t.recipient_addr)}</a> : short(t.recipient_addr)}
              </span>
              <span className="flex-1 h-2 bg-ink/5 rounded overflow-hidden">
                <span
                  className="block h-full bg-indigo"
                  style={{ width: `${Math.min(100, (Number(t.grand_atomic) / Math.max(1, max)) * 100)}%` }}
                />
              </span>
              <span className="font-mono text-xs w-28 text-right">{fmt(t.grand_atomic)} USDC</span>
            </li>
          ))}
          {filteredTotals.length === 0 ? <li className="text-ink/50 text-sm">No splits yet for this network view — run the demo.</li> : null}
        </ul>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Recipient × seller breakdown</h2>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-ink/50">
            <tr>
              <th className="text-left py-2">Network</th>
              <th className="text-left">Recipient</th>
              <th className="text-left">Seller</th>
              <th className="text-right">Count</th>
              <th className="text-right">Avg bps</th>
              <th className="text-right">Total USDC</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((r, i) => (
              <tr key={`${r.network_id}:${r.recipient_addr}:${r.seller_label}:${i}`} className="border-t border-ink/5">
                <td className="py-2 text-xs text-ink/60">{networkName(r.network_id, chains)}</td>
                <td className="font-mono text-xs" title={r.recipient_addr}>{isAddress(r.recipient_addr) ? <a href={addressLink(r.network_id, r.recipient_addr)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{short(r.recipient_addr)}</a> : short(r.recipient_addr)}</td>
                <td>{r.seller_label}</td>
                <td className="text-right font-mono">{r.count}</td>
                <td className="text-right font-mono">{r.avg_bps}</td>
                <td className="text-right font-mono">{fmt(r.total_atomic)}</td>
              </tr>
            ))}
            {pagedRows.length === 0 ? (
              <tr><td colSpan={6} className="py-6 text-center text-ink/50">No data yet.</td></tr>
            ) : null}
          </tbody>
        </table>
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/splits?network=${encodeURIComponent(selectedNetwork)}&page=${Math.max(1, page - 1)}`}>Previous</Link>
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/splits?network=${encodeURIComponent(selectedNetwork)}&page=${Math.min(totalPages, page + 1)}`}>Next</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
