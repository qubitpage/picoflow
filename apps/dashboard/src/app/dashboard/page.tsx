import { db } from "@/lib/db";
import { LiveSettlementPanel } from "../components/LiveSettlementPanel";
import { RecentActionsTable } from "../components/RecentActionsTable";
import { NetworkBadge } from "../components/NetworkBadge";
import { RecentSettlements } from "../components/RecentSettlements";
import { REAL_PROOFS, addressLink, isTxHash, shortAddress, shortHash, txLink } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = { k: string; v: string };
type Recent = { action_id: string; created_at: Date; route: string; seller_label: string; price_human: string; status: string; latency_ms: number | null; network_id: number; tx_hash: string | null; settlement_status: string | null };
type Split = { recipient_addr: string; total: string };
type ChainItem = { id: string; chain_id: number; name: string; is_mainnet: boolean; explorer: string; contracts_deployed: boolean; active: boolean };
type ChainsResp = { ok: boolean; active_chain_id: number; items: ChainItem[] };
type LatestProof = { tx_hash: string; network_id: number; kind: string; block_number: string | null; created_at: Date };

const API_BASE =
  process.env.PICOFLOW_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://picoflow.qubitpage.com";

async function fetchChains(): Promise<ChainsResp | null> {
  try {
    const r = await fetch(`${API_BASE}/api/chains`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ChainsResp;
  } catch {
    return null;
  }
}

async function load(): Promise<{ stats: Record<string, string>; recent: Recent[]; latestByNetwork: Recent[]; latestProofs: LatestProof[]; splits: Split[]; chains: ChainsResp | null }> {
  let stats: Row[] = [];
  let recent: Recent[] = [];
  let latestByNetwork: Recent[] = [];
  let latestProofs: LatestProof[] = [];
  let splits: Split[] = [];
  const chainsPromise = fetchChains();
  try {
    stats = (await db.query<Row>(`
      SELECT 'actions' AS k, COUNT(*)::text AS v FROM actions
      UNION ALL SELECT 'completed', COUNT(*)::text FROM actions WHERE status='completed'
      UNION ALL SELECT 'payments', COUNT(*)::text FROM payments
      UNION ALL SELECT 'settlements', COUNT(*)::text FROM settlements
      UNION ALL SELECT 'onchain_tx', COUNT(*)::text FROM onchain_tx
      UNION ALL SELECT 'provider_cost_atomic', COALESCE(SUM(atomic_cost)::text, '0') FROM provider_costs
      UNION ALL SELECT 'bonds_staked', COUNT(*)::text FROM bonds WHERE status='staked'
      UNION ALL SELECT 'bonds_slashed', COUNT(*)::text FROM bonds WHERE status='slashed'
      UNION ALL SELECT 'bonds_refunded', COUNT(*)::text FROM bonds WHERE status='refunded'
      UNION ALL SELECT 'total_atomic', COALESCE(SUM(price_atomic)::text, '0') FROM actions WHERE status='completed'
    `)).rows;
    recent = (await db.query<Recent>(`
      SELECT a.action_id::text, a.created_at, a.route, a.seller_label, a.price_human, a.status, a.latency_ms, a.network_id,
             s.tx_hash, s.status AS settlement_status
      FROM actions a
      LEFT JOIN LATERAL (
        SELECT s.tx_hash, s.status
        FROM payments p JOIN settlements s ON s.payment_id = p.payment_id
        WHERE p.action_id = a.action_id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s ON true
      ORDER BY a.created_at DESC LIMIT 250
    `)).rows;
    latestByNetwork = (await db.query<Recent>(`
      SELECT DISTINCT ON (a.network_id)
             a.action_id::text, a.created_at, a.route, a.seller_label, a.price_human, a.status, a.latency_ms, a.network_id,
             s.tx_hash, s.status AS settlement_status
      FROM actions a
      LEFT JOIN LATERAL (
        SELECT s.tx_hash, s.status
        FROM payments p JOIN settlements s ON s.payment_id = p.payment_id
        WHERE p.action_id = a.action_id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s ON true
      ORDER BY a.network_id, a.created_at DESC
    `)).rows;
    latestProofs = (await db.query<LatestProof>(`
      SELECT DISTINCT ON (network_id) tx_hash, network_id, kind, block_number::text, created_at
      FROM onchain_tx
      ORDER BY network_id, created_at DESC
    `)).rows;
    splits = (await db.query<Split>(`
      SELECT recipient_addr, SUM(amount_atomic)::text AS total
      FROM splits GROUP BY recipient_addr ORDER BY SUM(amount_atomic) DESC LIMIT 10
    `)).rows;
  } catch { /* db not ready yet */ }
  return { stats: Object.fromEntries(stats.map((r) => [r.k, r.v])), recent, latestByNetwork, latestProofs, splits, chains: await chainsPromise };
}

export default async function Page() {
  const { stats, recent, latestByNetwork, latestProofs, splits, chains } = await load();
  const totalUsdc = (Number(stats.total_atomic ?? 0) / 1e6).toFixed(6);
  const costUsdc = (Number(stats.provider_cost_atomic ?? 0) / 1e6).toFixed(6);
  const chainById = new Map((chains?.items ?? []).map((c) => [c.chain_id, c]));
  const activeChains = (chains?.items ?? []).filter((c) => c.active || c.contracts_deployed);
  const mainnet = chainById.get(42161) ?? { chain_id: 42161, name: "Arbitrum One", is_mainnet: true, explorer: "https://arbiscan.io", contracts_deployed: true, active: false, id: "arbitrum-one" };
  const arc = chainById.get(5042002) ?? { chain_id: 5042002, name: "Arc Testnet", is_mainnet: false, explorer: "https://testnet.arcscan.app", contracts_deployed: true, active: false, id: "arc-testnet" };
  return (
    <div className="space-y-8">
      <section className="card">
        <NetworkBadge />
        <h1 className="text-3xl font-semibold tracking-tight">PicoFlow Live Ledger</h1>
        <p className="text-ink/70 mt-2 max-w-2xl">
          Five-layer settlement mesh letting AI agents pay each other from $0.001 (per call) down to
          $0.000001 (per stream tick) — using x402 quotes, Circle Gateway batched
          settlement, and a ProofMesh of staked bonds for trustless validation. Currently
          settling on the chain shown in the badge above; switch chains by
          editing one env var (no rebuild).
        </p>
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <div className="card border-emerald/30 bg-emerald/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-bold">Real-funds mainnet proof</div>
              <h2 className="text-2xl font-semibold mt-1">{mainnet.name}</h2>
              <p className="text-sm text-ink/70 mt-2">
                This is the live money example: customer API calls, ledger rows, USDC revenue, and provider-cost accounting that prove PicoFlow works outside a testnet.
              </p>
            </div>
            <span className="rounded-full bg-emerald-500/15 text-emerald-700 px-3 py-1 text-xs font-bold">chain {mainnet.chain_id}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <Metric label="Paid actions" value={stats.actions ?? "0"} />
            <Metric label="Completed" value={stats.completed ?? "0"} />
            <Metric label="USDC billed" value={`$${totalUsdc}`} />
            <Metric label="Provider costs" value={`$${costUsdc}`} />
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <a href={txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx)} target="_blank" rel="noreferrer" className="btn btn-sm">
              Real USDC tx {shortHash(REAL_PROOFS.mainnet.latestTx)}
            </a>
            <a href={addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.usdc)} target="_blank" rel="noreferrer" className="btn btn-sm">
              USDC contract {shortAddress(REAL_PROOFS.mainnet.usdc)}
            </a>
          </div>
        </div>

        <div className="card border-amber/40 bg-amber/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-amber-700 font-bold">Arc-native rehearsal</div>
              <h2 className="text-2xl font-semibold mt-1">{arc.name}</h2>
              <p className="text-sm text-ink/70 mt-2">
                This is the sponsor-specific path: Arc USDC-gas contracts, ProofMesh events, and Gateway-compatible settlement state. It is shown separately so testnet proof is not confused with mainnet money.
              </p>
            </div>
            <span className="rounded-full bg-amber-500/15 text-amber-800 px-3 py-1 text-xs font-bold">chain {arc.chain_id}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <Metric label="Proof events" value={stats.onchain_tx ?? "0"} />
            <Metric label="Settlements tracked" value={stats.settlements ?? "0"} />
            <Metric label="Contracts" value={arc.contracts_deployed ? "deployed" : "preset"} />
            <Metric label="Arc Mainnet" value="drop-in ready" />
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <a href={addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault)} target="_blank" rel="noreferrer" className="btn btn-sm">
              BondVault {shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)}
            </a>
            <a href={txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx)} target="_blank" rel="noreferrer" className="btn btn-sm">
              Faucet tx {shortHash(REAL_PROOFS.arcTestnet.faucetTx)}
            </a>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold">Latest transaction by active network</h2>
            <p className="text-xs text-ink/60">
              After a demo/test run, each active or contract-deployed network keeps its newest paid action visible here, even when another network has newer rows in the full ledger.
            </p>
          </div>
          <a href="/demo" className="btn btn-sm">Run test</a>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(activeChains.length > 0 ? activeChains : [mainnet, arc]).map((chain) => {
            const latestAction = latestByNetwork.find((r) => r.network_id === chain.chain_id);
            const latestProof = latestProofs.find((r) => r.network_id === chain.chain_id);
            const txHash = latestAction?.tx_hash ?? latestProof?.tx_hash ?? null;
            const hasExplorerTx = isTxHash(txHash) && (latestAction?.tx_hash || latestProof?.block_number);
            return (
              <div key={chain.chain_id} className="rounded-xl border border-ink/10 bg-cream/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">{chain.name}</div>
                  <span className="rounded-full border border-ink/10 px-2 py-0.5 text-[10px] text-ink/55">chain {chain.chain_id}</span>
                </div>
                {latestAction ? (
                  <>
                    <div className="mt-2 font-mono text-xs text-ink/70">{latestAction.route}</div>
                    <div className="mt-1 text-sm"><span className="font-semibold">{latestAction.seller_label}</span> · {latestAction.price_human} USDC</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <a href={`/actions/${latestAction.action_id}`} className="text-indigo hover:underline">action {shortHash(latestAction.action_id)}</a>
                      {txHash ? (
                        hasExplorerTx ? <a href={txLink(chain.chain_id, txHash)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">tx {shortHash(txHash)}</a> : <span title="Ledger proof hash; no confirmed explorer block recorded">proof {shortHash(txHash)}</span>
                      ) : <span className="text-ink/45">settlement tx pending</span>}
                    </div>
                  </>
                ) : latestProof ? (
                  <div className="mt-3 text-sm">
                    <div>{latestProof.kind} proof lane</div>
                    <div className="font-mono text-xs mt-1">{hasExplorerTx ? <a href={txLink(chain.chain_id, txHash!)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{shortHash(txHash!)}</a> : shortHash(txHash!)}</div>
                  </div>
                ) : (
                  <p className="text-sm text-ink/50 mt-3">No transaction recorded yet. Run the demo for this network.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Actions", stats.actions ?? "0"],
          ["Completed", stats.completed ?? "0"],
          ["Payments", stats.payments ?? "0"],
          ["Settlements", stats.settlements ?? "0"],
          ["Onchain tx", stats.onchain_tx ?? "0"],
          ["Bonds staked", stats.bonds_staked ?? "0"],
          ["Bonds slashed", stats.bonds_slashed ?? "0"],
          ["Total USDC moved", totalUsdc],
        ].map(([k, v]) => (
          <div key={k} className="card">
            <div className="text-xs uppercase tracking-wider text-ink/50">{k}</div>
            <div className="text-2xl font-semibold mt-1">{v}</div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">Recent paid actions</h2>
            <p className="text-xs text-ink/60">
              Every row is a real x402 round-trip recorded by the seller after a verified EIP-3009
              authorization. Filter, paginate, and read the latency the buyer actually saw.
            </p>
          </div>
        </div>
        <RecentActionsTable
          rows={recent.map((r) => ({
            ...r,
            created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
            network_name: chainById.get(r.network_id)?.name ?? `chain ${r.network_id}`,
            tx_href: r.tx_hash && isTxHash(r.tx_hash) ? txLink(r.network_id, r.tx_hash) : null,
          }))}
        />
      </section>

      <LiveSettlementPanel />

      <RecentSettlements />

      <section className="card">
        <h2 className="text-xl font-semibold mb-4">Where every $0.01 went</h2>
        {splits.length === 0 ? (
          <p className="text-ink/50">No splits recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {splits.map((s) => (
              <li key={s.recipient_addr} className="flex items-center gap-3">
                <span className="font-mono text-xs">{s.recipient_addr.slice(0, 10)}…{s.recipient_addr.slice(-6)}</span>
                <span className="flex-1 h-2 rounded-full bg-ink/5 overflow-hidden">
                  <span
                    className="block h-full bg-indigo"
                    style={{ width: `${Math.min(100, (Number(s.total) / Math.max(1, Number(splits[0]?.total ?? 1))) * 100)}%` }}
                  />
                </span>
                <span className="font-mono text-xs">{(Number(s.total) / 1e6).toFixed(6)} USDC</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-cream/70 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
