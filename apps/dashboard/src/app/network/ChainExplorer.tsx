"use client";

import { useMemo, useState } from "react";
import { REAL_PROOFS, addressLink, shortAddress, shortHash, txLink } from "@/lib/proofLinks";

/**
 * Rich client-side chain explorer.
 *
 * Lets the operator (and judges) see every chain PicoFlow knows how to
 * settle on, filter by mainnet / testnet, click any chain to see its full
 * details, and compare any two side-by-side. The "active" chain (whatever
 * the seller process is currently bound to via ARC_CHAIN_ID) is highlighted.
 *
 * Pure UI — all data is server-fetched once via /api/chains and passed in.
 */

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

type Props = {
  items: ChainItem[];
  activeChainId: number;
};

type FilterMode = "all" | "mainnet" | "testnet";

function statusOf(c: ChainItem): { label: string; tone: "active" | "deployed" | "ready" } {
  if (c.active) return { label: "ACTIVE", tone: "active" };
  if (c.contracts_deployed) return { label: "DEPLOYED", tone: "deployed" };
  return { label: "READY", tone: "ready" };
}

function toneClasses(tone: "active" | "deployed" | "ready"): string {
  switch (tone) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/40";
    case "deployed":
      return "bg-indigo/15 text-indigo border-indigo/40";
    default:
      return "bg-ink/10 text-ink/60 border-ink/20";
  }
}

function shortHex(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function ChainExplorer({ items, activeChainId }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selected, setSelected] = useState<string>(
    items.find((c) => c.active)?.id ?? items[0]?.id ?? "",
  );
  const [compareWith, setCompareWith] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      items.filter((c) => {
        if (filter === "mainnet") return c.is_mainnet;
        if (filter === "testnet") return !c.is_mainnet;
        return true;
      }),
    [items, filter],
  );

  const active = items.find((c) => c.id === selected) ?? null;
  const peer = compareWith ? items.find((c) => c.id === compareWith) ?? null : null;

  const counts = {
    all: items.length,
    mainnet: items.filter((c) => c.is_mainnet).length,
    testnet: items.filter((c) => !c.is_mainnet).length,
    live: items.filter((c) => c.contracts_deployed).length,
  };

  return (
    <section className="card space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Pick a network</h2>
          <p className="text-xs text-ink/60 mt-1 max-w-xl">
            PicoFlow is chain-agnostic. Every chain below is preconfigured — the
            green <span className="text-emerald-700 font-semibold">ACTIVE</span> badge
            shows where the seller is settling right now. Click any card to
            inspect addresses; click <span className="font-semibold">Compare</span> on
            another card to set them side-by-side.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "mainnet", "testnet"] as FilterMode[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full border transition " +
                (filter === f
                  ? "bg-ink text-cream border-ink"
                  : "border-ink/20 text-ink/70 hover:bg-ink/5")
              }
            >
              {f} <span className="opacity-60 ml-1">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((c) => {
          const s = statusOf(c);
          const isSelected = c.id === selected;
          const isPeer = c.id === compareWith;
          const cardProof = c.chain_id === REAL_PROOFS.arcTestnet.chainId
            ? { label: "BondVault", href: addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault), value: shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault) }
            : c.chain_id === REAL_PROOFS.mainnet.chainId
              ? { label: "Real tx", href: txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx), value: shortHash(REAL_PROOFS.mainnet.latestTx) }
              : { label: "USDC", href: `${c.explorer.replace(/\/+$/, "")}/address/${c.usdc}`, value: shortAddress(c.usdc) };
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c.id)}
              className={
                "text-left rounded-lg border-2 p-3 transition relative " +
                (isSelected
                  ? "border-indigo bg-indigo/5 shadow-sm"
                  : isPeer
                  ? "border-amber/60 bg-amber/5"
                  : "border-ink/10 hover:border-ink/30 hover:bg-ink/5")
              }
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-sm truncate">{c.name}</span>
                <span
                  className={
                    "text-[9px] px-1.5 py-0.5 rounded border font-bold tracking-wider " +
                    toneClasses(s.tone)
                  }
                >
                  {s.label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-ink/60 font-mono">
                <span
                  className={
                    "px-1.5 py-0.5 rounded-full font-semibold uppercase " +
                    (c.is_mainnet
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "bg-amber-500/10 text-amber-700")
                  }
                >
                  {c.is_mainnet ? "mainnet" : "testnet"}
                </span>
                <span>id {c.chain_id}</span>
                <span>· {c.native_symbol}</span>
              </div>
              <div className="text-[10px] font-mono text-ink/50 mt-2 truncate" title={c.usdc}>
                USDC {shortHex(c.usdc)}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <a
                  href={cardProof.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] text-indigo hover:underline truncate"
                >
                  {cardProof.label}: <span className="font-mono">{cardProof.value}</span> ↗
                </a>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCompareWith(compareWith === c.id ? null : c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setCompareWith(compareWith === c.id ? null : c.id);
                    }
                  }}
                  className={
                    "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border cursor-pointer " +
                    (isPeer
                      ? "border-amber bg-amber/15 text-amber"
                      : "border-ink/15 text-ink/50 hover:border-ink/40")
                  }
                >
                  {isPeer ? "Comparing" : "Compare"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {active ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChainDetail title="Selected" highlight="indigo" chain={active} activeChainId={activeChainId} />
          {peer && peer.id !== active.id ? (
            <ChainDetail title="Compared" highlight="amber" chain={peer} activeChainId={activeChainId} />
          ) : (
            <div className="rounded-lg border border-dashed border-ink/15 p-4 text-center text-xs text-ink/50 flex items-center justify-center min-h-[200px]">
              Click <span className="mx-1 px-1.5 py-0.5 rounded border border-ink/20 font-semibold">Compare</span> on
              another card to render a side-by-side diff here.
            </div>
          )}
        </div>
      ) : null}

      <div className="rounded-lg bg-ink/5 border border-ink/10 px-3 py-2 text-[11px] text-ink/60 leading-relaxed">
        <span className="font-semibold text-ink/80">Switching chains</span> is a server
        env change: set <code className="font-mono">ARC_CHAIN_ID</code> to the target
        chain id and restart the seller. Contracts must be deployed on the new chain
        first (BondVault, ReputationRegistry, MetadataLogger). Active chain id today:{" "}
        <code className="font-mono font-semibold text-emerald-700">{activeChainId}</code>.
      </div>
    </section>
  );
}

function ChainDetail({
  title,
  chain,
  highlight,
  activeChainId,
}: {
  title: string;
  chain: ChainItem;
  highlight: "indigo" | "amber";
  activeChainId: number;
}) {
  const isActive = chain.chain_id === activeChainId;
  const proof = chain.chain_id === REAL_PROOFS.arcTestnet.chainId
    ? {
        label: "Arc BondVault",
        href: addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault),
        value: shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault),
      }
    : chain.chain_id === REAL_PROOFS.mainnet.chainId
      ? {
          label: "Real USDC tx",
          href: txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx),
          value: shortHash(REAL_PROOFS.mainnet.latestTx),
        }
      : {
          label: "USDC contract",
          href: `${chain.explorer.replace(/\/+$/, "")}/address/${chain.usdc}`,
          value: shortAddress(chain.usdc),
        };
  const headerClass = highlight === "indigo" ? "border-indigo/40 bg-indigo/5" : "border-amber/40 bg-amber/5";
  const dotClass = highlight === "indigo" ? "bg-indigo" : "bg-amber";
  return (
    <div className={`rounded-lg border-2 ${headerClass} p-4 space-y-2`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">{title}</span>
        {isActive ? (
          <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 bg-emerald-500/15 px-1.5 py-0.5 rounded">
            seller is here
          </span>
        ) : null}
      </div>
      <div className="text-xl font-semibold">{chain.name}</div>
      <div className="text-xs text-ink/60 flex flex-wrap gap-2">
        <span>chainId {chain.chain_id}</span>
        <span>· {chain.is_mainnet ? "mainnet" : "testnet"}</span>
        <span>· gas {chain.native_symbol}</span>
        <span>· contracts {chain.contracts_deployed ? "deployed" : "not yet"}</span>
      </div>
      <dl className="text-xs grid grid-cols-[6.5rem_1fr] gap-y-1.5 mt-3">
        <dt className="text-ink/50 uppercase tracking-wider text-[10px]">USDC</dt>
        <dd className="font-mono break-all">
          <a
            href={`${chain.explorer.replace(/\/+$/, "")}/address/${chain.usdc}`}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {chain.usdc}
          </a>
        </dd>
        <dt className="text-ink/50 uppercase tracking-wider text-[10px]">Proof link</dt>
        <dd>
          <a href={proof.href} target="_blank" rel="noreferrer" className="text-indigo hover:underline">
            {proof.label}: <span className="font-mono">{proof.value}</span> ↗
          </a>
        </dd>
        <dt className="text-ink/50 uppercase tracking-wider text-[10px]">Faucet</dt>
        <dd>
          {chain.faucet ? (
            <a href={chain.faucet} target="_blank" rel="noreferrer" className="text-indigo hover:underline">
              {new URL(chain.faucet).host} ↗
            </a>
          ) : (
            <span className="text-ink/40">— mainnet, no faucet</span>
          )}
        </dd>
        <dt className="text-ink/50 uppercase tracking-wider text-[10px]">Status</dt>
        <dd>
          {isActive ? (
            <span className="font-semibold text-emerald-700">Active — paid calls land here</span>
          ) : chain.contracts_deployed ? (
            <span className="font-semibold text-indigo">
              Contracts deployed — switch by setting ARC_CHAIN_ID={chain.chain_id}
            </span>
          ) : (
            <span className="text-ink/60">
              Preset only — deploy BondVault/Reputation/Metadata then switch ARC_CHAIN_ID
            </span>
          )}
        </dd>
      </dl>
    </div>
  );
}
