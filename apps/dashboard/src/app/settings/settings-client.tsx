"use client";
import { useEffect, useState } from "react";

const API = "/api";

type Setting = {
  key: string;
  value: string;        // masked if is_secret
  category: string;
  is_secret: boolean;
  description: string | null;
  updated_at: string;
};

const CATEGORIES = ["treasury", "providers", "chain", "general"] as const;

export default function SettingsClient() {
  const [items, setItems] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [newRow, setNewRow] = useState<Setting>({
    key: "", value: "", category: "general", is_secret: false, description: "", updated_at: "",
  });

  function adminHeaders(extra?: HeadersInit): HeadersInit {
    return {
      ...(extra ?? {}),
      ...(adminToken.trim()
        ? { "x-picoflow-admin": adminToken.trim(), authorization: `Bearer ${adminToken.trim()}` }
        : {}),
    };
  }

  function requireAdminToken(): boolean {
    if (adminToken.trim()) return true;
    alert("Admin token required. Paste ADMIN_TOKEN before revealing, saving, or deleting settings.");
    return false;
  }

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/settings`, { cache: "no-store" });
      const j = await r.json();
      setItems(j.items ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => {
    const saved = window.sessionStorage.getItem("picoflow_admin_token") ?? "";
    setAdminToken(saved);
    load();
  }, []);

  async function startEdit(s: Setting) {
    setEditing(s.key);
    if (s.is_secret) {
      if (!requireAdminToken()) { setEditing(null); return; }
      const r = await fetch(`${API}/settings/${encodeURIComponent(s.key)}/reveal`, { headers: adminHeaders() });
      if (!r.ok) { alert(`Reveal failed: ${await r.text()}`); setEditing(null); return; }
      const j = await r.json();
      setDraftValue(j.value ?? "");
    } else {
      setDraftValue(s.value);
    }
  }

  async function save(s: Setting) {
    if (!requireAdminToken()) return;
    const r = await fetch(`${API}/settings`, {
      method: "POST",
      headers: adminHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        key: s.key, value: draftValue,
        category: s.category, is_secret: s.is_secret,
        description: s.description,
      }),
    });
    if (!r.ok) { alert(`Save failed: ${await r.text()}`); return; }
    setEditing(null); setDraftValue("");
    await load();
  }

  async function del(key: string) {
    if (!requireAdminToken()) return;
    if (!confirm(`Delete setting "${key}"? This cannot be undone.`)) return;
    const r = await fetch(`${API}/settings/${encodeURIComponent(key)}`, { method: "DELETE", headers: adminHeaders() });
    if (!r.ok) { alert(`Delete failed: ${await r.text()}`); return; }
    await load();
  }

  async function createNew() {
    if (!requireAdminToken()) return;
    if (!newRow.key.trim()) { alert("Key required"); return; }
    const r = await fetch(`${API}/settings`, {
      method: "POST",
      headers: adminHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(newRow),
    });
    if (!r.ok) { alert(`Create failed: ${await r.text()}`); return; }
    setCreating(false);
    setNewRow({ key: "", value: "", category: "general", is_secret: false, description: "", updated_at: "" });
    await load();
  }

  const grouped: Array<{ category: string; items: Setting[] }> = CATEGORIES.map((c) => ({
    category: c as string,
    items: items.filter((i) => i.category === c),
  })).filter((g) => g.items.length > 0);
  // include any extra categories
  for (const i of items) {
    if (!CATEGORIES.includes(i.category as typeof CATEGORIES[number])
        && !grouped.find((g) => g.category === i.category)) {
      grouped.push({ category: i.category, items: items.filter((x) => x.category === i.category) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="card flex flex-col md:flex-row md:items-end gap-3">
        <label className="text-sm flex-1">
          <span className="block text-xs uppercase text-ink/50 mb-1">Backend admin token</span>
          <input
            className="w-full rounded border border-ink/20 px-2 py-1 font-mono text-sm"
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="ADMIN_TOKEN for seller API mutations"
          />
        </label>
        <button
          onClick={() => { window.sessionStorage.setItem("picoflow_admin_token", adminToken.trim()); alert("Admin token stored for this browser session."); }}
          className="px-3 py-1.5 rounded bg-indigo text-white text-sm font-semibold hover:bg-indigo/90"
        >
          Store for session
        </button>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button onClick={() => load()} className="px-3 py-1.5 rounded border border-ink/20 text-sm hover:bg-ink/5">Refresh</button>
        <button onClick={() => setCreating(true)} className="px-3 py-1.5 rounded bg-indigo text-white text-sm font-semibold hover:bg-indigo/90">+ New setting</button>
      </div>

      {creating ? (
        <div className="card space-y-3">
          <h3 className="font-semibold">New setting</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs uppercase text-ink/50 mb-1">Key</span>
              <input className="w-full rounded border border-ink/20 px-2 py-1 font-mono text-sm" value={newRow.key} onChange={(e) => setNewRow({ ...newRow, key: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase text-ink/50 mb-1">Category</span>
              <select className="w-full rounded border border-ink/20 px-2 py-1 text-sm" value={newRow.category} onChange={(e) => setNewRow({ ...newRow, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs uppercase text-ink/50 mb-1">Value</span>
              <input className="w-full rounded border border-ink/20 px-2 py-1 font-mono text-sm" value={newRow.value} onChange={(e) => setNewRow({ ...newRow, value: e.target.value })} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-xs uppercase text-ink/50 mb-1">Description</span>
              <input className="w-full rounded border border-ink/20 px-2 py-1 text-sm" value={newRow.description ?? ""} onChange={(e) => setNewRow({ ...newRow, description: e.target.value })} />
            </label>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={newRow.is_secret} onChange={(e) => setNewRow({ ...newRow, is_secret: e.target.checked })} />
              <span>Secret (mask in listings)</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={createNew} className="px-3 py-1.5 rounded bg-emerald text-white text-sm font-semibold">Save</button>
            <button onClick={() => setCreating(false)} className="px-3 py-1.5 rounded border border-ink/20 text-sm">Cancel</button>
          </div>
        </div>
      ) : null}

      {loading ? <div className="text-ink/50">Loading…</div> : null}

      {grouped.map((g) => (
        <div key={g.category} className="card">
          <h2 className="text-lg font-semibold mb-3 capitalize">{g.category}</h2>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-ink/50">
              <tr>
                <th className="text-left py-2 w-1/4">Key</th>
                <th className="text-left">Value</th>
                <th className="text-left w-1/3">Description</th>
                <th className="text-right w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((s) => (
                <tr key={s.key} className="border-t border-ink/5 align-top">
                  <td className="py-2 font-mono text-xs">{s.key} {s.is_secret ? <span className="text-coral">🔒</span> : null}</td>
                  <td className="font-mono text-xs break-all">
                    {editing === s.key ? (
                      <input
                        autoFocus
                        className="w-full rounded border border-ink/20 px-2 py-1 font-mono text-xs"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                      />
                    ) : (
                      <span>{s.value || <em className="text-ink/40">(empty)</em>}</span>
                    )}
                  </td>
                  <td className="text-xs text-ink/60">{s.description ?? ""}</td>
                  <td className="text-right">
                    {editing === s.key ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => save(s)} className="px-2 py-1 rounded bg-emerald text-white text-xs">Save</button>
                        <button onClick={() => { setEditing(null); setDraftValue(""); }} className="px-2 py-1 rounded border border-ink/20 text-xs">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => startEdit(s)} className="px-2 py-1 rounded border border-ink/20 text-xs hover:bg-ink/5">{s.is_secret ? "Reveal & edit" : "Edit"}</button>
                        <button onClick={() => del(s.key)} className="px-2 py-1 rounded border border-coral text-coral text-xs hover:bg-coral/10">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {!loading && items.length === 0 ? (
        <div className="card text-ink/50">No settings yet — click <strong>+ New setting</strong> to add one.</div>
      ) : null}
    </div>
  );
}
