"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { signupAction, type AuthFormState } from "../(auth)/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? "Working…" : label}
    </button>
  );
}

export default function SignupPage() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signupAction, undefined);
  return (
    <div className="max-w-md mx-auto card">
      <h1 className="text-2xl font-semibold">Create your PicoFlow account</h1>
      <p className="text-sm text-ink/60 mt-1">Free 100,000 calls / month. No card required.</p>
      <form action={formAction} className="mt-6 space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink/60">Email</span>
          <input name="email" type="email" autoComplete="email" required className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink/60">Password</span>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required className="input mt-1" />
          <span className="text-[11px] text-ink/50">8 characters minimum.</span>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink/60">Organization name (optional)</span>
          <input name="org_name" type="text" maxLength={64} className="input mt-1" placeholder="Acme Robotics" />
        </label>
        {state?.error ? (
          <div className="text-sm text-coral bg-coral/10 border border-coral/30 rounded-lg px-3 py-2">{state.error}</div>
        ) : null}
        <Submit label="Create account" />
      </form>
      <p className="text-sm text-ink/60 mt-4 text-center">
        Already have one? <Link href="/login" className="text-indigo font-semibold">Sign in</Link>
      </p>
    </div>
  );
}
