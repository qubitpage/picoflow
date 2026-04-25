import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { WalletManagement } from "../components/WalletManagement";
import { REAL_PROOFS, addressLink, shortAddress, shortHash, txLink } from "@/lib/proofLinks";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SummaryRow = {
  actions: string;
  completed: string;
  failed: string;
  orgs: string;
  active_keys: string;
  total_atomic: string;
  settlements: string;
  onchain_proofs: string;
  mock_gateway: string;
  settle_pending: string;
  settle_submitted: string;
  settle_settled: string;
  settle_failed: string;
};

type RouteRow = {
  route: string;
  seller_label: string;
  calls: string;
  revenue_atomic: string;
  avg_latency_ms: string | null;
};

type OrgRow = {
  name: string;
  contact_email: string | null;
  monthly_call_limit: string | null;
  disabled: boolean;
  active_keys: string;
  calls_30d: string;
};

type SettingRow = {
  key: string;
  category: string;
  is_secret: boolean;
  display_value: string;
  updated_at: Date | null;
};

type SettlementRow = {
  settlement_id: string;
  action_id: string;
  status: string;
  mode: string;
  tx_hash: string | null;
  amount_atomic: string | null;
  submitted_at: Date | null;
  confirmed_at: Date | null;
  created_at: Date;
};

type ProviderProbe = {
  name: string;
  endpoint: string;
  price_usdc: string;
  key_present: boolean;
  source: string;
  latency_ms: number;
  sample: string;
  ok: boolean;
};

type ChainItem = {
  id: string;
  chain_id: number;
  name: string;
  is_mainnet: boolean;
  explorer: string;
  contracts_deployed: boolean;
  active: boolean;
};
type ChainsResp = { ok: boolean; active_chain_id: number; items: ChainItem[] };

type AdminData = {
  summary: SummaryRow;
  routes: RouteRow[];
  orgs: OrgRow[];
  settings: SettingRow[];
  providers: ProviderProbe[];
  settlements: SettlementRow[];
  chains: ChainsResp | null;
  error: string | null;
};

const API_BASE =
  process.env.PICOFLOW_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://picoflow.qubitpage.com";

const EMPTY_SUMMARY: SummaryRow = {
  actions: "0",
  completed: "0",
  failed: "0",
  orgs: "0",
  active_keys: "0",
  total_atomic: "0",
  settlements: "0",
  onchain_proofs: "0",
  mock_gateway: "0",
  settle_pending: "0",
  settle_submitted: "0",
  settle_settled: "0",
  settle_failed: "0",
};

const WALLET_RUNBOOK = [
  {
    label: "Arc Testnet deployer",
    address: "0x5257613C0a0b87405d08B21c62Be3F65CbD0a5bF",
    network: "Arc Testnet 5042002",
    role: "Owns the deployed BondVault, ReputationRegistry, and MetadataLogger proof contracts.",
    status: "live",
  },
  {
    label: "Base Mainnet deployer",
    address: process.env.BASE_MAINNET_DEPLOYER ?? "0x3854510d4C159d5d97646d4CBfEEc06BEF983E66",
    network: "Base Mainnet 8453",
    role: "Fresh real-money fallback deployer. Fund with ETH gas, run check-only, then deploy.",
    status: "awaiting funding",
  },
  {
    label: "Seller / platform payout",
    address: process.env.SELLER_ADDR ?? "configured in seller env",
    network: "USDC settlement recipient",
    role: "Receives the seller split; platform and OSS split addresses are managed in Settings.",
    status: "configured",
  },
];

const PROCESS_STEPS = [
  ["1. Buyer signs", "The buyer agent receives HTTP 402, signs an EIP-3009-style authorization, and retries."],
  ["2. TollBooth meters", "The seller validates auth, records org/key metadata, applies quota, and prices the exact route."],
  ["3. Provider serves", "Featherless, AI/ML API, Kraken fallback, or validator runs only after the paid request clears."],
  ["4. Ledger proves", "Every call writes action, payment, settlement intent, split rows, latency, and provider source."],
  ["5. Operator reconciles", "Admin uses this cockpit to inspect margin, customers, failed rows, proofs, and rollout blockers."],
];

async function loadProviders(): Promise<ProviderProbe[]> {
  const base = process.env.SELLER_BASE ?? "http://sellers:3030";
  try {
    const r = await fetch(`${base}/api/providers/status`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { probes?: ProviderProbe[] };
    return j.probes ?? [];
  } catch {
    return [];
  }
}

async function loadChains(): Promise<ChainsResp | null> {
  try {
    const r = await fetch(`${API_BASE}/api/chains`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ChainsResp;
  } catch {
    return null;
  }
}

async function loadAdminData(): Promise<AdminData> {
  try {
    const [summary, routes, orgs, settings, providers, settlements, chains] = await Promise.all([
      db.query<SummaryRow>(`
        SELECT
          (SELECT COUNT(*)::text FROM actions) AS actions,
          (SELECT COUNT(*)::text FROM actions WHERE status='completed') AS completed,
          (SELECT COUNT(*)::text FROM actions WHERE status='failed') AS failed,
          (SELECT COUNT(*)::text FROM orgs) AS orgs,
          (SELECT COUNT(*)::text FROM api_keys WHERE revoked_at IS NULL) AS active_keys,
          COALESCE((SELECT SUM(price_atomic)::text FROM actions WHERE status='completed'), '0') AS total_atomic,
          (SELECT COUNT(*)::text FROM settlements) AS settlements,
          (SELECT COUNT(*)::text FROM settlements WHERE tx_hash IS NOT NULL) AS onchain_proofs,
          (SELECT COUNT(*)::text FROM settlements WHERE gateway_settlement_id LIKE 'mock-batch-%') AS mock_gateway,
          (SELECT COUNT(*)::text FROM settlements WHERE status='pending') AS settle_pending,
          (SELECT COUNT(*)::text FROM settlements WHERE status='submitted') AS settle_submitted,
          (SELECT COUNT(*)::text FROM settlements WHERE status='settled') AS settle_settled,
          (SELECT COUNT(*)::text FROM settlements WHERE status='failed') AS settle_failed
      `),
      db.query<RouteRow>(`
        SELECT route, seller_label, COUNT(*)::text AS calls,
               COALESCE(SUM(price_atomic)::text, '0') AS revenue_atomic,
               ROUND(AVG(latency_ms))::text AS avg_latency_ms
        FROM actions
        GROUP BY route, seller_label
        ORDER BY SUM(price_atomic) DESC NULLS LAST, COUNT(*) DESC
        LIMIT 8
      `),
      db.query<OrgRow>(`
        SELECT o.name, o.contact_email, o.monthly_call_limit::text, o.disabled,
               COUNT(k.key_id) FILTER (WHERE k.revoked_at IS NULL)::text AS active_keys,
               COALESCE((
                 SELECT COUNT(*)::text
                 FROM actions a
                 WHERE a.meta->>'org_id' = o.org_id::text
                   AND a.created_at >= now() - interval '30 days'
               ), '0') AS calls_30d
        FROM orgs o
        LEFT JOIN api_keys k ON k.org_id = o.org_id
        GROUP BY o.org_id
        ORDER BY o.created_at DESC
        LIMIT 8
      `),
      db.query<SettingRow>(`
        SELECT key, category, is_secret,
               CASE
                 WHEN is_secret AND COALESCE(value, '') <> '' THEN 'configured'
                 WHEN is_secret THEN 'missing'
                 ELSE COALESCE(NULLIF(value, ''), 'empty')
               END AS display_value,
               updated_at
        FROM settings
        ORDER BY category, key
        LIMIT 80
      `),
      loadProviders(),
      db.query<SettlementRow>(`
         SELECT s.settlement_id::text, p.action_id::text, s.status, s.mode, s.tx_hash,
           a.price_atomic::text AS amount_atomic,
           s.submitted_at, s.confirmed_at, s.created_at
         FROM settlements s
         JOIN payments p ON p.payment_id = s.payment_id
         LEFT JOIN actions a ON a.action_id = p.action_id
         ORDER BY s.created_at DESC
        LIMIT 12
      `),
      loadChains(),
    ]);

    return {
      summary: summary.rows[0] ?? EMPTY_SUMMARY,
      routes: routes.rows,
      orgs: orgs.rows,
      settings: settings.rows,
      providers,
      settlements: settlements.rows,
      chains,
      error: null,
    };
  } catch (err) {
    return { summary: EMPTY_SUMMARY, routes: [], orgs: [], settings: [], providers: [], settlements: [], chains: null, error: (err as Error).message };
  }
}

function usdc(atomic: string): string {
  return (Number(atomic || 0) / 1e6).toFixed(6);
}

function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / max) * 100)));
}

function short(value: string): string {
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function formatDate(value: Date | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

function StatusBadge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={"text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 " + (ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800")}>
      {children}
    </span>
  );
}

function SettlementStateBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 border-amber-300",
    submitted: "bg-indigo-100 text-indigo-800 border-indigo-300",
    settled: "bg-emerald-100 text-emerald-800 border-emerald-300",
    failed: "bg-coral/15 text-coral border-coral/40",
  };
  const cls = map[status] ?? "bg-ink/10 text-ink/60 border-ink/20";
  return (
    <span className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border font-bold ${cls}`}>
      {status}
    </span>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 rounded bg-ink/10 overflow-hidden">
      <div className="h-full bg-indigo" style={{ width: `${pct(value, max)}%` }} />
    </div>
  );
}

export default async function AdminPage() {
  const allowed = await requireRole("admin");
  if (!allowed) redirect("/login?next=/admin&reason=admin_only");
  const data = await loadAdminData();
  const totalRevenue = usdc(data.summary.total_atomic);
  const maxRouteRevenue = Math.max(1, ...data.routes.map((r) => Number(r.revenue_atomic || 0)));
  const settingsConfigured = data.settings.filter((s) => s.display_value === "configured" || (!s.is_secret && s.display_value !== "empty")).length;
  const settingsMissing = data.settings.filter((s) => s.display_value === "missing" || s.display_value === "empty").length;
  const chains = new Map((data.chains?.items ?? []).map((c) => [c.chain_id, c]));
  const mainnet = chains.get(42161) ?? { chain_id: 42161, name: "Arbitrum One", explorer: "https://arbiscan.io", contracts_deployed: true, active: false, is_mainnet: true, id: "arbitrum-one" };
  const arc = chains.get(5042002) ?? { chain_id: 5042002, name: "Arc Testnet", explorer: "https://testnet.arcscan.app", contracts_deployed: true, active: false, is_mainnet: false, id: "arc-testnet" };

  return (
    <div className="space-y-8">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink/50">Admin cockpit</div>
            <h1 className="text-3xl font-semibold tracking-tight mt-1">Backend management, revenue, CRM, wallets</h1>
            <p className="text-ink/70 mt-2 max-w-4xl">
              This page is the operator map: what earns money, which customers are active, which keys and wallets matter,
              where each payment moves, and what must be fixed before a real-money rollout. It is protected by the dashboard
              admin username and password.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/settings" className="btn btn-sm btn-primary">Settings vault</a>
            <a href="/orgs" className="btn btn-sm">Customers</a>
            <a href="/docs/picoflow-whitepaper.html" className="btn btn-sm">Unified whitepaper</a>
          </div>
        </div>
        {data.error ? (
          <div className="mt-4 rounded-lg border-2 border-coral/40 bg-coral/5 p-3">
            <div className="flex items-center gap-2 text-coral text-xs uppercase tracking-wider font-bold">
              <span className="w-2 h-2 rounded-full bg-coral animate-pulse" />
              Database read failed
            </div>
            <pre className="mt-2 text-xs font-mono text-coral/90 whitespace-pre-wrap break-all">{data.error}</pre>
            <p className="mt-2 text-xs text-ink/60">
              The cockpit fell back to empty rows. Check Postgres connectivity and the
              dashboard logs (<code className="font-mono">docker compose logs dashboard --tail=200</code>),
              then refresh.
            </p>
          </div>
        ) : null}
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <div className="card border-emerald/30 bg-emerald/5">
          <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-bold">Mainnet operations</div>
          <h2 className="text-2xl font-semibold mt-1">{mainnet.name} · chain {mainnet.chain_id}</h2>
          <p className="text-sm text-ink/70 mt-2">
            Real-funds customer proof: revenue, API keys, provider costs, and settlement rows are visible here as the production business lane.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <AdminMetric label="Revenue" value={`$${totalRevenue}`} />
            <AdminMetric label="Completed calls" value={data.summary.completed} />
            <AdminMetric label="Active API keys" value={data.summary.active_keys} />
            <AdminMetric label="Onchain proofs" value={data.summary.onchain_proofs} />
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <a href={txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx)} target="_blank" rel="noreferrer" className="btn btn-sm">
              Real USDC tx {shortHash(REAL_PROOFS.mainnet.latestTx)}
            </a>
            <a href={addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.contracts.bondVault)} target="_blank" rel="noreferrer" className="btn btn-sm">
              Mainnet BondVault {shortAddress(REAL_PROOFS.mainnet.contracts.bondVault)}
            </a>
          </div>
        </div>
        <div className="card border-amber/40 bg-amber/5">
          <div className="text-[11px] uppercase tracking-wider text-amber-700 font-bold">Arc testnet operations</div>
          <h2 className="text-2xl font-semibold mt-1">{arc.name} · chain {arc.chain_id}</h2>
          <p className="text-sm text-ink/70 mt-2">
            Arc-specific rehearsal: contracts, ProofMesh, USDC-gas flow and Gateway-compatible state are tracked separately so testnet proof is never hidden or mislabeled.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <AdminMetric label="Proof events" value={data.summary.onchain_proofs} />
            <AdminMetric label="Settlements" value={data.summary.settlements} />
            <AdminMetric label="Contracts" value={arc.contracts_deployed ? "deployed" : "preset"} />
            <AdminMetric label="Arc Mainnet" value="ready path" />
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <a href={addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault)} target="_blank" rel="noreferrer" className="btn btn-sm">
              Arc BondVault {shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)}
            </a>
            <a href={txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx)} target="_blank" rel="noreferrer" className="btn btn-sm">
              Arc faucet tx {shortHash(REAL_PROOFS.arcTestnet.faucetTx)}
            </a>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ["Total billed", `$${totalRevenue}`, "Completed action revenue in USDC micro-units."],
          ["Customers", data.summary.orgs, "Tenant orgs with API-key based access."],
          ["Active keys", data.summary.active_keys, "Keys that can authenticate paid calls."],
          ["Onchain proofs", data.summary.onchain_proofs, "Settlement rows carrying a tx hash."],
          ["Completed calls", data.summary.completed, "Paid actions that reached a seller result."],
          ["Failed calls", data.summary.failed, "Calls to inspect for refunds/retries."],
          ["Settings ready", `${settingsConfigured}/${data.settings.length}`, "Configured environment and provider rows."],
          ["Missing settings", String(settingsMissing), "Empty or missing rows to complete before production."],
        ].map(([label, value, help]) => (
          <div key={label} className="card">
            <div className="text-xs uppercase tracking-wider text-ink/50">{label}</div>
            <div className="text-2xl font-semibold mt-1">{value}</div>
            <p className="text-xs text-ink/55 mt-2">{help}</p>
          </div>
        ))}
      </section>

      <section className="grid xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <div className="card">
          <h2 className="text-xl font-semibold">How the money moves</h2>
          <p className="text-sm text-ink/65 mt-1 mb-4">
            The classic API model sells subscriptions and reconciles later. PicoFlow prices each call, records the split, and leaves a ledger trail that can be settled in USDC.
          </p>
          <div className="grid md:grid-cols-5 gap-2">
            {PROCESS_STEPS.map(([title, body], index) => (
              <div key={title} className="border border-ink/10 rounded-lg p-3 bg-paper">
                <div className="text-xs uppercase tracking-wider text-indigo">Step {index + 1}</div>
                <h3 className="font-semibold mt-1 text-sm">{title}</h3>
                <p className="text-xs text-ink/60 mt-2">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold">Classic vs PicoFlow</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink/50">
                <tr><th className="py-2 pr-3">Area</th><th>Classic</th><th>PicoFlow</th></tr>
              </thead>
              <tbody className="text-ink/70">
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Billing</td><td>Monthly invoices</td><td>Per-call USDC proof</td></tr>
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Access</td><td>Static plan tiers</td><td>API key + quota + route pricing</td></tr>
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Trust</td><td>Support tickets</td><td>Ledger, splits, validator, bond</td></tr>
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Margin</td><td>Hidden blend</td><td>Provider cost + reserve + platform split</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Revenue by paid route</h2>
            <a href="/margin" className="text-sm text-indigo font-semibold">Margin detail</a>
          </div>
          <div className="space-y-3 mt-4">
            {data.routes.map((route) => {
              const revenueAtomic = Number(route.revenue_atomic || 0);
              return (
                <div key={route.route}>
                  <div className="flex justify-between gap-3 text-sm">
                    <div>
                      <div className="font-semibold">{route.seller_label || route.route}</div>
                      <div className="text-xs text-ink/50 font-mono">{route.route}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">${usdc(route.revenue_atomic)}</div>
                      <div className="text-xs text-ink/50">{route.calls} calls · {route.avg_latency_ms ?? "-"} ms</div>
                    </div>
                  </div>
                  <Bar value={revenueAtomic} max={maxRouteRevenue} />
                </div>
              );
            })}
            {data.routes.length === 0 ? <p className="text-sm text-ink/50">No paid route activity yet.</p> : null}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Provider health</h2>
            <a href="/providers" className="text-sm text-indigo font-semibold">Provider page</a>
          </div>
          <div className="mt-4 space-y-3">
            {data.providers.map((provider) => (
              <div key={provider.endpoint} className="border border-ink/10 rounded-lg p-3">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">{provider.name}</div>
                    <div className="text-xs text-ink/50 font-mono">{provider.endpoint}</div>
                  </div>
                  <StatusBadge ok={provider.ok}>{provider.source}</StatusBadge>
                </div>
                <div className="text-xs text-ink/60 mt-2">
                  ${provider.price_usdc}/call · {provider.latency_ms} ms · key {provider.key_present ? "configured" : "not required"}
                </div>
                <div className="text-xs text-ink/50 mt-1">{provider.sample}</div>
              </div>
            ))}
            {data.providers.length === 0 ? <p className="text-sm text-ink/50">Provider status endpoint unreachable.</p> : null}
          </div>
        </div>
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Customer CRM snapshot</h2>
            <a href="/orgs" className="text-sm text-indigo font-semibold">Manage customers</a>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink/50">
                <tr><th className="py-2 pr-3">Customer</th><th>Keys</th><th>Calls 30d</th><th>Cap</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.orgs.map((org) => (
                  <tr key={org.name} className="border-t border-ink/10">
                    <td className="py-2 pr-3"><div className="font-semibold">{org.name}</div><div className="text-xs text-ink/50">{org.contact_email ?? "no email"}</div></td>
                    <td>{org.active_keys}</td>
                    <td>{org.calls_30d}</td>
                    <td>{org.monthly_call_limit ?? "unlimited"}</td>
                    <td><StatusBadge ok={!org.disabled}>{org.disabled ? "disabled" : "active"}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.orgs.length === 0 ? <p className="text-sm text-ink/50">No customer orgs yet.</p> : null}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Settings vault overview</h2>
            <a href="/settings" className="text-sm text-indigo font-semibold">Edit settings</a>
          </div>
          <div className="mt-4 grid md:grid-cols-2 gap-2">
            {data.settings.slice(0, 18).map((setting) => (
              <div key={setting.key} className="border border-ink/10 rounded-lg p-3">
                <div className="text-xs uppercase tracking-wider text-ink/45">{setting.category}</div>
                <div className="font-semibold text-sm mt-1 break-all">{setting.key}</div>
                <div className="text-xs text-ink/60 mt-1">{setting.is_secret ? "secret" : setting.display_value}</div>
                <div className="text-[11px] text-ink/40 mt-1">updated {formatDate(setting.updated_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold">Settlement state machine</h2>
            <p className="text-sm text-ink/65 mt-1">
              Every paid call lands in <code className="font-mono">pending</code>, gets a tx hash and flips to{" "}
              <code className="font-mono">submitted</code>, then becomes <code className="font-mono">settled</code> on
              receipt or <code className="font-mono">failed</code> if the relayer reverts. Click any row to open the
              full ledger trail.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap text-xs">
            <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"><b className="font-mono text-base">{data.summary.settle_pending}</b> pending</span>
            <span className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2"><b className="font-mono text-base">{data.summary.settle_submitted}</b> submitted</span>
            <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2"><b className="font-mono text-base">{data.summary.settle_settled}</b> settled</span>
            <span className="rounded-lg border border-coral/40 bg-coral/5 px-3 py-2"><b className="font-mono text-base">{data.summary.settle_failed}</b> failed</span>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink/50">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th>State</th>
                <th>Mode</th>
                <th>Amount</th>
                <th>Tx</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.settlements.map((s) => (
                <tr key={s.settlement_id} className="border-t border-ink/10 hover:bg-ink/[0.02]">
                  <td className="py-2 pr-3 text-xs font-mono">{new Date(s.created_at).toLocaleString()}</td>
                  <td><SettlementStateBadge status={s.status} /></td>
                  <td className="text-xs">{s.mode}</td>
                  <td className="font-mono text-xs">{s.amount_atomic ? `$${usdc(s.amount_atomic)}` : "—"}</td>
                  <td className="font-mono text-xs">
                    {s.tx_hash ? (
                      <a href={txLink(REAL_PROOFS.mainnet.chainId, s.tx_hash)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">
                        {s.tx_hash.slice(0, 10)}…
                      </a>
                    ) : "—"}
                  </td>
                  <td className="font-mono text-xs">
                    <a href={`/actions/${s.action_id}`} className="text-indigo hover:underline">{s.action_id.slice(0, 8)}…</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.settlements.length === 0 ? <p className="text-sm text-ink/50 mt-2">No settlements yet.</p> : null}
        </div>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">Wallet and deploy management</h2>
        <p className="text-sm text-ink/65 mt-1 mb-4">
          Mainnet keys are not shown here. Admins see public addresses, purpose, and the exact operational next step; private keys stay in gitignored vault files.
        </p>
        <div className="grid lg:grid-cols-3 gap-3">
          {WALLET_RUNBOOK.map((wallet) => (
            <div key={wallet.label} className="border border-ink/10 rounded-lg p-4 bg-paper">
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{wallet.label}</h3>
                <StatusBadge ok={wallet.status !== "awaiting funding"}>{wallet.status}</StatusBadge>
              </div>
              <div className="text-xs text-ink/50 mt-1">{wallet.network}</div>
              <div className="font-mono text-xs break-all mt-3">{short(wallet.address)}</div>
              <p className="text-xs text-ink/60 mt-3">{wallet.role}</p>
            </div>
          ))}
        </div>
        <pre className="mt-4 bg-ink/5 rounded-lg p-3 overflow-x-auto text-xs font-mono leading-relaxed">
{`# Base mainnet readiness
python contracts/deploy.py base-mainnet --secret-file contracts/.base-mainnet.deployer.secret.json --check-only

# After the deployer has >= 0.005 ETH on Base
python contracts/deploy.py base-mainnet --secret-file contracts/.base-mainnet.deployer.secret.json`}
        </pre>
      </section>

      <WalletManagement />
    </div>
  );
}

function AdminMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-cream/70 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink/45 font-semibold">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
