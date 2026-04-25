"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { mintKeyAction, type MintResult } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Minting…" : "Mint a new key"}
    </button>
  );
}

export function MintKeyForm() {
  const [state, formAction] = useActionState<MintResult, FormData>(mintKeyAction, undefined);
  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-[200px]">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink/60">Label</span>
          <input
            name="label"
            type="text"
            maxLength={80}
            defaultValue="production"
            className="input mt-1"
            placeholder="production / staging / agent-foo"
          />
        </label>
        <Submit />
      </form>
      {state?.error ? (
        <div className="mt-3 text-sm text-coral bg-coral/10 border border-coral/30 rounded-lg px-3 py-2">
          {state.error}
        </div>
      ) : null}
      {state?.full_key ? (
        <div className="mt-4 border-2 border-emerald rounded-xl p-4 bg-emerald/5">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald">
            New key — copy now, you will not see it again
          </div>
          <pre className="mt-2 text-xs font-mono break-all bg-paper rounded-lg p-3 border border-ink/10">
            {state.full_key}
          </pre>
          <div className="text-xs text-ink/60 mt-2">
            Use it in the Authorization header with the Bearer scheme: <code className="font-mono">Bearer {state.full_key}</code>
          </div>
        </div>
      ) : null}
    </div>
  );
}
