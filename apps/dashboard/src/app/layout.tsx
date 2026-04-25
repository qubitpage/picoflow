import "./globals.css";
import type { Metadata } from "next";
import { getLocale, t } from "@/lib/i18n";
import { NavShell } from "./components/NavShell";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "PicoFlow — Settlement Mesh for Agentic Commerce",
  description:
    "Dollar-cent and sub-cent payments on Arc with x402 + Circle Gateway + ProofMesh. lablab.ai hackathon submission.",
  other: {
    "base:app_id": "69eca5f48502c283edbf948e",
  },
};

type NetworkBadge = {
  network_name: string;
  chain_id: number;
  is_mainnet: boolean;
  usdc: string;
  gateway_wallet: string | null;
  explorer: string;
};

async function fetchNetworkBadge(): Promise<NetworkBadge | null> {
  const base =
    process.env.PICOFLOW_API_BASE ??
    process.env.NEXT_PUBLIC_API_BASE ??
    "https://picoflow.qubitpage.com";
  try {
    const r = await fetch(`${base}/api/network`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as NetworkBadge;
    return j;
  } catch {
    return null;
  }
}

function shortAddr(a: string | null | undefined): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const me = await getCurrentUser();
  const navUser = me ? { email: me.email, org_name: me.org_name, role: me.role } : null;
  const net = await fetchNetworkBadge();
  const badgeColor = net?.is_mainnet
    ? "bg-emerald/10 text-emerald border-emerald/30"
    : "bg-amber/10 text-amber border-amber/30";
  return (
    <html lang={locale}>
      <body>
        <NavShell locale={locale} user={navUser}>
          {net?.is_mainnet ? (
            <div className={`mb-4 rounded-md border ${badgeColor} px-3 py-1.5 text-xs font-mono flex items-center gap-3 flex-wrap`}>
              <span className="font-semibold uppercase tracking-wider">● Mainnet live</span>
              <span>{net.network_name}</span>
              <span className="opacity-60">chainId {net.chain_id}</span>
              <a href="/network" className="ml-auto hover:underline">Inspect →</a>
            </div>
          ) : null}
          {children}
          <footer className="mt-16 pt-6 border-t border-ink/10 text-xs text-ink/50 flex items-center gap-4 flex-wrap">
            <span>{t(locale, "footer.tag")}</span>
            {net ? (
              <>
                <a href="/network" className={`kbd ${net.is_mainnet ? "border-emerald/40" : ""}`}>
                  {net.network_name} {net.chain_id}
                </a>
                {net.gateway_wallet ? (
                  <span className="kbd">Gateway {shortAddr(net.gateway_wallet)}</span>
                ) : null}
                <span className="kbd">USDC {shortAddr(net.usdc)}</span>
              </>
            ) : (
              <span className="kbd opacity-50">network unreachable</span>
            )}
          </footer>
        </NavShell>
      </body>
    </html>
  );
}

