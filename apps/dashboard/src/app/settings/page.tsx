import SettingsClient from "./settings-client";
import { WalletManagement } from "../components/WalletManagement";
import { requireRole } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const allowed = await requireRole("seller");
  if (!allowed) redirect("/login?next=/settings&reason=seller_only");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <p className="text-ink/70 max-w-2xl">
        Treasury addresses, sponsor API keys, and chain configuration. Secret values are masked
        when listed; click <kbd className="rounded bg-ink/10 px-1.5 py-0.5 text-xs">Reveal</kbd> to
        view or edit. Changes persist immediately to the database; the seller process applies new
        treasury splits on next restart.
      </p>
      <WalletManagement />
      <SettingsClient />
    </div>
  );
}
