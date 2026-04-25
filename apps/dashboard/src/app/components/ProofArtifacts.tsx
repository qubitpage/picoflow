import { REAL_PROOFS, addressLink, shortAddress, shortHash, txLink } from "@/lib/proofLinks";

export function ProofArtifacts({ title = "Direct proof artifacts" }: { title?: string }) {
  const items = [
    { label: "Arbitrum real-funds tx", value: shortHash(REAL_PROOFS.mainnet.latestTx), href: txLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.latestTx) },
    { label: "Mainnet BondVault", value: shortAddress(REAL_PROOFS.mainnet.contracts.bondVault), href: addressLink(REAL_PROOFS.mainnet.chainId, REAL_PROOFS.mainnet.contracts.bondVault) },
    { label: "Arc Testnet BondVault", value: shortAddress(REAL_PROOFS.arcTestnet.contracts.bondVault), href: addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault) },
    { label: "Arc faucet tx", value: shortHash(REAL_PROOFS.arcTestnet.faucetTx), href: txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx) },
  ];
  return (
    <section className="card">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <p className="text-sm text-ink/65 mb-3">Exact explorer URLs for real transactions and deployed contracts only; no generic explorer homepages.</p>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        {items.map((item) => (
          <a key={item.label} href={item.href} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
            <div className="text-xs uppercase tracking-wider text-ink/50">{item.label}</div>
            <div className="font-mono text-xs text-indigo mt-1">{item.value}</div>
          </a>
        ))}
      </div>
    </section>
  );
}