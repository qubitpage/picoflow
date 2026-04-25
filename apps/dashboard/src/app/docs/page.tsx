import fs from "node:fs";
import path from "node:path";
import { DocsTabs } from "./DocsTabs";
import { REAL_PROOFS, addressLink, shortAddress, shortHash, txLink } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DocEntry = {
  slug: string;
  title: string;
  category: string;
  description: string;
  pdf: { url: string; bytes: number } | null;
  html: { url: string; bytes: number } | null;
  source_md: string | null;
};
type Catalogue = { generated_at: string; docs: DocEntry[] };

function loadCatalogue(): Catalogue {
  const p = path.join(process.cwd(), "public", "docs", "index.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { generated_at: new Date().toISOString(), docs: [] };
  }
}

export default function DocsPage() {
  const cat = loadCatalogue();

  return (
    <div className="space-y-8">
      <div className="card bg-gradient-to-br from-cream to-indigo/5">
        <div className="text-[11px] uppercase tracking-wider text-indigo font-semibold">
          Mainnet proof · Arc readiness · full submission package
        </div>
        <h1 className="text-3xl font-semibold">PicoFlow — Docs &amp; Downloads</h1>
        <p className="text-ink/70 mt-2 max-w-4xl leading-relaxed">
          The public docs are now intentionally unified into two primary deliverables:
          <strong> one whitepaper</strong> and <strong>one pitch deck</strong>, each available as
          <strong> PDF</strong>, <strong>HTML</strong>, and <strong>Markdown</strong>. Generated{" "}
          <span className="font-mono text-xs">{new Date(cat.generated_at).toISOString()}</span>.
        </p>
        <p className="text-ink/70 mt-2 max-w-4xl leading-relaxed">
          The unified whitepaper includes the operations guide, delivery/test report,
          hard critique, Circle feedback, README, pitch outline, and video script as
          appendices. No separate clutter: navigate by tabs and by the whitepaper table
          of contents.
        </p>
        <p className="text-sm text-ink/60 mt-2">
          Rebuild with <code className="kbd">node scripts/build-docs.mjs</code>.
        </p>
      </div>

      {cat.docs.length > 0 ? <DocsTabs docs={cat.docs} /> : null}

      {cat.docs.length === 0 && (
        <div className="card text-center text-ink/60">
          No catalogue found. Run <code className="kbd">node scripts/build-docs.mjs</code> first.
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold mb-2">Source-of-truth links</h2>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>Live demo: <a className="text-indigo underline" href="/">picoflow.qubitpage.com</a></li>
          <li>Real-funds mainnet tx: <a className="text-indigo underline" href={txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx)} target="_blank" rel="noreferrer">{shortHash(REAL_PROOFS.mainnet.latestTx)} on Arbitrum One</a></li>
          <li>Mainnet USDC contract: <a className="text-indigo underline" href={addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.usdc)} target="_blank" rel="noreferrer">{shortAddress(REAL_PROOFS.mainnet.usdc)}</a></li>
          <li>Arc Testnet BondVault: <a className="text-indigo underline" href={addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault)} target="_blank" rel="noreferrer">{shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault)}</a></li>
          <li>Arc Testnet faucet tx used for deployer funding: <a className="text-indigo underline" href={txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx)} target="_blank" rel="noreferrer">{shortHash(REAL_PROOFS.arcTestnet.faucetTx)}</a></li>
          <li>Track alignment: <a className="text-indigo underline" href="/track">/track</a></li>
          <li>AI provider live status: <a className="text-indigo underline" href="/providers">/providers</a></li>
        </ul>
      </div>
    </div>
  );
}
