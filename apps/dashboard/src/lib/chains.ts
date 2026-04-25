export type ChainItem = {
  id: string;
  chain_id: number;
  name: string;
  is_mainnet: boolean;
  native_symbol: string;
  explorer: string;
  faucet?: string | null;
  usdc: string;
  contracts_deployed: boolean;
  active: boolean;
};

export type ChainsResp = { ok: boolean; active_chain_id: number; items: ChainItem[] };

const API_BASE =
  process.env.PICOFLOW_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://picoflow.qubitpage.com";

export async function fetchChains(): Promise<ChainsResp | null> {
  try {
    const r = await fetch(`${API_BASE}/api/chains`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as ChainsResp;
  } catch {
    return null;
  }
}

export function isNetworkSelected(chainId: number, selected: string, chains: ChainItem[]): boolean {
  if (selected === "all") return true;
  const chain = chains.find((c) => c.chain_id === chainId);
  if (selected === "mainnet") return Boolean(chain?.is_mainnet);
  if (selected === "testnet") return chain ? !chain.is_mainnet : false;
  return String(chainId) === selected;
}

export function networkName(chainId: number, chains: ChainItem[]): string {
  return chains.find((c) => c.chain_id === chainId)?.name ?? `chain ${chainId}`;
}

export function normalizeNetwork(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() ? raw.trim() : "all";
}

export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}