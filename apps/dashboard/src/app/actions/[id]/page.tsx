/**
 * /actions/[id] — Per-action operator detail page.
 *
 * Shows the full ledger trail for one paid call: the action row, the
 * EIP-3009 payment authorization, the settlement state (pending /
 * submitted / settled / failed), the revenue splits, and every
 * provider_costs row that was charged against it.
 *
 * Admin-gated. Includes a "Mark refunded" form that flips the settlement
 * to `failed` with a `REFUND:` reason — purely a ledger annotation, the
 * actual on-chain reverse transfer is operator-initiated.
 *
 * Closes Round-1 P1: "Add action detail page with retry/refund/dispute
 * workflow."
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { addressLink, txLink } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SELLER_BASE = process.env.SELLER_BASE ?? "http://sellers:3030";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

type Detail = {
  ok: boolean;
  action: {
    action_id: string;
    created_at: string;
    route: string;
    method: string;
    buyer_addr: string;
    seller_label: string;
    seller_addr: string;
    price_atomic: string;
    price_human: string;
    asset_addr: string;
    network_id: number;
    status: string;
    result_hash: string | null;
    latency_ms: number | null;
    meta: Record<string, unknown>;
  } | null;
  payment: {
    payment_id: string;
    nonce: string;
    signature: string;
    valid_after: number;
    valid_before: number;
    scheme: string;
    verified_at: string | null;
    authorization_id: string | null;
  } | null;
  settlement: {
    settlement_id: string;
    mode: string;
    status: string;
    tx_hash: string | null;
    block_number: string | null;
    gateway_settlement_id: string | null;
    submitted_at: string | null;
    confirmed_at: string | null;
    error: string | null;
  } | null;
  splits: Array<{ recipient_addr: string; bps: number; amount_atomic: string; tx_hash: string | null }>;
  provider_costs: Array<{ provider: string; unit: string; units: string; atomic_cost: string; created_at: string }>;
};

async function loadDetail(id: string): Promise<{ data: Detail | null; error: string | null }> {
  if (!ADMIN_TOKEN) return { data: null, error: "ADMIN_TOKEN not set on dashboard env" };
  try {
    const r = await fetch(`${SELLER_BASE}/api/admin/actions/${id}`, {
      cache: "no-store",
      headers: { "x-admin-token": ADMIN_TOKEN },
    });
    if (r.status === 404) return { data: null, error: "action not found" };
    if (!r.ok) return { data: null, error: `upstream ${r.status}` };
    return { data: (await r.json()) as Detail, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

async function refundAction(formData: FormData): Promise<void> {
  "use server";
  const id = String(formData.get("action_id") ?? "");
  const reason = String(formData.get("reason") ?? "operator refund").slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await fetch(`${SELLER_BASE}/api/admin/actions/${id}/refund-mark`, {
    method: "POST",
    cache: "no-store",
    headers: { "x-admin-token": ADMIN_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  revalidatePath(`/actions/${id}`);
}

function statusBadge(status: string): string {
  switch (status) {
    case "settled":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40";
    case "submitted":
      return "bg-indigo/15 text-indigo border-indigo/40";
    case "failed":
      return "bg-coral/15 text-coral border-coral/40";
    case "pending":
    default:
      return "bg-amber-500/15 text-amber-700 border-amber-500/40";
  }
}

function explorerTxLink(chainId: number, txHash: string): string {
  return txLink(chainId, txHash);
}

function explorerAddrLink(chainId: number, addr: string): string {
  return addressLink(chainId, addr);
}

function usdc(atomic: string): string {
  return (Number(atomic) / 1e6).toFixed(6);
}

export default async function ActionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const allowed = await requireRole("admin");
  if (!allowed) redirect("/login?next=/actions&reason=admin_only");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return (
      <main className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">Invalid action id</h1>
        <p className="text-ink/60 text-sm">Expected a UUID.</p>
        <a className="btn" href="/admin">← Back to admin</a>
      </main>
    );
  }
  const { data, error } = await loadDetail(id);
  if (error || !data || !data.action) {
    return (
      <main className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">Action not found</h1>
        <p className="text-ink/60 text-sm">{error ?? "no row in ledger"}</p>
        <a className="btn" href="/admin">← Back to admin</a>
      </main>
    );
  }
  const a = data.action;
  const s = data.settlement;
  const totalCost = data.provider_costs.reduce((acc, r) => acc + Number(r.atomic_cost), 0);
  const margin = Number(a.price_atomic) - totalCost;
  const marginPct = Number(a.price_atomic) > 0 ? (margin / Number(a.price_atomic)) * 100 : 0;

  return (
    <main className="p-6 space-y-6 max-w-6xl mx-auto">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <a href="/admin" className="text-xs text-indigo hover:underline">← Admin cockpit</a>
          <h1 className="text-2xl font-bold mt-1">Action {a.action_id.slice(0, 8)}…</h1>
          <p className="text-ink/60 text-sm font-mono">{a.method} {a.route}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] px-2 py-1 rounded border font-bold uppercase tracking-wider ${a.status === "completed" ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/40" : "bg-amber-500/15 text-amber-700 border-amber-500/40"}`}>
            action: {a.status}
          </span>
          {s ? (
            <span className={`text-[11px] px-2 py-1 rounded border font-bold uppercase tracking-wider ${statusBadge(s.status)}`}>
              settlement: {s.status}
            </span>
          ) : (
            <span className="text-[11px] px-2 py-1 rounded border font-bold uppercase tracking-wider bg-ink/10 text-ink/60 border-ink/20">no settlement</span>
          )}
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Revenue" value={`$${usdc(a.price_atomic)}`} sub={`${a.price_atomic} atomic`} />
        <Stat label="Provider cost" value={`$${(totalCost / 1e6).toFixed(6)}`} sub={`${data.provider_costs.length} rows`} />
        <Stat label="Net margin" value={`$${(margin / 1e6).toFixed(6)}`} sub={`${marginPct.toFixed(2)}%`} tone={margin >= 0 ? "ok" : "bad"} />
        <Stat label="Latency" value={a.latency_ms != null ? `${a.latency_ms} ms` : "—"} sub={`network ${a.network_id}`} />
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Action</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row label="action_id" value={a.action_id} mono />
          <Row label="created_at" value={new Date(a.created_at).toLocaleString()} />
          <Row label="route" value={`${a.method} ${a.route}`} mono />
          <Row label="seller_label" value={a.seller_label} />
          <Row label="buyer_addr" value={a.buyer_addr} mono link={explorerAddrLink(a.network_id, a.buyer_addr)} />
          <Row label="seller_addr" value={a.seller_addr} mono link={explorerAddrLink(a.network_id, a.seller_addr)} />
          <Row label="asset (USDC)" value={a.asset_addr} mono link={explorerAddrLink(a.network_id, a.asset_addr)} />
          <Row label="result_hash" value={a.result_hash ?? "—"} mono />
        </dl>
        {a.meta && Object.keys(a.meta).length > 0 ? (
          <details className="mt-3">
            <summary className="text-xs text-ink/60 cursor-pointer">meta JSON ({Object.keys(a.meta).length} keys)</summary>
            <pre className="mt-2 text-xs font-mono bg-ink/5 p-3 rounded overflow-auto">{JSON.stringify(a.meta, null, 2)}</pre>
          </details>
        ) : null}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Settlement</h2>
          {s ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
              <Row label="settlement_id" value={s.settlement_id} mono />
              <Row label="mode" value={s.mode} />
              <Row label="status" value={s.status} />
              <Row label="tx_hash" value={s.tx_hash ?? "—"} mono link={s.tx_hash ? explorerTxLink(a.network_id, s.tx_hash) : undefined} />
              <Row label="block_number" value={s.block_number ?? "—"} mono />
              <Row label="submitted_at" value={s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "—"} />
              <Row label="confirmed_at" value={s.confirmed_at ? new Date(s.confirmed_at).toLocaleString() : "—"} />
              {s.gateway_settlement_id ? <Row label="gateway_id" value={s.gateway_settlement_id} mono /> : null}
              {s.error ? <Row label="error" value={s.error} mono /> : null}
            </dl>
          ) : (
            <p className="text-ink/50 text-sm">No settlement row yet.</p>
          )}
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-3">Payment (x402)</h2>
          {data.payment ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
              <Row label="payment_id" value={data.payment.payment_id} mono />
              <Row label="scheme" value={data.payment.scheme} />
              <Row label="nonce" value={data.payment.nonce} mono />
              <Row label="valid_after" value={String(data.payment.valid_after)} mono />
              <Row label="valid_before" value={String(data.payment.valid_before)} mono />
              <Row label="verified_at" value={data.payment.verified_at ? new Date(data.payment.verified_at).toLocaleString() : "—"} />
              {data.payment.authorization_id ? <Row label="auth_id" value={data.payment.authorization_id} mono /> : null}
            </dl>
          ) : (
            <p className="text-ink/50 text-sm">No payment row.</p>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Revenue splits ({data.splits.length})</h2>
        {data.splits.length === 0 ? (
          <p className="text-ink/50 text-sm">No splits configured for this route.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink/60">
              <tr>
                <th className="py-1">Recipient</th>
                <th>BPS</th>
                <th>Amount (USDC)</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {data.splits.map((sp, i) => (
                <tr key={i} className="border-t border-ink/5">
                  <td className="py-1.5 font-mono text-xs"><a href={explorerAddrLink(a.network_id, sp.recipient_addr)} target="_blank" rel="noreferrer" className="hover:underline">{sp.recipient_addr.slice(0, 10)}…{sp.recipient_addr.slice(-6)}</a></td>
                  <td className="font-mono">{sp.bps} ({(sp.bps / 100).toFixed(2)}%)</td>
                  <td className="font-mono">${usdc(sp.amount_atomic)}</td>
                  <td className="font-mono text-xs">
                    {sp.tx_hash ? <a href={explorerTxLink(a.network_id, sp.tx_hash)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{sp.tx_hash.slice(0, 10)}…</a> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Provider costs ({data.provider_costs.length})</h2>
        {data.provider_costs.length === 0 ? (
          <p className="text-ink/50 text-sm">No upstream cost rows recorded — margin defaults to 100%.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink/60">
              <tr>
                <th className="py-1">Provider</th>
                <th>Unit</th>
                <th>Units</th>
                <th>Atomic cost (USDC)</th>
                <th>At</th>
              </tr>
            </thead>
            <tbody>
              {data.provider_costs.map((c, i) => (
                <tr key={i} className="border-t border-ink/5">
                  <td className="py-1.5 font-semibold">{c.provider}</td>
                  <td className="font-mono">{c.unit}</td>
                  <td className="font-mono">{c.units}</td>
                  <td className="font-mono">${usdc(c.atomic_cost)}</td>
                  <td className="font-mono text-xs">{new Date(c.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card border-coral/30 bg-coral/5">
        <h2 className="text-lg font-semibold text-coral mb-2">Mark as refunded</h2>
        <p className="text-xs text-ink/70 mb-3">
          Flips the settlement row to <code className="font-mono">failed</code> with a <code className="font-mono">REFUND:</code> prefix on the
          error column. This is a ledger annotation only — the actual reverse on-chain
          USDC transfer must be initiated separately by the operator. Use this to prevent
          the row from being counted as confirmed revenue in margin reports.
        </p>
        <form action={refundAction} className="flex gap-2 flex-wrap">
          <input type="hidden" name="action_id" value={a.action_id} />
          <input
            name="reason"
            required
            placeholder="reason (e.g. provider returned 500, refund issued)"
            className="input flex-1 min-w-[260px]"
            maxLength={500}
          />
          <button type="submit" className="btn btn-danger">Mark refunded</button>
        </form>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" }) {
  const valueClass = tone === "bad" ? "text-coral" : tone === "ok" ? "text-emerald-700" : "";
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-ink/50">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${valueClass}`}>{value}</div>
      {sub ? <div className="text-xs text-ink/50 mt-1 font-mono">{sub}</div> : null}
    </div>
  );
}

function Row({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: string }) {
  const valueNode = link ? (
    <a href={link} target="_blank" rel="noreferrer" className="hover:underline">{value}</a>
  ) : (
    value
  );
  return (
    <>
      <dt className="text-ink/50 text-xs uppercase tracking-wider">{label}</dt>
      <dd className={`break-all ${mono ? "font-mono text-xs" : ""}`}>{valueNode}</dd>
    </>
  );
}
