/**
 * Customer Environment Management (Phase 6b)
 *
 * Lists every org (customer/tenant) with its active API keys, monthly call cap,
 * and 30-day usage. Server actions create/disable orgs, mint or revoke API keys.
 * Newly minted keys are returned ONCE via a cookie-flash and surfaced on the next
 * render; after that the secret is unrecoverable (we only persist sha256(secret)).
 *
 * All admin calls are made server-side using ADMIN_TOKEN from env, so the token
 * never reaches the browser. Keys themselves only flow over the encrypted server
 * → server channel and a single same-process render.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SELLER_BASE = process.env.SELLER_BASE ?? "http://sellers:3030";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

type Org = {
  org_id: string;
  name: string;
  contact_email: string | null;
  monthly_call_limit: string | null;
  notes: string | null;
  disabled: boolean;
  created_at: string;
  active_keys: number;
  calls_30d: number;
};

type ApiKey = {
  key_id: string;
  org_id: string;
  org_name: string;
  label: string;
  key_prefix: string;
  scope?: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SELLER_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "x-admin-token": ADMIN_TOKEN,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function loadOrgs(opts: { page: number; pageSize: number; q: string }): Promise<{
  orgs: Org[];
  total: number;
  error: string | null;
}> {
  if (!ADMIN_TOKEN) return { orgs: [], total: 0, error: "ADMIN_TOKEN not set in dashboard env" };
  try {
    const offset = (opts.page - 1) * opts.pageSize;
    const qs = new URLSearchParams({ limit: String(opts.pageSize), offset: String(offset) });
    if (opts.q) qs.set("q", opts.q);
    const r = await adminFetch(`/api/admin/orgs?${qs.toString()}`);
    if (!r.ok) return { orgs: [], total: 0, error: `upstream ${r.status}` };
    const j = (await r.json()) as { items: Org[]; total?: number };
    return { orgs: j.items, total: Number(j.total ?? j.items.length), error: null };
  } catch (err) {
    return { orgs: [], total: 0, error: (err as Error).message };
  }
}

async function loadKeys(opts: { orgFilter?: string; page: number; pageSize: number }): Promise<{
  keys: ApiKey[];
  error: string | null;
}> {
  if (!ADMIN_TOKEN) return { keys: [], error: null };
  try {
    const offset = (opts.page - 1) * opts.pageSize;
    const qs = new URLSearchParams({ limit: String(opts.pageSize), offset: String(offset) });
    if (opts.orgFilter) qs.set("org_id", opts.orgFilter);
    const r = await adminFetch(`/api/admin/api-keys?${qs.toString()}`);
    if (!r.ok) return { keys: [], error: `upstream ${r.status}` };
    const j = (await r.json()) as { items: ApiKey[] };
    return { keys: j.items, error: null };
  } catch (err) {
    return { keys: [], error: (err as Error).message };
  }
}

async function createOrgAction(formData: FormData): Promise<void> {
  "use server";
  const body = {
    name: String(formData.get("name") ?? "").trim(),
    contact_email: String(formData.get("contact_email") ?? "").trim() || null,
    monthly_call_limit: formData.get("monthly_call_limit")
      ? Number(formData.get("monthly_call_limit"))
      : null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  await adminFetch("/api/admin/orgs", { method: "POST", body: JSON.stringify(body) });
  revalidatePath("/orgs");
}

async function disableOrgAction(formData: FormData): Promise<void> {
  "use server";
  const org_id = String(formData.get("org_id") ?? "");
  const disabled = formData.get("disabled") === "true";
  await adminFetch(`/api/admin/orgs/${org_id}/disable`, {
    method: "POST",
    body: JSON.stringify({ disabled }),
  });
  revalidatePath("/orgs");
}

async function createKeyAction(formData: FormData): Promise<void> {
  "use server";
  const body = {
    org_id: String(formData.get("org_id") ?? ""),
    label: String(formData.get("label") ?? "default").trim().slice(0, 80),
    scope: formData.get("scope") === "admin" ? "admin" : "tenant",
  };
  const r = await adminFetch("/api/admin/api-keys", { method: "POST", body: JSON.stringify(body) });
  if (r.ok) {
    const j = (await r.json()) as { full_key?: string };
    if (j.full_key) {
      // Single-use flash cookie. Read on next render, deleted immediately.
      (await cookies()).set("pf_minted_key", j.full_key, {
        httpOnly: true,
        sameSite: "strict",
        maxAge: 60,
        path: "/orgs",
      });
    }
  }
  revalidatePath("/orgs");
}

async function revokeKeyAction(formData: FormData): Promise<void> {
  "use server";
  const key_id = String(formData.get("key_id") ?? "");
  await adminFetch(`/api/admin/api-keys/${key_id}/revoke`, { method: "POST" });
  revalidatePath("/orgs");
}

async function updateKeyAction(formData: FormData): Promise<void> {
  "use server";
  const key_id = String(formData.get("key_id") ?? "");
  const body = {
    label: String(formData.get("label") ?? "default").trim().slice(0, 80) || "default",
    scope: formData.get("scope") === "admin" ? "admin" : "tenant",
  };
  await adminFetch(`/api/admin/api-keys/${key_id}`, { method: "POST", body: JSON.stringify(body) });
  revalidatePath("/orgs");
}

export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; org?: string }>;
}) {
  const allowed = await requireRole("admin");
  if (!allowed) redirect("/login?next=/orgs&reason=admin_only");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const pageSize = 25;
  const q = (sp.q ?? "").trim();
  const orgFilter = sp.org && /^[0-9a-f-]{36}$/i.test(sp.org) ? sp.org : undefined;
  const [{ orgs, total, error: orgsError }, { keys, error: keysError }] = await Promise.all([
    loadOrgs({ page, pageSize, q }),
    loadKeys({ orgFilter, page: 1, pageSize: 200 }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cookieStore = await cookies();
  const mintedKey = cookieStore.get("pf_minted_key")?.value ?? null;
  if (mintedKey) cookieStore.delete("pf_minted_key");

  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Customer environments</h1>
        <p className="text-ink/60 text-sm">
          Each org is a customer/tenant. Mint API keys here; rotate or revoke instantly.
          Bearer auth on paid endpoints requires <span className="kbd">REQUIRE_API_KEY=true</span> on
          the seller (currently {process.env.NEXT_PUBLIC_REQUIRE_API_KEY === "true" ? "ON" : "OFF"}).
        </p>
      </header>

      {orgsError && (
        <div className="card border-coral/40 bg-coral/5">
          <p className="text-coral text-sm">{orgsError}</p>
        </div>
      )}

      {mintedKey && (
        <div className="card border-emerald/40 bg-emerald/5">
          <h2 className="text-lg font-semibold text-emerald">New API key — copy it now</h2>
          <p className="text-xs text-ink/70 mb-2">
            This is the ONLY time the secret will be shown. After you leave this page it is
            unrecoverable (we only store sha256 of the secret).
          </p>
          <code className="block bg-ink/10 p-3 rounded font-mono text-sm break-all">
            {mintedKey}
          </code>
        </div>
      )}

      <section className="card">
        <h2 className="text-xl font-semibold mb-3">Create org</h2>
        <form action={createOrgAction} className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            name="name"
            placeholder="Acme AI"
            required
            className="input col-span-1"
            pattern="[A-Za-z0-9 _.\-]{2,80}"
          />
          <input
            name="contact_email"
            placeholder="ops@acme.ai"
            type="email"
            className="input col-span-1"
          />
          <input
            name="monthly_call_limit"
            placeholder="1000000 (calls/mo)"
            type="number"
            min={0}
            className="input col-span-1"
          />
          <input name="notes" placeholder="notes (optional)" className="input col-span-1" />
          <button type="submit" className="btn btn-primary md:col-span-4">
            Create org
          </button>
        </form>
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-xl font-semibold">Orgs ({total} total, page {page}/{totalPages})</h2>
          <form className="flex gap-2" action="/orgs">
            <input
              name="q"
              defaultValue={q}
              placeholder="search name or email"
              className="input input-sm"
            />
            <button type="submit" className="btn btn-sm">Search</button>
            {q ? <a href="/orgs" className="btn btn-sm">Clear</a> : null}
          </form>
        </div>
        {orgs.length === 0 ? (
          <p className="text-ink/50 text-sm">No orgs match — adjust the search above or create one.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink/60">
              <tr>
                <th className="py-2">Name</th>
                <th>Created</th>
                <th>Active keys</th>
                <th>Calls 30d</th>
                <th>Monthly cap</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.org_id} className="border-t border-ink/5">
                  <td className="py-2">
                    <div className="font-semibold">{o.name}</div>
                    <div className="text-xs text-ink/50 font-mono">{o.org_id.slice(0, 8)}…</div>
                    {o.contact_email && (
                      <div className="text-xs text-ink/60">{o.contact_email}</div>
                    )}
                  </td>
                  <td className="font-mono text-xs">{o.created_at.slice(0, 10)}</td>
                  <td>{o.active_keys}</td>
                  <td>{o.calls_30d}</td>
                  <td>{o.monthly_call_limit ?? "—"}</td>
                  <td>
                    <span className={o.disabled ? "text-coral" : "text-emerald"}>
                      {o.disabled ? "disabled" : "active"}
                    </span>
                  </td>
                  <td className="space-x-2">
                    <form action={createKeyAction} className="inline-flex gap-1 items-center">
                      <input type="hidden" name="org_id" value={o.org_id} />
                      <input
                        name="label"
                        placeholder="key label"
                        defaultValue="prod"
                        className="input input-sm w-24"
                      />
                      <select name="scope" defaultValue="tenant" className="input input-sm w-20" title="Key scope">
                        <option value="tenant">tenant</option>
                        <option value="admin">admin</option>
                      </select>
                      <button type="submit" className="btn btn-sm">
                        Mint key
                      </button>
                    </form>
                    <form action={disableOrgAction} className="inline">
                      <input type="hidden" name="org_id" value={o.org_id} />
                      <input type="hidden" name="disabled" value={o.disabled ? "false" : "true"} />
                      <button type="submit" className="btn btn-sm">
                        {o.disabled ? "Enable" : "Disable"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totalPages > 1 ? (
          <div className="flex items-center justify-between mt-3 text-sm">
            <div className="text-ink/60">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</div>
            <div className="flex gap-2">
              {page > 1 ? (
                <a className="btn btn-sm" href={`/orgs?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) }).toString()}`}>← Prev</a>
              ) : null}
              {page < totalPages ? (
                <a className="btn btn-sm" href={`/orgs?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) }).toString()}`}>Next →</a>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold mb-3">API keys ({keys.length}{orgFilter ? ` for org ${orgFilter.slice(0,8)}…` : ""})</h2>
        {keysError && <p className="text-coral text-xs mb-2">{keysError}</p>}
        {keys.length === 0 ? (
          <p className="text-ink/50 text-sm">No keys yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-ink/60">
              <tr>
                <th className="py-2">Org</th>
                <th>Label</th>
                <th>Scope</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.key_id} className="border-t border-ink/5">
                  <td className="py-2">{k.org_name}</td>
                  <td>
                    {!k.revoked_at ? (
                      <form id={`edit-key-${k.key_id}`} action={updateKeyAction} className="flex gap-1 items-center">
                        <input type="hidden" name="key_id" value={k.key_id} />
                        <input name="label" defaultValue={k.label} className="input input-sm w-28" />
                      </form>
                    ) : (
                      k.label
                    )}
                  </td>
                  <td>
                    {!k.revoked_at ? (
                      <select form={`edit-key-${k.key_id}`} name="scope" defaultValue={k.scope ?? "tenant"} className="input input-sm w-24">
                        <option value="tenant">tenant</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${k.scope === "admin" ? "bg-coral/15 text-coral" : "bg-indigo/15 text-indigo"}`}>
                        {k.scope ?? "tenant"}
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs">pf_{k.key_prefix}_…</td>
                  <td className="font-mono text-xs">{k.created_at.slice(0, 10)}</td>
                  <td className="font-mono text-xs">
                    {k.last_used_at ? k.last_used_at.slice(0, 19).replace("T", " ") : "—"}
                  </td>
                  <td>
                    {k.revoked_at ? (
                      <span className="text-coral">revoked</span>
                    ) : (
                      <span className="text-emerald">active</span>
                    )}
                  </td>
                  <td>
                    {!k.revoked_at && (
                      <div className="flex gap-1">
                        <button type="submit" form={`edit-key-${k.key_id}`} className="btn btn-sm">
                          Save
                        </button>
                        <form action={revokeKeyAction} className="inline">
                          <input type="hidden" name="key_id" value={k.key_id} />
                          <button type="submit" className="btn btn-sm btn-danger">
                            Revoke
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
