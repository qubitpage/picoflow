"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { loginAction, type AuthFormState } from "../(auth)/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? "Signing in…" : label}
    </button>
  );
}

function ReasonBanner() {
  const sp = useSearchParams();
  const reason = sp.get("reason");
  if (!reason) return null;
  const map: Record<string, string> = {
    admin_only: "That page is operator-only. Sign in as admin@picoflow.local to continue.",
    seller_only: "That page is for sellers and admins. Sign in below.",
  };
  const msg = map[reason] ?? "Please sign in to continue.";
  return (
    <div className="mb-4 text-sm text-amber bg-amber/10 border border-amber/30 rounded-lg px-3 py-2">
      {msg}
    </div>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(loginAction, undefined);
  return (
    <div className="max-w-md mx-auto card">
      <Suspense>
        <ReasonBanner />
      </Suspense>
      <h1 className="text-2xl font-semibold">Sign in to PicoFlow</h1>
      <form action={formAction} className="mt-6 space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink/60">Email</span>
          <input name="email" type="email" autoComplete="email" required className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink/60">Password</span>
          <input name="password" type="password" autoComplete="current-password" required className="input mt-1" />
        </label>
        {state?.error ? (
          <div className="text-sm text-coral bg-coral/10 border border-coral/30 rounded-lg px-3 py-2">{state.error}</div>
        ) : null}
        <Submit label="Sign in" />
      </form>
      <p className="text-sm text-ink/60 mt-4 text-center">
        Need an account? <Link href="/signup" className="text-indigo font-semibold">Create one free</Link>
      </p>

      <div className="mt-6 border-t border-ink/10 pt-4">
        <div className="text-[10px] uppercase tracking-wider text-ink/50 mb-2 font-semibold">Demo accounts (3 roles)</div>
        <p className="text-xs text-ink/60 mb-3">
          Click a card to autofill — each role unlocks a different slice of the platform.
        </p>
        <div className="space-y-2">
          {[
            { role: "admin",  email: "admin@picoflow.local",  password: "Admin#PicoFlow2026!",  label: "Operator", desc: "Full cockpit · settings · orgs · API keys · revenue", color: "border-red-400/40 bg-red-500/5" },
            { role: "seller", email: "seller@picoflow.local", password: "Seller#PicoFlow2026!", label: "Seller",   desc: "Own org · providers · console · pricing · margin", color: "border-indigo/40 bg-indigo/5" },
            { role: "public", email: "public@picoflow.local", password: "Public#PicoFlow2026!", label: "Viewer",   desc: "Read-only ledger · network · docs · demo runner",   color: "border-ink/30 bg-ink/5" },
          ].map((d) => (
            <button
              key={d.role}
              type="button"
              className={`w-full text-left rounded-lg border ${d.color} px-3 py-2 hover:opacity-80`}
              onClick={() => {
                const f = document.querySelector("form") as HTMLFormElement | null;
                if (!f) return;
                (f.elements.namedItem("email") as HTMLInputElement).value = d.email;
                (f.elements.namedItem("password") as HTMLInputElement).value = d.password;
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider">{d.label} · {d.role}</span>
                <span className="text-[10px] text-ink/50 font-mono">{d.email}</span>
              </div>
              <div className="text-[11px] text-ink/60 mt-0.5">{d.desc}</div>
              <div className="text-[10px] text-ink/40 font-mono mt-1">password: {d.password}</div>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-ink/40 mt-3">
          Seeded by <code className="font-mono">POST /api/admin/seed-roles</code>. Reset anytime by re-running the seed.
        </p>
      </div>
    </div>
  );
}
