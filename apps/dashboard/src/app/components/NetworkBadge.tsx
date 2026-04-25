/**
 * Live network status badge — server component. Renders a small pill that
 * shows whether the platform is currently settling on mainnet or testnet, with
 * a link to the /network page for full chain details. Uses the public
 * /api/network endpoint so no admin token is required.
 */
const SELLER_BASE = process.env.SELLER_BASE ?? "http://sellers:3030";

interface NetworkInfo {
  ok: boolean;
  chain_id: number;
  network_name: string;
  is_mainnet: boolean;
  relayer_configured: boolean;
}

async function fetchNetwork(): Promise<NetworkInfo | null> {
  try {
    const r = await fetch(`${SELLER_BASE}/api/network`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as NetworkInfo;
  } catch {
    return null;
  }
}

export async function NetworkBadge() {
  const n = await fetchNetwork();
  if (!n) {
    return (
      <div className="inline-block px-3 py-1 rounded-full bg-ink/10 text-ink/60 text-xs font-semibold uppercase tracking-wider mb-4">
        Sub-cent payments for AI agents
      </div>
    );
  }
  const color = n.is_mainnet
    ? "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30"
    : "bg-amber-500/15 text-amber-700 border border-amber-500/30";
  const dot = n.is_mainnet ? "bg-emerald-500" : "bg-amber-500";
  const label = n.is_mainnet
    ? `Live on ${n.network_name} mainnet · real USDC`
    : `${n.network_name} · testnet rehearsal`;
  return (
    <a
      href="/network"
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-4 hover:opacity-80 transition ${color}`}
    >
      <span className={`w-2 h-2 rounded-full ${dot} animate-pulse`} />
      {label}
      <span className="opacity-70 normal-case font-normal">· chain {n.chain_id}</span>
    </a>
  );
}
