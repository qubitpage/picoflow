"use client";
import { useEffect, useRef, useState } from "react";

type DemoState = {
  status: "idle" | "running" | "ok" | "fail";
  started_at: number | null;
  finished_at: number | null;
  logs: string[];
  report: Record<string, unknown> | null;
  error: string | null;
  selected_chain: SelectedChain | null;
};

type SelectedChain = {
  id: string;
  chain_id: number;
  name: string;
  is_mainnet: boolean;
  native_symbol: string;
  explorer: string;
  usdc: string;
};

type ChainItem = {
  id: string;
  chain_id: number;
  name: string;
  is_mainnet: boolean;
  native_symbol: string;
  explorer: string;
  usdc: string;
  contracts_deployed: boolean;
  active: boolean;
};

const API_BASE = "/api"; // proxied by nginx → sellers:3030

export default function DemoRunner() {
  const [state, setState] = useState<DemoState>({
    status: "idle", started_at: null, finished_at: null, logs: [], report: null, error: null, selected_chain: null,
  });
  const [chains, setChains] = useState<ChainItem[]>([]);
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  async function poll() {
    try {
      const r = await fetch(`${API_BASE}/demo/state`, { cache: "no-store" });
      if (r.ok) setState(await r.json());
    } catch { /* ignore */ }
  }

  async function loadChains() {
    try {
      const r = await fetch(`${API_BASE}/chains`, { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { active_chain_id: number; items: ChainItem[] };
      const available = data.items.filter((c) => c.contracts_deployed || c.active);
      setChains(available);
      setSelectedChainId((current) => current ?? data.active_chain_id ?? available[0]?.chain_id ?? null);
    } catch { /* ignore */ }
  }

  async function run() {
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/demo/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain_id: selectedChainId }),
      });
      if (!r.ok && r.status !== 409) {
        const t = await r.text();
        alert(`Failed to start demo: ${t}`);
      }
    } finally {
      setBusy(false);
      poll();
    }
  }

  useEffect(() => {
    loadChains();
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.logs]);

  const elapsed = state.started_at
    ? `${(((state.finished_at ?? Date.now()) - state.started_at) / 1000).toFixed(1)}s`
    : "—";
  const statusColor =
    state.status === "running" ? "bg-amber text-white" :
    state.status === "ok" ? "bg-emerald text-white" :
    state.status === "fail" ? "bg-coral text-white" :
    "bg-ink/10 text-ink";
  const terminalHref = `${API_BASE}/demo/state?format=terminal`;
  const networkParam = state.selected_chain?.chain_id ?? selectedChainId ?? "all";

  return (
    <div className="card space-y-4">
      <div className="rounded-xl border border-ink/10 bg-paper p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink/50">Choose network before running</div>
            <p className="mt-1 max-w-2xl text-sm text-ink/65">
              The buyer agent sends the selected chain into the x402 challenge flow. Mainnet demonstrates live real-funds rails; Arc Testnet demonstrates the sponsor-native rehearsal path.
            </p>
          </div>
          <a href="/network" className="text-sm text-indigo hover:underline">Open network explorer →</a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {chains.map((chain) => (
            <button
              key={chain.id}
              type="button"
              disabled={state.status === "running"}
              onClick={() => setSelectedChainId(chain.chain_id)}
              className={
                "rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-50 " +
                (selectedChainId === chain.chain_id
                  ? "border-indigo bg-indigo/10 text-indigo"
                  : "border-ink/15 hover:border-indigo/40 hover:bg-indigo/5")
              }
            >
              <div className="font-semibold">{chain.active ? "● " : ""}{chain.name}</div>
              <div className="font-mono text-[11px] text-ink/55">chainId {chain.chain_id} · {chain.is_mainnet ? "mainnet" : "testnet"} · {chain.native_symbol}</div>
            </button>
          ))}
          {chains.length === 0 ? <span className="text-sm text-ink/50">Loading connected networks…</span> : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={busy || state.status === "running" || !selectedChainId}
          className="bg-indigo text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.status === "running" ? "Running…" : "Run demo"}
        </button>
        <span className={`text-xs uppercase tracking-wide rounded px-2 py-1 ${statusColor}`}>
          {state.status}
        </span>
        <span className="text-sm text-ink/60">elapsed: <span className="font-mono">{elapsed}</span></span>
        {state.selected_chain ? (
          <span className="text-xs rounded border border-ink/15 px-2 py-1 text-ink/65">
            {state.selected_chain.name} · {state.selected_chain.is_mainnet ? "mainnet" : "testnet"}
          </span>
        ) : null}
        <a
          href="/"
          className="ml-auto text-sm text-indigo hover:underline"
        >
          → Live ledger
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        <a className="rounded border border-ink/15 px-3 py-2 text-indigo hover:bg-indigo/5" href={`/splits?network=${networkParam}`}>Splits for network</a>
        <a className="rounded border border-ink/15 px-3 py-2 text-indigo hover:bg-indigo/5" href={`/registry?network=${networkParam}`}>Registry calls</a>
        <a className="rounded border border-ink/15 px-3 py-2 text-indigo hover:bg-indigo/5" href={`/proofmesh?network=${networkParam}`}>ProofMesh lane</a>
        <a className="rounded border border-ink/15 px-3 py-2 text-indigo hover:bg-indigo/5" href={`/console?network=${networkParam}`}>Operator console</a>
        <a className="rounded border border-ink/15 px-3 py-2 text-indigo hover:bg-indigo/5" href={terminalHref} target="_blank" rel="noreferrer">Terminal transcript ↗</a>
      </div>

      {state.report ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ["actions ok", String(state.report.ok ?? "—")],
            ["plan size", String(state.report.plan_size ?? "—")],
            ["spent USDC", String(state.report.spent_usdc ?? "—")],
            ["network", String((state.report.network as { name?: string } | undefined)?.name ?? state.selected_chain?.name ?? "—")],
            ["elapsed", String(state.report.elapsed_human ?? "—")],
          ].map(([k, v]) => (
            <div key={k} className="bg-paper rounded-lg p-3 border border-ink/5">
              <div className="text-[10px] uppercase tracking-wider text-ink/50">{k}</div>
              <div className="font-mono text-lg">{v}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-xs uppercase tracking-wider text-ink/50">Live terminal tail</div>
          <a href={terminalHref} target="_blank" rel="noreferrer" className="text-xs text-indigo hover:underline">open full terminal transcript ↗</a>
        </div>
        <pre
          ref={logRef}
          className="bg-ink text-cream rounded-lg p-4 text-xs overflow-y-auto h-72 font-mono"
        >
          {state.logs.length === 0 ? "(no output yet — click Run demo)" : state.logs.join("\n")}
        </pre>
      </div>

      {state.error ? (
        <div className="bg-coral/10 text-coral text-sm rounded-lg p-3">
          Error: {state.error}
        </div>
      ) : null}
    </div>
  );
}
