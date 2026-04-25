/**
 * /network — Live chain & contract control panel.
 *
 * Production-ready operator view that shows what chain the sellers process is
 * currently bound to (testnet/mainnet/Arc/Arbitrum), the deployed contracts
 * with explorer links, and live wallet balances pulled from RPC.
 *
 * Designed to remain identical when Arc Mainnet ships — only the chain config
 * (server-side env) changes.
 */
import { ChainExplorer } from "./ChainExplorer";
import { REAL_PROOFS, addressLink, shortAddress, shortHash, txLink } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NetworkInfo = {
  ok: boolean;
  chain_id: number;
  network_name: string;
  is_mainnet: boolean;
  rpc: string;
  explorer: string;
  usdc: string;
  native_symbol: string;
  gateway_wallet: string | null;
  gateway_minter: string | null;
  relayer_configured: boolean;
  contracts: {
    bond_vault: string | null;
    reputation: string | null;
    metadata: string | null;
  };
};

const API_BASE =
  process.env.PICOFLOW_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://picoflow.qubitpage.com";

async function fetchNetwork(): Promise<NetworkInfo | null> {
  try {
    const r = await fetch(`${API_BASE}/api/network`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as NetworkInfo;
  } catch {
    return null;
  }
}

async function rpcCall(rpc: string, method: string, params: unknown[]): Promise<string | null> {
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: string };
    return typeof j.result === "string" ? j.result : null;
  } catch {
    return null;
  }
}

async function getEthBalance(rpc: string, address: string): Promise<number | null> {
  const hex = await rpcCall(rpc, "eth_getBalance", [address, "latest"]);
  if (!hex) return null;
  return Number(BigInt(hex)) / 1e18;
}

async function getUsdcBalance(rpc: string, usdc: string, address: string): Promise<number | null> {
  // ERC20 balanceOf(address) — selector 0x70a08231
  const data = `0x70a08231${address.replace(/^0x/, "").padStart(64, "0").toLowerCase()}`;
  const hex = await rpcCall(rpc, "eth_call", [{ to: usdc, data }, "latest"]);
  if (!hex || hex === "0x") return null;
  return Number(BigInt(hex)) / 1e6;
}

function shortAddr(a: string | null): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function explorerAddr(explorer: string, addr: string): string {
  return `${explorer.replace(/\/+$/, "")}/address/${addr}`;
}

type ChainItem = {
  id: string;
  chain_id: number;
  name: string;
  is_mainnet: boolean;
  native_symbol: string;
  explorer: string;
  faucet?: string;
  usdc: string;
  contracts_deployed: boolean;
  active: boolean;
};
type ChainsResp = { ok: boolean; active_chain_id: number; items: ChainItem[] };

async function fetchChains(): Promise<ChainsResp | null> {
  try {
    const r = await fetch(`${API_BASE}/api/chains`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ChainsResp;
  } catch {
    return null;
  }
}

const DEPLOYER = "0x3854510d4C159d5d97646d4CBfEEc06BEF983E66";

export default async function NetworkPage() {
  const [net, chains] = await Promise.all([fetchNetwork(), fetchChains()]);

  if (!net) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Network</h1>
        <div className="card border-red-500/40">
          <p className="text-red-400">/api/network unreachable. Sellers process may be down.</p>
        </div>
      </div>
    );
  }

  const balances: Record<string, { eth: number | null; usdc: number | null }> = {};
  const watchedAddresses: Array<{ key: string; addr: string }> = [
    { key: "deployer", addr: DEPLOYER },
  ];
  if (net.gateway_wallet) watchedAddresses.push({ key: "gateway_wallet", addr: net.gateway_wallet });
  if (net.gateway_minter) watchedAddresses.push({ key: "gateway_minter", addr: net.gateway_minter });

  await Promise.all(
    watchedAddresses.map(async (w) => {
      const [eth, usdc] = await Promise.all([
        getEthBalance(net.rpc, w.addr),
        getUsdcBalance(net.rpc, net.usdc, w.addr),
      ]);
      balances[w.key] = { eth, usdc };
    }),
  );

  const accent = net.is_mainnet ? "border-emerald/40" : "border-amber/40";
  const banner = net.is_mainnet ? "bg-emerald/10 text-emerald" : "bg-amber/10 text-amber";

  return (
    <div className="space-y-8">
      <div className={`rounded-lg border ${accent} p-4 ${banner} flex items-center gap-3 flex-wrap`}>
        <span className="font-mono text-sm uppercase tracking-wider">
          {net.is_mainnet ? "● MAINNET LIVE" : "○ TESTNET"}
        </span>
        <span className="font-semibold">{net.network_name}</span>
        <span className="opacity-60">chainId {net.chain_id}</span>
        <span className="opacity-60">native {net.native_symbol}</span>
        <span className="opacity-60">relayer {net.relayer_configured ? "✓" : "✗"}</span>
      </div>

      <div>
        <h1 className="text-3xl font-semibold">Network & Contracts</h1>
        <p className="text-ink/70 mt-2 max-w-3xl">
          Live chain configuration plus every connected network returned by /api/chains. Arbitrum One is the current
          real-funds mainnet proof, Arc Testnet is the sponsor-native rehearsal, and Arc Mainnet is listed only after it is public.
          The same binary switches networks by server-side environment and contract addresses, not by UI hardcoding.
        </p>
      </div>

      {chains && chains.items.length > 0 ? (
        <ChainExplorer items={chains.items} activeChainId={chains.active_chain_id} />
      ) : null}

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Direct proof artifacts</h2>
        <p className="text-sm text-ink/65 mb-3">These are exact transaction or contract URLs, not generic explorer homepages.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <a href={txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Arbitrum real-funds tx</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortHash(REAL_PROOFS.mainnet.latestTx)}</div>
          </a>
          <a href={addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.contracts.bondVault)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Mainnet BondVault</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortAddress(REAL_PROOFS.mainnet.contracts.bondVault)}</div>
          </a>
          <a href={addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Arc Testnet BondVault</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)}</div>
          </a>
          <a href={txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx)} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">Arc faucet tx</div>
            <div className="font-mono text-xs text-indigo mt-1">{shortHash(REAL_PROOFS.arcTestnet.faucetTx)}</div>
          </a>
        </div>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Chain config</h2>
        <table className="w-full text-sm">
          <tbody className="font-mono">
            <Row label="Network" value={net.network_name} />
            <Row label="Chain ID" value={String(net.chain_id)} />
            <Row label="RPC" value={net.rpc} />
            <Row
              label="Real proof tx"
              value={net.chain_id === REAL_PROOFS.arcTestnet.chainId ? REAL_PROOFS.arcTestnet.faucetTx : REAL_PROOFS.mainnet.latestTx}
              link={txLink(net.chain_id === REAL_PROOFS.arcTestnet.chainId ? REAL_PROOFS.arcTestnet.chainId : REAL_PROOFS.mainnet.chainId, net.chain_id === REAL_PROOFS.arcTestnet.chainId ? REAL_PROOFS.arcTestnet.faucetTx : REAL_PROOFS.mainnet.latestTx)}
              tag={net.chain_id === REAL_PROOFS.arcTestnet.chainId ? `Arc faucet ${shortHash(REAL_PROOFS.arcTestnet.faucetTx)}` : `Mainnet USDC ${shortHash(REAL_PROOFS.mainnet.latestTx)}`}
            />
            <Row
              label="USDC"
              value={net.usdc}
              link={explorerAddr(net.explorer, net.usdc)}
              tag="ERC-20"
            />
            <Row label="Native gas" value={net.native_symbol} />
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">PicoFlow Vyper contracts</h2>
        <table className="w-full text-sm">
          <tbody className="font-mono">
            <ContractRow
              name="BondVault"
              addr={net.contracts.bond_vault}
              explorer={net.explorer}
              desc="Stakes provider bonds, slashes on failed validation"
            />
            <ContractRow
              name="ReputationRegistry"
              addr={net.contracts.reputation}
              explorer={net.explorer}
              desc="On-chain provider reputation scores"
            />
            <ContractRow
              name="MetadataLogger"
              addr={net.contracts.metadata}
              explorer={net.explorer}
              desc="Append-only call metadata for audit trail"
            />
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Live wallet balances</h2>
        <p className="text-xs text-ink/60 mb-3">Read directly from {net.rpc} at request time.</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/60 text-xs uppercase">
              <th className="py-2">Role</th>
              <th>Address</th>
              <th className="text-right">{net.native_symbol}</th>
              <th className="text-right">USDC</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {watchedAddresses.map((w) => {
              const b = balances[w.key];
              return (
                <tr key={w.key} className="border-t border-ink/10">
                  <td className="py-2 capitalize">{w.key.replace(/_/g, " ")}</td>
                  <td>
                    <a
                      href={explorerAddr(net.explorer, w.addr)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {shortAddr(w.addr)}
                    </a>
                  </td>
                  <td className="text-right">
                    {b && b.eth != null ? b.eth.toFixed(6) : "—"}
                  </td>
                  <td className="text-right">
                    {b && b.usdc != null ? b.usdc.toFixed(4) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold mb-3">Try it</h2>
        <p className="text-ink/70 text-sm mb-3">
          Run the autonomous buyer→seller demo against this exact chain. Every call settles real
          USDC on {net.network_name}.
        </p>
        <div className="flex gap-3 flex-wrap">
          <a href="/demo" className="btn btn-primary">
            Run live demo
          </a>
          <a href="/console" className="btn">
            Open API console
          </a>
          <a href="/margin" className="btn">
            Live margin
          </a>
          <a href={explorerAddr(net.explorer, DEPLOYER)} target="_blank" rel="noreferrer" className="btn">
            View deployer {shortAddress(DEPLOYER)} ↗
          </a>
        </div>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  link,
  tag,
}: {
  label: string;
  value: string;
  link?: string;
  tag?: string;
}) {
  return (
    <tr className="border-t border-ink/10">
      <td className="py-2 pr-4 text-ink/60 not-italic font-sans">{label}</td>
      <td className="py-2 break-all">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
        {tag ? <span className="ml-2 text-xs text-ink/50 font-sans">[{tag}]</span> : null}
      </td>
    </tr>
  );
}

function ContractRow({
  name,
  addr,
  explorer,
  desc,
}: {
  name: string;
  addr: string | null;
  explorer: string;
  desc: string;
}) {
  return (
    <tr className="border-t border-ink/10 align-top">
      <td className="py-2 pr-4 font-sans">
        <div className="font-semibold">{name}</div>
        <div className="text-xs text-ink/60">{desc}</div>
      </td>
      <td className="py-2 break-all">
        {addr ? (
          <a
            href={explorerAddr(explorer, addr)}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {addr}
          </a>
        ) : (
          <span className="text-ink/50">not configured</span>
        )}
      </td>
    </tr>
  );
}
