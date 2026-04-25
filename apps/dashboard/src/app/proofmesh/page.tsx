import Link from "next/link";
import { NetworkTabs } from "@/app/components/NetworkTabs";
import { fetchChains, isNetworkSelected, networkName, normalizeNetwork, parsePage } from "@/lib/chains";
import { db } from "@/lib/db";
import { REAL_PROOFS, addressLink, isAddress, isTxHash, shortAddress, shortHash, txLink } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProofMeshPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const selectedNetwork = normalizeNetwork(params.network);
  const page = parsePage(params.page);
  const pageSize = 25;
  let bonds: { claim_id: string; staker_addr: string; amount_atomic: string; status: string; stake_tx: string | null; resolve_tx: string | null }[] = [];
  let onchain: { tx_hash: string; network_id: number; kind: string; from_addr: string; to_addr: string; value_atomic: string | null; block_number: string | null }[] = [];
  let latestProofs: { tx_hash: string; network_id: number; kind: string; block_number: string | null; created_at: Date }[] = [];
  let networkCounts: { network_id: number; rows: string }[] = [];
  try {
    const r1 = await db.query(`
      SELECT claim_id, staker_addr, amount_atomic, status, stake_tx, resolve_tx
      FROM bonds ORDER BY created_at DESC LIMIT 25
    `);
    bonds = r1.rows;
    const r2 = await db.query(`
      SELECT tx_hash, network_id, kind, from_addr, to_addr, value_atomic, block_number::text
      FROM onchain_tx ORDER BY created_at DESC LIMIT 500
    `);
    onchain = r2.rows;
    latestProofs = (await db.query(`
      SELECT DISTINCT ON (network_id) tx_hash, network_id, kind, block_number::text, created_at
      FROM onchain_tx
      ORDER BY network_id, created_at DESC
    `)).rows;
    networkCounts = (await db.query(`
      SELECT network_id, COUNT(*)::text AS rows
      FROM onchain_tx GROUP BY network_id ORDER BY COUNT(*) DESC
    `)).rows;
  } catch { /* db not ready */ }
  const chains = (await fetchChains())?.items ?? [];
  const filteredOnchain = onchain.filter((o) => isNetworkSelected(o.network_id, selectedNetwork, chains));
  const pagedOnchain = filteredOnchain.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredOnchain.length / pageSize));
  const counts: Record<string, string> = {
    all: String(networkCounts.reduce((a, c) => a + Number(c.rows), 0)),
    mainnet: String(networkCounts.filter((c) => isNetworkSelected(c.network_id, "mainnet", chains)).reduce((a, c) => a + Number(c.rows), 0)),
    testnet: String(networkCounts.filter((c) => isNetworkSelected(c.network_id, "testnet", chains)).reduce((a, c) => a + Number(c.rows), 0)),
  };
  for (const c of networkCounts) counts[String(c.network_id)] = c.rows;
  const activeChains = chains.filter((c) => c.active || c.contracts_deployed);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold">ProofMesh — bonds & onchain proofs</h1>
      <p className="text-ink/70 max-w-2xl">
        Sellers stake USDC bonds on Arc Testnet while live payment proof is separated by network. Validators may slash on disagreement
        and proof-lane rows are only explorer-linked when a real hash and confirmed block exist.
      </p>
      {chains.length > 0 ? (
        <NetworkTabs basePath="/proofmesh" selected={selectedNetwork} chains={chains} counts={counts} title="ProofMesh network tabs" note="Inspect all proof-lane rows, only mainnet rows, only testnet rows, or any connected chain published by /api/chains." />
      ) : null}
      <div className="card">
        <h2 className="text-lg font-semibold mb-2">Latest proof transaction by active network</h2>
        <p className="text-xs text-ink/60 mb-4">
          This keeps the newest proof-lane transaction visible for every active or contract-deployed network after demo/test runs, instead of hiding older networks behind the global sort order.
        </p>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {activeChains.map((chain) => {
            const proof = latestProofs.find((p) => p.network_id === chain.chain_id);
            const linked = proof && isTxHash(proof.tx_hash) && proof.block_number;
            return (
              <div key={chain.chain_id} className="rounded-xl border border-ink/10 bg-cream/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wider text-ink/50 font-semibold">{chain.name}</div>
                  <span className="rounded-full border border-ink/10 px-2 py-0.5 text-[10px] text-ink/55">chain {chain.chain_id}</span>
                </div>
                {proof ? (
                  <div className="mt-3 text-sm">
                    <div>{proof.kind}</div>
                    <div className="font-mono text-xs mt-1">
                      {linked ? <a href={txLink(chain.chain_id, proof.tx_hash)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{shortHash(proof.tx_hash)}</a> : <span title="Ledger-only proof hash; no confirmed explorer block recorded">{shortHash(proof.tx_hash)}</span>}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink/50 mt-3">No proof transaction recorded yet for this network.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <h2 className="text-lg font-semibold mb-3">Verified Arc Testnet artifacts</h2>
        <p className="text-sm text-ink/65 mb-3">
          These are direct links to deployed Arc Testnet contracts and the real faucet transaction used to fund the deployer. Generic explorer homepages are intentionally not used here.
        </p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          {[
            { label: "BondVault", value: REAL_PROOFS.arcTestnet.contracts.bondVault, href: addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.bondVault) },
            { label: "ReputationRegistry", value: REAL_PROOFS.arcTestnet.contracts.reputation, href: addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.reputation) },
            { label: "MetadataLogger", value: REAL_PROOFS.arcTestnet.contracts.metadata, href: addressLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.contracts.metadata) },
            { label: "Faucet tx", value: REAL_PROOFS.arcTestnet.faucetTx, href: txLink(REAL_PROOFS.arcTestnet.chainId, REAL_PROOFS.arcTestnet.faucetTx) },
          ].map(({ label, value, href }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3 hover:border-indigo/40">
              <div className="text-xs uppercase tracking-wider text-ink/50">{label}</div>
              <div className="font-mono text-xs text-indigo mt-1 break-all">{value.startsWith("0x") && value.length === 42 ? shortAddress(value) : shortHash(value)}</div>
            </a>
          ))}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <h2 className="text-lg font-semibold mb-3">Bonds</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
            <tr><th className="py-2">Claim</th><th>Network</th><th>Staker</th><th>Amount</th><th>Status</th><th>Stake / resolve tx</th></tr>
          </thead>
          <tbody>
            {bonds.length === 0 ? (
              <tr><td colSpan={6} className="py-4 text-ink/50">No bonds yet.</td></tr>
            ) : bonds.map((b) => (
              <tr key={b.claim_id} className="border-t border-ink/5">
                <td className="py-2 font-mono text-xs">{b.claim_id.slice(0, 24)}…</td>
                <td><div>{networkName(REAL_PROOFS.arcTestnet.chainId, chains)}</div><div className="font-mono text-[10px] text-ink/40">{REAL_PROOFS.arcTestnet.chainId}</div></td>
                <td className="font-mono text-xs">{b.staker_addr.slice(0, 10)}…</td>
                <td className="font-mono text-xs">{(Number(b.amount_atomic) / 1e6).toFixed(6)}</td>
                <td className={b.status === "slashed" ? "text-coral" : b.status === "refunded" ? "text-emerald" : ""}>{b.status}</td>
                <td className="font-mono text-xs">
                  <div>{b.stake_tx ? shortHash(b.stake_tx) : "—"}</div>
                  <div className="text-ink/45">{b.resolve_tx ? shortHash(b.resolve_tx) : "pending"}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <h2 className="text-lg font-semibold mb-3">Proof-lane ledger rows</h2>
        <p className="text-xs text-ink/60 mb-3">Rows are explorer-linked only when the row has a real tx hash and confirmed block. Ledger-only generated proof hashes stay visible but are not passed off as explorer transactions.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-ink/60 text-xs uppercase tracking-wider">
            <tr><th className="py-2">Tx hash</th><th>Kind</th><th>From</th><th>To</th><th>Value (USDC)</th></tr>
          </thead>
          <tbody>
            {pagedOnchain.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-ink/50">No proof-lane rows for this network view yet.</td></tr>
            ) : pagedOnchain.map((o) => (
              <tr key={o.tx_hash} className="border-t border-ink/5">
                <td className="py-2 font-mono text-xs">
                  {isTxHash(o.tx_hash) && o.block_number ? (
                    <a href={txLink(o.network_id, o.tx_hash)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{shortHash(o.tx_hash)}</a>
                  ) : <span title="Ledger-only proof hash; no confirmed explorer block recorded">{shortHash(o.tx_hash)}</span>}
                </td>
                <td><div>{o.kind}</div><div className="text-[10px] text-ink/40">{networkName(o.network_id, chains)}</div></td>
                <td className="font-mono text-xs">{isAddress(o.from_addr) ? <a href={addressLink(o.network_id, o.from_addr)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{shortAddress(o.from_addr)}</a> : o.from_addr}</td>
                <td className="font-mono text-xs">{isAddress(o.to_addr) ? <a href={addressLink(o.network_id, o.to_addr)} target="_blank" rel="noreferrer" className="text-indigo hover:underline">{shortAddress(o.to_addr)}</a> : o.to_addr}</td>
                <td className="font-mono text-xs">{o.value_atomic ? (Number(o.value_atomic) / 1e6).toFixed(6) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/proofmesh?network=${encodeURIComponent(selectedNetwork)}&page=${Math.max(1, page - 1)}`}>Previous</Link>
            <Link className="rounded border border-ink/15 px-3 py-1 hover:bg-ink/5" href={`/proofmesh?network=${encodeURIComponent(selectedNetwork)}&page=${Math.min(totalPages, page + 1)}`}>Next</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
