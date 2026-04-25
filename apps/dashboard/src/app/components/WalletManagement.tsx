"use client";

import { useEffect, useMemo, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const TRANSFER_SELECTOR = "0xa9059cbb";

type Vault = {
  id: string;
  label: string;
  networkClass: "mainnet" | "testnet";
  chainId: number;
  chainName: string;
  rpc: string;
  explorer: string;
  nativeSymbol: string;
  usdc: `0x${string}`;
  address: `0x${string}`;
  role: string;
};

type VaultBalance = {
  native: bigint | null;
  usdc: bigint | null;
  error?: string;
};

type GeneratedWallet = { address: string; privateKey: string } | null;

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    coinbaseWalletExtension?: EthereumProvider;
  }
}

const VAULTS: Vault[] = [
  {
    id: "arbitrum-proof-receiver",
    label: "Arbitrum proof receiver",
    networkClass: "mainnet",
    chainId: 42161,
    chainName: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    nativeSymbol: "ETH",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    address: "0x8b9d5e87a36e9A77A3d515Ca64c9C236004ECdb4",
    role: "Recipient wallet from the real Arbitrum One USDC proof transfer.",
  },
  {
    id: "arbitrum-proof-payer",
    label: "Arbitrum proof payer",
    networkClass: "mainnet",
    chainId: 42161,
    chainName: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    nativeSymbol: "ETH",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    address: "0xf97eDfc84b4e8CF8DE8fb18F3016C84106cFa614",
    role: "Funding wallet that sent the real mainnet USDC proof transfer.",
  },
  {
    id: "arbitrum-bond-vault",
    label: "Arbitrum One BondVault",
    networkClass: "mainnet",
    chainId: 42161,
    chainName: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    nativeSymbol: "ETH",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    address: "0x140A306E5c51C8521827e9be1E5167399dc31c75",
    role: "Real-funds mainnet proof vault and settlement anchor.",
  },
  {
    id: "arc-bond-vault",
    label: "Arc Testnet BondVault",
    networkClass: "testnet",
    chainId: 5042002,
    chainName: "Arc Testnet",
    rpc: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    nativeSymbol: "USDC",
    usdc: "0x3600000000000000000000000000000000000000",
    address: "0x00792829C3553B95A84bafe33c76E93570D0AbA4",
    role: "Arc-native ProofMesh staking and slashing vault.",
  },
  {
    id: "arc-deployer",
    label: "Arc Testnet deployer",
    networkClass: "testnet",
    chainId: 5042002,
    chainName: "Arc Testnet",
    rpc: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    nativeSymbol: "USDC",
    usdc: "0x3600000000000000000000000000000000000000",
    address: "0x5257613C0a0b87405d08B21c62Be3F65CbD0a5bF",
    role: "Owner/deployer for Arc Testnet proof contracts.",
  },
  {
    id: "base-deployer",
    label: "Base Mainnet deployer",
    networkClass: "mainnet",
    chainId: 8453,
    chainName: "Base",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    address: "0x3854510d4C159d5d97646d4CBfEEc06BEF983E66",
    role: "Fallback deployment wallet; fund with ETH gas before Base deployment.",
  },
];

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function formatUnits(value: bigint | null, decimals: number, digits = 6): string {
  if (value == null) return "—";
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  const padded = fraction.toString().padStart(decimals, "0").slice(0, digits);
  return `${whole.toString()}.${padded}`;
}

function toHexQuantity(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

function decimalToAtomic(value: string, decimals: number): bigint {
  const clean = value.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("Enter a positive decimal amount.");
  const [whole, frac = ""] = clean.split(".");
  const fraction = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction || "0");
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function rpc<T>(vault: Vault, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(vault.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error(`${vault.chainName} RPC HTTP ${response.status}`);
  const json = (await response.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

async function readVault(vault: Vault): Promise<VaultBalance> {
  try {
    const nativeHex = await rpc<string>(vault, "eth_getBalance", [vault.address, "latest"]);
    const data = `0x70a08231${padAddress(vault.address)}`;
    const usdcHex = await rpc<string>(vault, "eth_call", [{ to: vault.usdc, data }, "latest"]);
    return { native: BigInt(nativeHex), usdc: BigInt(usdcHex) };
  } catch (err) {
    return { native: null, usdc: null, error: (err as Error).message };
  }
}

function providerName(provider?: EthereumProvider): string {
  if (!provider) return "No injected wallet found";
  return window.coinbaseWalletExtension === provider ? "Coinbase Wallet" : "MetaMask / injected wallet";
}

export function WalletManagement() {
  const [balances, setBalances] = useState<Record<string, VaultBalance>>({});
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<EthereumProvider | undefined>(undefined);
  const [account, setAccount] = useState<string>("");
  const [generated, setGenerated] = useState<GeneratedWallet>(null);
  const [selectedVault, setSelectedVault] = useState(VAULTS[0]!.id);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [asset, setAsset] = useState<"native" | "usdc">("native");
  const [lastTx, setLastTx] = useState<string>("");

  const selected = VAULTS.find((v) => v.id === selectedVault) ?? VAULTS[0]!;

  const totals = useMemo(() => {
    const out = { mainnetUsdc: 0n, testnetUsdc: 0n, mainnetNative: 0n, testnetNative: 0n };
    for (const vault of VAULTS) {
      const balance = balances[vault.id];
      if (!balance) continue;
      if (vault.networkClass === "mainnet") {
        out.mainnetUsdc += balance.usdc ?? 0n;
        out.mainnetNative += balance.native ?? 0n;
      } else {
        out.testnetUsdc += balance.usdc ?? 0n;
        out.testnetNative += balance.native ?? 0n;
      }
    }
    return out;
  }, [balances]);

  async function refresh() {
    setLoading(true);
    try {
      const entries = await Promise.all(VAULTS.map(async (vault) => [vault.id, await readVault(vault)] as const));
      setBalances(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setProvider(window.ethereum ?? window.coinbaseWalletExtension);
    void refresh();
  }, []);

  async function connectWallet() {
    const p = provider ?? window.ethereum ?? window.coinbaseWalletExtension;
    if (!p) {
      alert("Install MetaMask or Coinbase Wallet first.");
      return;
    }
    setProvider(p);
    const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
    setAccount(accounts[0] ?? "");
  }

  async function switchNetwork(vault: Vault) {
    if (!provider) throw new Error("Connect a browser wallet first.");
    const chainId = toHexQuantity(BigInt(vault.chainId));
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId, chainName: vault.chainName, nativeCurrency: { name: vault.nativeSymbol, symbol: vault.nativeSymbol, decimals: 18 }, rpcUrls: [vault.rpc], blockExplorerUrls: [vault.explorer] }],
      });
    }
  }

  function generateLocalWallet() {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    setGenerated({ address: account.address, privateKey });
  }

  async function sendDeposit() {
    if (!provider || !account) {
      alert("Connect MetaMask or Coinbase Wallet first.");
      return;
    }
    await switchNetwork(selected);
    const decimals = asset === "usdc" ? 6 : 18;
    const value = decimalToAtomic(amount, decimals);
    const tx = asset === "native"
      ? { from: account, to: selected.address, value: toHexQuantity(value) }
      : { from: account, to: selected.usdc, data: `${TRANSFER_SELECTOR}${padAddress(selected.address)}${value.toString(16).padStart(64, "0")}` };
    const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
    setLastTx(hash);
  }

  async function sendWithdrawal() {
    if (!provider || !account) {
      alert("Connect the wallet that controls the funds first.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient.trim())) {
      alert("Recipient must be an EVM address.");
      return;
    }
    await switchNetwork(selected);
    const decimals = asset === "usdc" ? 6 : 18;
    const value = decimalToAtomic(amount, decimals);
    const to = recipient.trim() as `0x${string}`;
    const tx = asset === "native"
      ? { from: account, to, value: toHexQuantity(value) }
      : { from: account, to: selected.usdc, data: `${TRANSFER_SELECTOR}${padAddress(to)}${value.toString(16).padStart(64, "0")}` };
    const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
    setLastTx(hash);
  }

  return (
    <section className="card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Wallet and vault management</h2>
          <p className="text-sm text-ink/65 max-w-3xl">
            Read-only vault balances are fetched from public RPCs. Deposits and withdrawals are client-signed through MetaMask or Coinbase Wallet; PicoFlow never receives private keys.
          </p>
        </div>
        <button onClick={refresh} className="px-3 py-1.5 rounded border border-ink/20 text-sm hover:bg-ink/5">{loading ? "Refreshing…" : "Refresh balances"}</button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald/20 bg-emerald/5 p-4">
          <div className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">Mainnet totals</div>
          <div className="text-2xl font-semibold mt-1">{formatUnits(totals.mainnetUsdc, 6)} USDC</div>
          <div className="font-mono text-xs text-ink/60 mt-1">{formatUnits(totals.mainnetNative, 18, 6)} ETH gas</div>
          <p className="text-xs text-ink/55 mt-1">ERC-20 USDC across all listed Arbitrum/Base mainnet accounts, including the real proof payer and receiver. Native gas is shown separately, not converted to USDC.</p>
        </div>
        <div className="rounded-xl border border-amber/30 bg-amber/5 p-4">
          <div className="text-xs uppercase tracking-wider text-amber-700 font-semibold">Testnet totals</div>
          <div className="text-2xl font-semibold mt-1">{formatUnits(totals.testnetUsdc, 6)} USDC</div>
          <div className="font-mono text-xs text-ink/60 mt-1">{formatUnits(totals.testnetNative, 18, 6)} native gas</div>
          <p className="text-xs text-ink/55 mt-1">Testnet ERC-20/faucet token balances are shown separately from native gas so large gas wei balances are not mislabeled as 6-decimal USDC.</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-3">
        {VAULTS.map((vault) => {
          const balance = balances[vault.id];
          return (
            <div key={vault.id} className="rounded-xl border border-ink/10 bg-paper p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{vault.label}</h3>
                <span className="rounded-full border border-ink/10 px-2 py-0.5 text-[10px] uppercase text-ink/55">{vault.networkClass}</span>
              </div>
              <a className="font-mono text-xs text-indigo hover:underline break-all mt-2 block" href={`${vault.explorer}/address/${vault.address}`} target="_blank" rel="noreferrer">{short(vault.address)}</a>
              <p className="text-xs text-ink/60 mt-2">{vault.role}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-ink/5 p-2"><div className="text-ink/45">Native</div><div className="font-mono">{formatUnits(balance?.native ?? null, 18, 6)} {vault.nativeSymbol}</div></div>
                <div className="rounded-lg bg-ink/5 p-2"><div className="text-ink/45">USDC</div><div className="font-mono">{formatUnits(balance?.usdc ?? null, 6)} USDC</div></div>
              </div>
              {balance?.error ? <p className="text-xs text-coral mt-2">{balance.error}</p> : null}
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-ink/10 bg-cream/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Browser wallet operations</h3>
              <p className="text-xs text-ink/60">Provider: {providerName(provider)}</p>
            </div>
            <button onClick={connectWallet} className="px-3 py-1.5 rounded bg-indigo text-white text-sm font-semibold hover:bg-indigo/90">{account ? short(account) : "Connect wallet"}</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm"><span className="block text-xs uppercase text-ink/50 mb-1">Vault / network</span><select className="w-full rounded border border-ink/20 px-2 py-1" value={selectedVault} onChange={(e) => setSelectedVault(e.target.value)}>{VAULTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
            <label className="text-sm"><span className="block text-xs uppercase text-ink/50 mb-1">Asset</span><select className="w-full rounded border border-ink/20 px-2 py-1" value={asset} onChange={(e) => setAsset(e.target.value as "native" | "usdc")}><option value="native">Native gas token</option><option value="usdc">USDC token</option></select></label>
            <label className="text-sm"><span className="block text-xs uppercase text-ink/50 mb-1">Amount</span><input className="w-full rounded border border-ink/20 px-2 py-1 font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.001" /></label>
            <label className="text-sm"><span className="block text-xs uppercase text-ink/50 mb-1">Withdraw recipient</span><input className="w-full rounded border border-ink/20 px-2 py-1 font-mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => switchNetwork(selected)} className="px-3 py-1.5 rounded border border-ink/20 text-sm hover:bg-ink/5">Switch to {selected.chainName}</button>
            <button onClick={sendDeposit} className="px-3 py-1.5 rounded bg-emerald text-white text-sm font-semibold">Deposit to selected vault</button>
            <button onClick={sendWithdrawal} className="px-3 py-1.5 rounded border border-coral text-coral text-sm hover:bg-coral/10">Withdraw / send from connected wallet</button>
          </div>
          {lastTx ? <a className="font-mono text-xs text-indigo hover:underline" href={`${selected.explorer}/tx/${lastTx}`} target="_blank" rel="noreferrer">Last tx {short(lastTx)}</a> : null}
        </div>

        <div className="rounded-xl border border-ink/10 bg-cream/60 p-4 space-y-3">
          <h3 className="font-semibold">Generate client wallet</h3>
          <p className="text-xs text-ink/60">Creates an Ethereum EOA locally in this browser. Store the private key offline immediately; it is not sent to PicoFlow.</p>
          <button onClick={generateLocalWallet} className="px-3 py-1.5 rounded border border-ink/20 text-sm hover:bg-ink/5">Generate local wallet</button>
          {generated ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-ink/5 p-2"><div className="text-xs text-ink/45">Address</div><div className="font-mono text-xs break-all">{generated.address}</div></div>
              <div className="rounded-lg bg-coral/5 border border-coral/20 p-2"><div className="text-xs text-coral font-semibold">Private key — save once, never commit</div><div className="font-mono text-xs break-all">{generated.privateKey}</div></div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
