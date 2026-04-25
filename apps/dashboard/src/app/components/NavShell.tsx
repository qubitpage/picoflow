"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./SidebarNav";

/**
 * Role visibility model:
 *   admin  — everything
 *   seller — own org dashboards, providers, registry, console, account
 *   public — read-only ledger / network / docs / demo / margin
 *
 * `roles` omitted means "visible to everyone signed-in or not"; explicit list
 * gates the link. The SidebarNav also filters by role at render time.
 */
const NAV = [
  // Live operations
  { href: "/dashboard", label: "Live ledger", group: "Live", description: "Real-time table of every paid action, settlement, and on-chain proof." },
  { href: "/proofmesh", label: "ProofMesh", group: "Live", description: "Bond stake/slash/refund timeline plus validator window math." },
  { href: "/track", label: "Track", group: "Live", description: "Look up a single action_id end-to-end (challenge → sign → batch → tx_hash)." },
  { href: "/network", label: "Network", group: "Live", description: "Live chain config, contract addresses, wallet balances, mainnet/testnet badge." },
  // Engineering
  { href: "/registry", label: "Registry", group: "Engineering", description: "Capability registry of every paid endpoint exposed by the seller." },
  { href: "/providers", label: "Providers", group: "Engineering", description: "Upstream cost ledger — what each backend provider charges.", roles: ["admin", "seller"] },
  { href: "/admin", label: "Admin", group: "Engineering", description: "Protected operator cockpit for settings, revenue, wallets, and orgs.", roles: ["admin"] },
  { href: "/console", label: "Console", group: "Engineering", description: "Replay any HTTP 402 → sign → retry against the live seller.", roles: ["admin", "seller"] },
  // Economics
  { href: "/margin", label: "Margin", group: "Economics", description: "Per-call profit math at any chosen price + volume." },
  { href: "/splits", label: "Splits", group: "Economics", description: "Where every recovered cent went — recipient breakdown." },
  // Customers
  { href: "/orgs", label: "Customers", group: "Customers", description: "Tenant orgs, API keys, monthly call caps and usage.", roles: ["admin"] },
  // Demo & docs
  { href: "/demo", label: "Demo runner", group: "Demo", description: "One-click 60-call burst that exercises all 4 paid endpoints." },
  { href: "/docs", label: "Docs", group: "Demo", description: "One unified whitepaper plus one pitch deck, with tests and appendices inside." },
  { href: "/settings", label: "Settings", group: "Demo", description: "Per-resource pricing toggles and operator info.", roles: ["admin", "seller"] },
];

export type NavUser = { email: string; org_name: string; role: string } | null;

export function NavShell({ locale, user, children }: { locale: string; user: NavUser; children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const isLanding = pathname === "/" || pathname === "/login" || pathname === "/signup";
  if (isLanding) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="border-b border-ink/10 bg-paper/80 backdrop-blur sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold text-lg tracking-tight">
              Pico<span className="text-indigo">Flow</span>
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <Link href="/dashboard" className="btn btn-sm">Live ledger</Link>
              <Link href="/admin" className="btn btn-sm">Admin</Link>
              {user ? (
                <Link href="/account" className="btn btn-sm btn-primary">Account ({user.email})</Link>
              ) : (
                <>
                  <Link href="/login" className="btn btn-sm">Sign in</Link>
                  <Link href="/signup" className="btn btn-sm btn-primary">Get started free</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="flex-1 max-w-6xl mx-auto px-6 py-10 w-full">{children}</main>
      </div>
    );
  }
  return (
    <div className="md:flex">
      <SidebarNav items={NAV} locale={locale} pathname={pathname} user={user} />
      <main className="flex-1 max-w-7xl mx-auto px-6 py-10 w-full">{children}</main>
    </div>
  );
}

