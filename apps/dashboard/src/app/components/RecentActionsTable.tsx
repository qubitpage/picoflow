"use client";
import { useMemo, useState } from "react";

export type RecentAction = {
  action_id: string;
  created_at: string | Date;
  route: string;
  seller_label: string;
  price_human: string;
  status: string;
  latency_ms: number | null;
  network_id: number;
  network_name: string;
  tx_hash: string | null;
  tx_href: string | null;
  settlement_status: string | null;
};

function short(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

const PAGE = 25;

/**
 * Paginated table of recent paid actions. Pure client-side pagination over
 * a server-fetched window (default ≤ 250 rows). For multi-thousand-row
 * windows, swap to a server-streamed cursor.
 */
export function RecentActionsTable({ rows }: { rows: RecentAction[] }) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter(
      (r) =>
        r.route.toLowerCase().includes(q) ||
        r.seller_label.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.network_name.toLowerCase().includes(q) ||
        String(r.network_id).includes(q) ||
        (r.tx_hash ?? "").toLowerCase().includes(q),
    );
  }, [rows, filter]);

  if (rows.length === 0) {
    return (
      <p className="text-ink/50 text-sm">
        No paid actions yet — run <span className="kbd">npm run demo</span>.
      </p>
    );
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <input
          type="text"
          placeholder="filter route / seller / status / network / tx…"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
          className="text-sm px-2 py-1 border border-ink/10 rounded w-64 max-w-full"
        />
        <span className="text-xs text-ink/50">
          {filtered.length} of {rows.length} rows
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2">When</th>
              <th>Network</th>
              <th>Seller</th>
              <th>Route</th>
              <th>Price (USDC)</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Tx / action</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={`${safePage}-${i}`} className="border-t border-ink/5">
                <td className="py-2 font-mono text-xs">
                  {new Date(r.created_at).toISOString().slice(11, 19)}
                </td>
                <td>
                  <div>{r.network_name}</div>
                  <div className="font-mono text-[10px] text-ink/40">{r.network_id}</div>
                </td>
                <td>{r.seller_label}</td>
                <td className="font-mono text-xs">{r.route}</td>
                <td>{r.price_human}</td>
                <td>
                  <span
                    className={
                      r.status === "completed"
                        ? "text-emerald"
                        : r.status === "legacy_synthetic"
                          ? "text-ink/40"
                          : "text-amber"
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td>{r.latency_ms ? `${r.latency_ms}ms` : "—"}</td>
                <td className="font-mono text-xs">
                  {r.tx_hash ? (
                    r.tx_href ? <a href={r.tx_href} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{short(r.tx_hash)}</a> : <span title="Ledger proof or pending settlement hash">{short(r.tx_hash)}</span>
                  ) : (
                    <a href={`/actions/${r.action_id}`} className="text-indigo hover:underline">action {short(r.action_id)}</a>
                  )}
                  {r.settlement_status ? <div className="text-[10px] text-ink/40">{r.settlement_status}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-ink/60">
        <span>
          Page <strong>{safePage + 1}</strong> / {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-2 py-1 rounded border border-ink/10 disabled:opacity-30"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="px-2 py-1 rounded border border-ink/10 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
