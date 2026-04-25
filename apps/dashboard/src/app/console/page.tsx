import Link from "next/link";
import { NetworkTabs } from "@/app/components/NetworkTabs";
import { ProofArtifacts } from "@/app/components/ProofArtifacts";
import { fetchChains, isNetworkSelected, networkName, normalizeNetwork, parsePage } from "@/lib/chains";
import { db } from "@/lib/db";
import { isTxHash, shortHash, txLink } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Summary = {
  actions: string;
  completed: string;
  failed: string;
  payments: string;
  settlements: string;
  mock_gateway: string;
  missing_tx_hash: string;
  total_atomic: string;
};

type RouteRow = {
  network_id: number;
  route: string;
  seller_label: string;
  calls: string;
  revenue_atomic: string;
  avg_latency_ms: string | null;
};

type TxRow = {
  network_id: number;
  created_at: Date;
  action_id: string;
  route: string;
  seller_label: string;
  buyer_addr: string;
  price_human: string;
  status: string;
  latency_ms: number | null;
  settlement_status: string | null;
  mode: string | null;
  gateway_settlement_id: string | null;
  tx_hash: string | null;
};

type NetworkStat = { network_id: number; actions: string; completed: string; total_atomic: string; settlements: string };
type LatestProof = { tx_hash: string; network_id: number; kind: string; block_number: string | null; created_at: Date };

type ConsoleData = {
  summary: Summary;
  routes: RouteRow[];
  txs: TxRow[];
  latestByNetwork: TxRow[];
  latestProofs: LatestProof[];
  networkStats: NetworkStat[];
  error: string | null;
};

const EMPTY_SUMMARY: Summary = {
  actions: "0",
  completed: "0",
  failed: "0",
  payments: "0",
  settlements: "0",
  mock_gateway: "0",
  missing_tx_hash: "0",
  total_atomic: "0",
};

const PRICE_MODELS = [
  {
    name: "Featherless open-model completion",
    route: "/api/featherless/infer",
    currentPrice: 0.005,
    productionPrice: 0.0085,
    upstreamCost: 0.005,
    batchN: 1000,
    role: "Wide model catalogue for specialised tasks; sell as metered model access with SLA and cache credits.",
  },
  {
    name: "AI/ML API blended model call",
    route: "/api/aimlapi/infer",
    currentPrice: 0.005,
    productionPrice: 0.009,
    upstreamCost: 0.005,
    batchN: 1000,
    role: "OpenAI-compatible router for Google, Claude, GPT, and Llama style models behind one x402 price surface.",
  },
  {
    name: "Google/Gemini planning or validator call",
    route: "/api/validator/check",
    currentPrice: 0.0015,
    productionPrice: 0.0025,
    upstreamCost: 0.00035,
    batchN: 1000,
    role: "Low-cost planner, quote negotiator, and second-opinion validator that chooses the cheapest paid model path.",
  },
  {
    name: "AIsa market/data signal",
    route: "/api/aisa/data",
    currentPrice: 0.001,
    productionPrice: 0.0018,
    upstreamCost: 0.00025,
    batchN: 1000,
    role: "Premium data sold atomically to agents before they decide whether an inference is worth buying.",
  },
];

const CRITIQUES = [
  {
    severity: "P0",
    title: "Settlement truth must be explicit",
    body: "Rows with mock-batch IDs are authorisation and accounting proofs, not settled Circle Gateway batches. The product must label pending, simulated, and onchain-confirmed states separately.",
  },
  {
    severity: "P0",
    title: "Auth is now mandatory for operator surfaces",
    body: "Settings and this console are protected by Basic Auth at the dashboard layer; seller admin mutations now fail closed unless ADMIN_TOKEN is configured.",
  },
  {
    severity: "P0",
    title: "Inference price cannot equal provider cost",
    body: "The hackathon $0.005 price is a demo price. Featherless and AI/ML API credits imply roughly $0.005/call, so production pricing needs provider pass-through, Gateway amortisation, risk reserve, and platform margin.",
  },
  {
    severity: "P1",
    title: "Human transaction operations are required",
    body: "Customers need transaction search, settlement proof, retry/refund, and dispute workflows. This console is the first operator cockpit; the next cut should add action detail pages and refund/retry endpoints.",
  },
  {
    severity: "P1",
    title: "ProofMesh economics need stronger incentives",
    body: "Validator work is not attractive unless every paid action funds validation and bonds are larger than the action value. Production mode should add an insurance surcharge and sampled validation budget.",
  },
];

async function loadConsole(): Promise<ConsoleData> {
  try {
    const [summary, routes, txs, latestByNetwork, latestProofs, networkStats] = await Promise.all([
      db.query<Summary>(`
        SELECT
          (SELECT COUNT(*)::text FROM actions) AS actions,
          (SELECT COUNT(*)::text FROM actions WHERE status='completed') AS completed,
          (SELECT COUNT(*)::text FROM actions WHERE status='failed') AS failed,
          (SELECT COUNT(*)::text FROM payments) AS payments,
          (SELECT COUNT(*)::text FROM settlements) AS settlements,
          (SELECT COUNT(*)::text FROM settlements WHERE gateway_settlement_id LIKE 'mock-batch-%') AS mock_gateway,
          (SELECT COUNT(*)::text FROM settlements WHERE tx_hash IS NULL) AS missing_tx_hash,
          COALESCE((SELECT SUM(price_atomic)::text FROM actions WHERE status='completed'), '0') AS total_atomic
      `),
      db.query<RouteRow>(`
        SELECT network_id, route, seller_label, COUNT(*)::text AS calls,
               COALESCE(SUM(price_atomic)::text, '0') AS revenue_atomic,
               ROUND(AVG(latency_ms))::text AS avg_latency_ms
        FROM actions
        GROUP BY network_id, route, seller_label
        ORDER BY SUM(price_atomic) DESC NULLS LAST, COUNT(*) DESC
        LIMIT 250
      `),
      db.query<TxRow>(`
        SELECT a.network_id, a.created_at, a.action_id::text, a.route, a.seller_label, a.buyer_addr,
               a.price_human, a.status, a.latency_ms,
               s.status AS settlement_status, s.mode, s.gateway_settlement_id, s.tx_hash
        FROM actions a
        LEFT JOIN payments p ON p.action_id = a.action_id
        LEFT JOIN settlements s ON s.payment_id = p.payment_id
        ORDER BY a.created_at DESC
        LIMIT 500
      `),
      db.query<TxRow>(`
        SELECT DISTINCT ON (a.network_id)
               a.network_id, a.created_at, a.action_id::text, a.route, a.seller_label, a.buyer_addr,
               a.price_human, a.status, a.latency_ms,
               s.status AS settlement_status, s.mode, s.gateway_settlement_id, s.tx_hash
        FROM actions a
        LEFT JOIN payments p ON p.action_id = a.action_id
        LEFT JOIN settlements s ON s.payment_id = p.payment_id
        ORDER BY a.network_id, a.created_at DESC
      `),
      db.query<LatestProof>(`
        SELECT DISTINCT ON (network_id) tx_hash, network_id, kind, block_number::text, created_at
        FROM onchain_tx
        ORDER BY network_id, created_at DESC
      `),
      db.query<NetworkStat>(`
        SELECT a.network_id,
               COUNT(*)::text AS actions,
               COUNT(*) FILTER (WHERE a.status='completed')::text AS completed,
               COALESCE(SUM(a.price_atomic) FILTER (WHERE a.status='completed')::text, '0') AS total_atomic,
               COUNT(s.settlement_id)::text AS settlements
        FROM actions a
        LEFT JOIN payments p ON p.action_id = a.action_id
        LEFT JOIN settlements s ON s.payment_id = p.payment_id
        GROUP BY a.network_id
        ORDER BY COUNT(*) DESC
      `),
    ]);
    return {
      summary: summary.rows[0] ?? EMPTY_SUMMARY,
      routes: routes.rows,
      txs: txs.rows,
      latestByNetwork: latestByNetwork.rows,
      latestProofs: latestProofs.rows,
      networkStats: networkStats.rows,
      error: null,
    };
  } catch (err) {
    return { summary: EMPTY_SUMMARY, routes: [], txs: [], latestByNetwork: [], latestProofs: [], networkStats: [], error: (err as Error).message };
  }
}

function usdc(atomic: string): string {
  return (Number(atomic || 0) / 1e6).toFixed(6);
}

function short(value: string | null | undefined): string {
  if (!value) return "none";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function settlementTruth(tx: TxRow): { label: string; tone: string } {
  if (!tx.mode) return { label: "no settlement row", tone: "text-coral" };
  if (tx.gateway_settlement_id?.startsWith("mock-batch-")) return { label: "gateway intent only", tone: "text-amber" };
  if (tx.tx_hash) return { label: "onchain proof", tone: "text-emerald" };
  if (tx.mode === "gateway-batch" && (tx.settlement_status ?? "pending") === "pending") return { label: "gateway pending", tone: "text-amber" };
  return { label: tx.settlement_status ?? "pending", tone: "text-amber" };
}

function proofLabel(tx: TxRow, latestProof: LatestProof | undefined): { label: string; href: string | null; title: string } {
  if (tx.tx_hash && isTxHash(tx.tx_hash) && !tx.gateway_settlement_id?.startsWith("mock-batch-")) {
    return { label: shortHash(tx.tx_hash), href: txLink(tx.network_id, tx.tx_hash), title: "Action settlement transaction" };
  }
  if (tx.gateway_settlement_id) {
    return { label: short(tx.gateway_settlement_id), href: null, title: "Gateway settlement intent ID" };
  }
  if (latestProof) {
    const canLink = isTxHash(latestProof.tx_hash) && latestProof.block_number;
    return {
      label: `${latestProof.kind} ${shortHash(latestProof.tx_hash)}`,
      href: canLink ? txLink(tx.network_id, latestProof.tx_hash) : null,
      title: canLink ? "Latest confirmed proof transaction for this network" : "Latest ledger proof for this network; no confirmed explorer block recorded",
    };
  }
  return { label: "awaiting network proof", href: null, title: "No proof-lane transaction has been recorded for this network yet" };
}

function modelEconomics(model: (typeof PRICE_MODELS)[number]) {
  const gateway = 0.05 / model.batchN;
  const insurance = model.productionPrice * 0.05;
  const platform = model.productionPrice * 0.1;
  const sellerNet = model.productionPrice * 0.8 - model.upstreamCost - gateway - insurance;
  const operatorNet = model.productionPrice - model.upstreamCost - gateway - insurance;
  return { gateway, insurance, platform, sellerNet, operatorNet };
}

export default async function ConsolePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const selectedNetwork = normalizeNetwork(params.network);
  const page = parsePage(params.page);
  const pageSize = 25;
  const [{ summary, routes, txs, latestByNetwork, latestProofs, networkStats, error }, chainsResp] = await Promise.all([loadConsole(), fetchChains()]);
  const chains = chainsResp?.items ?? [];
  const activeChains = chains.filter((c) => c.active || c.contracts_deployed);
  const proofByNetwork = new Map(latestProofs.map((p) => [p.network_id, p]));
  const filteredTxs = txs.filter((tx) => isNetworkSelected(tx.network_id, selectedNetwork, chains));
  const filteredRoutes = routes.filter((r) => isNetworkSelected(r.network_id, selectedNetwork, chains));
  const pagedTxs = filteredTxs.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredTxs.length / pageSize));
  const counts: Record<string, string> = {
    all: String(networkStats.reduce((a, s) => a + Number(s.actions), 0)),
    mainnet: String(networkStats.filter((s) => isNetworkSelected(s.network_id, "mainnet", chains)).reduce((a, s) => a + Number(s.actions), 0)),
    testnet: String(networkStats.filter((s) => isNetworkSelected(s.network_id, "testnet", chains)).reduce((a, s) => a + Number(s.actions), 0)),
  };
  for (const stat of networkStats) counts[String(stat.network_id)] = stat.actions;
  const totalUsdc = usdc(summary.total_atomic);
  const mockGateway = Number(summary.mock_gateway);
  const missingTx = Number(summary.missing_tx_hash);

  return (
    <div className="space-y-8">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">PicoFlow Operator Console</h1>
            <p className="text-ink/70 mt-2 max-w-3xl">
              A human control surface for transaction truth, network-specific settlement state, AI-provider economics, launch blockers, and monetisation.
              Mainnet real-funds proof and Arc Testnet rehearsal are separated explicitly.
            </p>
          </div>
          <a className="rounded border border-ink/20 px-3 py-2 text-sm hover:bg-ink/5" href="/docs/picoflow-whitepaper.pdf">
            Download unified whitepaper
          </a>
        </div>
        {error ? <p className="mt-4 text-sm text-coral">Database read failed: {error}</p> : null}
      </section>

      {chains.length > 0 ? (
        <NetworkTabs basePath="/console" selected={selectedNetwork} chains={chains} counts={counts} title="Console network tabs" note="Filter operator data by all networks, only mainnets, only testnets, or any connected chain published by /api/chains." />
      ) : null}

      <ProofArtifacts title="Console proof anchors" />

      <section className="grid md:grid-cols-3 gap-4">
        {networkStats.map((s) => (
          <div key={s.network_id} className="card">
            <div className="text-xs uppercase tracking-wider text-ink/50">{networkName(s.network_id, chains)}</div>
            <div className="mt-1 text-2xl font-semibold">{s.actions}</div>
            <div className="text-xs text-ink/60 mt-2">{s.completed} completed · {s.settlements} settlements · {usdc(s.total_atomic)} USDC</div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold">Latest console truth by active network</h2>
            <p className="text-xs text-ink/60">
              Rescan summary: each active or contract-deployed network keeps its newest paid action and newest proof-lane transaction visible, even when another network dominates the recent transaction list.
            </p>
          </div>
          <a href="/demo" className="btn btn-sm">Run test</a>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(activeChains.length > 0 ? activeChains : chains).map((chain) => {
            const latestTx = latestByNetwork.find((tx) => tx.network_id === chain.chain_id);
            const latestProof = proofByNetwork.get(chain.chain_id);
            const truth = latestTx ? settlementTruth(latestTx) : null;
            const proof = latestTx ? proofLabel(latestTx, latestProof) : null;
            return (
              <div key={chain.chain_id} className="rounded-xl border border-ink/10 bg-cream/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">{chain.name}</div>
                  <span className="rounded-full border border-ink/10 px-2 py-0.5 text-[10px] text-ink/55">chain {chain.chain_id}</span>
                </div>
                {latestTx ? (
                  <>
                    <div className="mt-2 font-mono text-xs text-ink/70">{latestTx.route}</div>
                    <div className="mt-1 text-sm"><span className="font-semibold">{latestTx.seller_label}</span> · {latestTx.price_human} USDC</div>
                    <div className="mt-2 text-xs"><span className={truth?.tone}>{truth?.label}</span></div>
                    <div className="mt-2 font-mono text-xs" title={proof?.title}>
                      {proof?.href ? <a href={proof.href} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{proof.label}</a> : <span>{proof?.label}</span>}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-ink/50 mt-3">No paid action recorded yet for this network.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Actions", summary.actions],
          ["Completed", summary.completed],
          ["Payments", summary.payments],
          ["Settlements", summary.settlements],
          ["Gateway intents", summary.mock_gateway],
          ["Missing tx hash", summary.missing_tx_hash],
          ["Total billed USDC", totalUsdc],
          ["Launch truth", missingTx > 0 || mockGateway > 0 ? "staged" : "live"],
        ].map(([k, v]) => (
          <div key={k} className="card">
            <div className="text-xs uppercase tracking-wider text-ink/50">{k}</div>
            <div className="text-2xl font-semibold mt-1">{v}</div>
          </div>
        ))}
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        {CRITIQUES.map((item) => (
          <div key={item.title} className="card">
            <div className="text-xs uppercase tracking-wider text-coral font-semibold">{item.severity}</div>
            <h2 className="text-lg font-semibold mt-1">{item.title}</h2>
            <p className="text-sm text-ink/70 mt-2">{item.body}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold mb-4">AI inference monetisation model</h2>
        <p className="text-sm text-ink/70 max-w-3xl mb-4">
          Production pricing must quote per provider, per model class, and per batch size. Arc makes sub-cent settlement possible;
          the business still needs to charge above upstream model cost plus Gateway amortisation, insurance reserve, and split commitments.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 pr-3">Product</th>
              <th>Route</th>
              <th>Now</th>
              <th>Prod quote</th>
              <th>Upstream</th>
              <th>Operator net</th>
              <th>Seller net after 80/10/10</th>
            </tr>
          </thead>
          <tbody>
            {PRICE_MODELS.map((model) => {
              const e = modelEconomics(model);
              return (
                <tr key={model.name} className="border-t border-ink/5 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{model.name}</div>
                    <p className="text-xs text-ink/60 mt-1">{model.role}</p>
                  </td>
                  <td className="font-mono text-xs py-3">{model.route}</td>
                  <td className="font-mono text-xs py-3">${model.currentPrice.toFixed(4)}</td>
                  <td className="font-mono text-xs py-3">${model.productionPrice.toFixed(4)}</td>
                  <td className="font-mono text-xs py-3">${model.upstreamCost.toFixed(4)}</td>
                  <td className={`font-mono text-xs py-3 ${e.operatorNet > 0 ? "text-emerald" : "text-coral"}`}>${e.operatorNet.toFixed(6)}</td>
                  <td className={`font-mono text-xs py-3 ${e.sellerNet > 0 ? "text-emerald" : "text-coral"}`}>${e.sellerNet.toFixed(6)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Revenue by paid route</h2>
          {routes.length === 0 ? (
            <p className="text-sm text-ink/50">No route data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
                <tr><th className="py-2">Route</th><th>Calls</th><th>Revenue</th><th>Avg latency</th></tr>
              </thead>
              <tbody>
                {filteredRoutes.slice(0, 25).map((r) => (
                  <tr key={`${r.network_id}:${r.route}:${r.seller_label}`} className="border-t border-ink/5">
                    <td className="py-2"><div>{r.seller_label}</div><div className="font-mono text-xs text-ink/50">{r.route}</div><div className="text-[10px] text-ink/40">{networkName(r.network_id, chains)}</div></td>
                    <td className="font-mono text-xs">{r.calls}</td>
                    <td className="font-mono text-xs">{usdc(r.revenue_atomic)} USDC</td>
                    <td className="font-mono text-xs">{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : "none"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Launch decisions</h2>
          <ul className="space-y-3 text-sm text-ink/75">
            <li><strong>Sell API inference as prepaid USDC credits.</strong> Buyers top up once, then agents spend per call through x402. This avoids card rails below one cent.</li>
            <li><strong>Route by cost and confidence.</strong> Gemini/Google handles planning, Featherless handles open-model depth, AI/ML API handles premium compatibility. The quote engine picks the cheapest provider that meets latency and quality.</li>
            <li><strong>Charge by measured tokens plus settlement fee.</strong> Store provider usage and actual upstream cost per action; expose gross margin per route before allowing public onboarding.</li>
            <li><strong>Gate write operations.</strong> Settings, refunds, retries, and deployment controls are operator-only. Public pages remain judge/customer-readable.</li>
            <li><strong>Do not claim settled until there is proof.</strong> Dashboard language now separates gateway intent from confirmed tx hash.</li>
          </ul>
        </div>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold mb-4">Recent transactions with settlement truth</h2>
        {txs.length === 0 ? (
          <p className="text-sm text-ink/50">No transactions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
              <tr><th className="py-2">When</th><th>Action</th><th>Route</th><th>Buyer</th><th>Price</th><th>Status</th><th>Settlement</th><th>Proof</th></tr>
            </thead>
            <tbody>
              {pagedTxs.map((tx) => {
                const truth = settlementTruth(tx);
                const proof = proofLabel(tx, proofByNetwork.get(tx.network_id));
                return (
                  <tr key={tx.action_id} className="border-t border-ink/5 align-top">
                    <td className="py-2 font-mono text-xs">{new Date(tx.created_at).toISOString().slice(0, 19).replace("T", " ")}</td>
                    <td className="font-mono text-xs py-2"><div>{short(tx.action_id)}</div><div className="text-[10px] text-ink/40">{networkName(tx.network_id, chains)}</div></td>
                    <td className="py-2"><div>{tx.seller_label}</div><div className="font-mono text-xs text-ink/50">{tx.route}</div></td>
                    <td className="font-mono text-xs py-2">{short(tx.buyer_addr)}</td>
                    <td className="font-mono text-xs py-2">{tx.price_human}</td>
                    <td className="py-2"><span className={tx.status === "completed" ? "text-emerald" : "text-amber"}>{tx.status}</span></td>
                    <td className={`py-2 ${truth.tone}`}>{truth.label}</td>
                    <td className="font-mono text-xs py-2">
                      {proof.href ? <a href={proof.href} target="_blank" rel="noreferrer" className="text-indigo hover:underline" title={proof.title}>{proof.label}</a> : <span title={proof.title}>{proof.label}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/console?network=${encodeURIComponent(selectedNetwork)}&page=${Math.max(1, page - 1)}`}>Previous</Link>
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/console?network=${encodeURIComponent(selectedNetwork)}&page=${Math.min(totalPages, page + 1)}`}>Next</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
