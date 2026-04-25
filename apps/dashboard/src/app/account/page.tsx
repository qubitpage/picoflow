import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, sellerFetchAuthed } from "@/lib/session";
import { MintKeyForm } from "./MintKeyForm";
import { revokeKeyAction } from "./actions";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

type ApiKey = {
  key_id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const SERVICES = [
  {
    name: "Featherless open models",
    route: "/api/featherless/infer",
    price: "$0.005 / call",
    value: "Use specialized coding, medical, multilingual, or small open models without running GPUs.",
  },
  {
    name: "AI/ML API frontier router",
    route: "/api/aimlapi/infer",
    price: "$0.005 / call",
    value: "Send one prompt to an OpenAI-compatible model marketplace while PicoFlow keeps billing unified.",
  },
  {
    name: "AIsa / market data slot",
    route: "/api/aisa/data",
    price: "$0.001 / call",
    value: "Fetch a market signal before deciding whether a more expensive inference is worth buying.",
  },
  {
    name: "ProofMesh validator",
    route: "/api/validator/check",
    price: "$0.0015 / call",
    value: "Pay a second-opinion verifier and attach trust evidence to an agent response.",
  },
];

const FLOW = [
  ["Create key", "Mint one key per app or agent so you can revoke a single integration without breaking the rest."],
  ["Fund wallet", "Use USDC on Arc Testnet now; for real-money Base fallback, fund the deployer/user wallet on Base."],
  ["Call service", "Send the key in Authorization and choose a route with a clear per-call price before work starts."],
  ["Track outcome", "Every call becomes a ledger row with price, provider source, latency, quota org, and settlement state."],
];

async function loadKeys(): Promise<ApiKey[]> {
  try {
    const r = await sellerFetchAuthed("/api/me/keys");
    if (!r.ok) return [];
    const j = (await r.json()) as { items?: ApiKey[] };
    return j.items ?? [];
  } catch {
    return [];
  }
}

function formatTime(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const keys = await loadKeys();
  const activeKeys = keys.filter((k) => !k.revoked_at);

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink/50">
              Signed in as
            </div>
            <div className="text-xl font-semibold mt-1">{user.email}</div>
            <div className="text-sm text-ink/60 mt-1">
              Org: <span className="font-mono">{user.org_name}</span>
              <span className="text-ink/30 mx-2">·</span>
              Role: <span className="font-mono">{user.role}</span>
            </div>
            <div className="text-[11px] text-ink/40 mt-1 font-mono">org_id: {user.org_id}</div>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="btn">Sign out</button>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink/50">Customer cockpit</div>
            <h2 className="text-2xl font-semibold mt-1">Turn one agent workflow into metered USDC calls</h2>
            <p className="text-sm text-ink/65 mt-2 max-w-3xl">
              PicoFlow replaces monthly API contracts with explicit per-call economics. You choose the service,
              see the price before execution, authenticate with a revocable key, and inspect the ledger after the call.
            </p>
          </div>
          <Link href="/registry" className="btn btn-primary">Browse services</Link>
        </div>
        <div className="grid md:grid-cols-4 gap-3 mt-5">
          {FLOW.map(([title, body], index) => (
            <div key={title} className="border border-ink/10 rounded-lg p-3 bg-paper">
              <div className="text-xs uppercase tracking-wider text-indigo">Step {index + 1}</div>
              <h3 className="font-semibold mt-1">{title}</h3>
              <p className="text-xs text-ink/60 mt-2">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-[1fr_0.9fr] gap-4">
        <div className="card">
          <h2 className="text-xl font-semibold">Services you can buy</h2>
          <p className="text-sm text-ink/60 mt-1">
            Each route has a human-readable job, a fixed price, and a ledger trail. Start with small probes, then move the same key into your agent runtime.
          </p>
          <div className="grid md:grid-cols-2 gap-3 mt-4">
            {SERVICES.map((service) => (
              <div key={service.route} className="border border-ink/10 rounded-lg p-3 bg-paper">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{service.name}</h3>
                    <div className="font-mono text-xs text-ink/50 mt-1">{service.route}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-700">
                    {service.price}
                  </span>
                </div>
                <p className="text-xs text-ink/60 mt-3">{service.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold">Why this beats the classic API path</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-ink/50">
                <tr><th className="py-2 pr-3">Question</th><th>Classic</th><th>PicoFlow</th></tr>
              </thead>
              <tbody className="text-ink/70">
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Can I try one call?</td><td>Usually no</td><td>Yes, priced per call</td></tr>
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Can I audit cost?</td><td>Invoice later</td><td>Ledger immediately</td></tr>
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Can I revoke access?</td><td>Support ticket</td><td>Revoke key here</td></tr>
                <tr className="border-t border-ink/10"><td className="py-2 pr-3 font-semibold">Can agents pay agents?</td><td>Not natively</td><td>x402 + USDC flow</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 border border-ink/10 rounded-lg p-3 bg-paper">
            <h3 className="font-semibold">Real case scenario</h3>
            <p className="text-sm text-ink/65 mt-1">
              A trading agent asks for a $0.001 market signal, only buys a $0.005 model call if volatility is high,
              then pays $0.0015 for validation before submitting an action. The whole path costs less than one cent and leaves proof for finance.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">Your API keys</h2>
        <p className="text-ink/60 text-sm mt-1">
          Keys authenticate paid API calls. We never store the secret in
          plaintext — once you close the box below, we cannot show it again.
        </p>
        <div className="mt-4">
          <MintKeyForm />
        </div>

        {keys.length === 0 ? (
          <div className="mt-6 text-sm text-ink/50">No keys yet — mint one to get started.</div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-ink/50">
                <tr>
                  <th className="text-left pb-2 pr-3">Label</th>
                  <th className="text-left pb-2 pr-3">Prefix</th>
                  <th className="text-left pb-2 pr-3">Created</th>
                  <th className="text-left pb-2 pr-3">Last used</th>
                  <th className="text-left pb-2 pr-3">Status</th>
                  <th className="text-right pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.key_id} className="border-t border-ink/10">
                    <td className="py-2 pr-3 font-semibold">{k.label}</td>
                    <td className="py-2 pr-3 font-mono text-xs">pf_{k.key_prefix}_…</td>
                    <td className="py-2 pr-3 text-ink/70">{formatTime(k.created_at)}</td>
                    <td className="py-2 pr-3 text-ink/70">{formatTime(k.last_used_at)}</td>
                    <td className="py-2 pr-3">
                      {k.revoked_at ? (
                        <span className="text-coral text-xs font-semibold">revoked</span>
                      ) : (
                        <span className="text-emerald text-xs font-semibold">active</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {!k.revoked_at && (
                        <form action={revokeKeyAction}>
                          <input type="hidden" name="key_id" value={k.key_id} />
                          <button type="submit" className="btn btn-sm btn-danger">
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">Drop it into your code</h2>
        <p className="text-ink/60 text-sm mt-1">
          Replace <code className="font-mono">pf_xxx_yyy</code> with the secret you minted above.
        </p>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">curl</div>
            <pre className="bg-ink/5 rounded-lg p-3 overflow-x-auto text-xs font-mono leading-relaxed">
{`$auth = "Bearer $env:PICOFLOW_API_KEY"
curl https://picoflow.qubitpage.com/api/featherless/infer \
  -H "Authorization: $auth" \
  -H "content-type: application/json" \\
  -d '{"model":"mistralai/Mistral-Nemo-Instruct-2407",
       "prompt":"Hello"}'`}
            </pre>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink/50 mb-1">Node.js</div>
            <pre className="bg-ink/5 rounded-lg p-3 overflow-x-auto text-xs font-mono leading-relaxed">
{`const r = await fetch(
  "https://picoflow.qubitpage.com/api/featherless/infer",
  {
    method: "POST",
    headers: {
      "authorization": "Bearer " + process.env.PICOFLOW_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mistralai/Mistral-Nemo-Instruct-2407",
      prompt: "Hello",
    }),
  },
);
console.log(await r.json());
console.log("priced:", r.headers.get("x-pf-price-usdc"));`}
            </pre>
          </div>
        </div>
        <div className="mt-4 text-sm text-ink/60">
          Want to see what your calls look like in the ledger?{" "}
          <Link href="/dashboard" className="text-indigo font-semibold">
            Open the live ledger →
          </Link>
        </div>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">Quotas (free tier)</h2>
        <div className="grid md:grid-cols-3 gap-4 mt-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink/50">Calls / month</div>
            <div className="text-2xl font-semibold mt-1">100,000</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink/50">Active keys</div>
            <div className="text-2xl font-semibold mt-1">{activeKeys.length}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink/50">Settlement</div>
            <div className="text-sm mt-2 text-ink/70">Arc Testnet (USDC)</div>
          </div>
        </div>
        <p className="text-xs text-ink/50 mt-3">
          Need more? Email <span className="font-mono">team@picoflow.io</span> — we&apos;ll size you up.
        </p>
      </section>
    </div>
  );
}
