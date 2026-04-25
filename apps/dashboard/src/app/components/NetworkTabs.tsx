import Link from "next/link";
import type { ChainItem } from "@/lib/chains";

type Props = {
  basePath: string;
  selected: string;
  chains: ChainItem[];
  counts?: Record<string, string | number | undefined>;
  title?: string;
  note?: string;
};

function tabClass(active: boolean): string {
  return (
    "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition " +
    (active ? "border-indigo bg-indigo text-white" : "border-ink/15 text-ink/65 hover:border-indigo/40 hover:bg-indigo/5")
  );
}

function badgeCount(count: string | number | undefined) {
  if (count === undefined) return null;
  return <span className="rounded-full bg-white/20 px-1.5 font-mono text-[10px] opacity-80">{count}</span>;
}

function href(basePath: string, network: string): string {
  return `${basePath}?network=${encodeURIComponent(network)}&page=1`;
}

export function NetworkTabs({ basePath, selected, chains, counts = {}, title = "Networks", note }: Props) {
  const mainnets = chains.filter((c) => c.is_mainnet).length;
  const testnets = chains.length - mainnets;
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {note ? <p className="mt-1 max-w-3xl text-sm text-ink/65">{note}</p> : null}
        </div>
        <div className="text-xs text-ink/50">
          {chains.length} connected · {mainnets} mainnet · {testnets} testnet
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={href(basePath, "all")} className={tabClass(selected === "all")}>
          All {badgeCount(counts.all)}
        </Link>
        <Link href={href(basePath, "mainnet")} className={tabClass(selected === "mainnet")}>
          Mainnets {badgeCount(counts.mainnet)}
        </Link>
        <Link href={href(basePath, "testnet")} className={tabClass(selected === "testnet")}>
          Testnets {badgeCount(counts.testnet)}
        </Link>
        {chains.map((chain) => (
          <Link key={chain.id} href={href(basePath, String(chain.chain_id))} className={tabClass(selected === String(chain.chain_id))}>
            {chain.active ? "● " : ""}{chain.name} {badgeCount(counts[String(chain.chain_id)])}
          </Link>
        ))}
      </div>
    </section>
  );
}