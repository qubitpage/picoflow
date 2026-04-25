/**
 * Recent on-chain settlements panel — server component. Reads the last few
 * settlement rows that have a tx_hash and links them to the active block
 * explorer. Lets a non-technical user click straight from the dashboard to a
 * real Arbiscan / Basescan / Etherscan tx and verify "yes, real money moved".
 */
import { db } from "@/lib/db";
import { isTxHash, shortHash, txLink } from "@/lib/proofLinks";

const SELLER_BASE = process.env.SELLER_BASE ?? "http://sellers:3030";

interface NetworkInfo {
  ok: boolean;
  chain_id: number;
  network_name: string;
  is_mainnet: boolean;
  explorer: string;
}
type Row = {
  settlement_id: string;
  status: string;
  tx_hash: string | null;
  created_at: Date;
  amount_atomic: string | null;
  network_id: number | null;
};

async function fetchExplorer(): Promise<NetworkInfo | null> {
  try {
    const r = await fetch(`${SELLER_BASE}/api/network`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as NetworkInfo;
  } catch { return null; }
}

async function load(): Promise<Row[]> {
  try {
    const r = await db.query<Row>(`
            SELECT s.settlement_id::text, s.status, s.tx_hash, s.created_at,
              COALESCE(a.price_atomic::text, '0') AS amount_atomic,
              a.network_id
      FROM settlements s
      LEFT JOIN payments p ON p.payment_id = s.payment_id
      LEFT JOIN actions a ON a.action_id = p.action_id
      WHERE s.tx_hash IS NOT NULL
      ORDER BY s.created_at DESC
      LIMIT 10
    `);
    return r.rows;
  } catch {
    return [];
  }
}

export async function RecentSettlements() {
  const [rows, net] = await Promise.all([load(), fetchExplorer()]);
  return (
    <section className="card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-semibold">On-chain settlements</h2>
          <p className="text-xs text-ink/60">
            Real txs broadcast by the gateway worker on{" "}
            <span className="font-semibold">{net?.network_name ?? "the active chain"}</span>.
            Click any hash to verify on the explorer.
          </p>
        </div>
        <a href="/network" className="text-xs text-indigo hover:underline">
          chain config →
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/50">
          No on-chain settlements yet — make a paid call to populate this panel.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-ink/50">
              <tr>
                <th className="text-left py-2">When</th>
                <th className="text-left py-2">Status</th>
                <th className="text-right py-2">Amount (USDC)</th>
                <th className="text-left py-2">Tx hash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ts = r.created_at instanceof Date ? r.created_at : new Date(r.created_at);
                const amt = (Number(r.amount_atomic ?? "0") / 1e6).toFixed(6);
                const tx = r.tx_hash ?? "";
                const networkId = Number(r.network_id ?? net?.chain_id ?? 42161);
                const linkable = isTxHash(tx);
                const shortTx = tx ? shortHash(tx) : "—";
                return (
                  <tr key={r.settlement_id} className="border-t border-ink/5">
                    <td className="py-2 font-mono text-xs">{ts.toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "settled" ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">{amt}</td>
                    <td className="py-2">
                      {tx && linkable ? (
                        <a
                          href={txLink(networkId, tx)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-indigo hover:underline"
                        >
                          {shortTx} ↗
                        </a>
                      ) : tx ? <span className="font-mono text-xs text-ink/60" title="Ledger-only hash, not linked to an explorer transaction">{shortTx}</span> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
