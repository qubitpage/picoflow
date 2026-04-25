import DemoRunner from "./runner-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DemoPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Demo runner</h1>
      <p className="text-ink/70 max-w-2xl">
        Click <kbd className="rounded bg-ink/10 px-1.5 py-0.5 text-xs">Run demo</kbd> to spawn a
        buyer agent on the selected connected network. The runner exercises every paid endpoint via
        x402 negotiation, generates 56 paid actions, ProofMesh stakes, and full splits, then prints
        the wallet/action/authorization workflow in a terminal-style transcript.
      </p>
      <DemoRunner />
      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">CLI alternative</summary>
        <pre className="bg-ink/5 rounded-lg p-4 text-xs overflow-x-auto mt-3"><code>{`# Run directly on the server against a chosen network
      docker compose run --rm -e DEMO_CHAIN_ID=42161 -e DEMO_NETWORK_NAME="Arbitrum One" sellers node /repo/apps/buyer-agent/dist/runner.js

      # Arc Testnet rehearsal
      docker compose run --rm -e DEMO_CHAIN_ID=5042002 -e DEMO_NETWORK_NAME="Arc Testnet" sellers node /repo/apps/buyer-agent/dist/runner.js`}</code></pre>
      </details>
    </div>
  );
}
