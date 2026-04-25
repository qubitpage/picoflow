"use client";
import { useState } from "react";
import { dashboardLogout } from "./logout-action";

type NavItem = { href: string; label: string; group: string; description?: string; roles?: string[] };
type NavUser = { email: string; org_name: string; role: string } | null;

/**
 * Responsive sidebar nav. On md+ screens it's a sticky left rail grouping
 * routes by purpose; on mobile it collapses to a top hamburger drawer.
 *
 * The active route gets a subtle highlight; descriptions appear as tooltips
 * (title attr) so judges can hover any link to see what it does without
 * navigating first.
 */
export function SidebarNav({
  items,
  locale,
  pathname,
  user,
}: {
  items: NavItem[];
  locale: string;
  pathname: string;
  user: NavUser;
}) {
  const [open, setOpen] = useState(false);
  const role = user?.role ?? "public";
  const visible = items.filter((i) => !i.roles || i.roles.includes(role));
  const groups = Array.from(new Set(visible.map((i) => i.group)));

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-ink/10 bg-cream sticky top-0 z-20">
        <a href="/" className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-indigo flex items-center justify-center text-white font-bold text-sm">
            P
          </span>
          <span className="font-semibold">PicoFlow</span>
        </a>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="toggle navigation"
          className="px-3 py-1 rounded border border-ink/10 text-sm"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      <aside
        className={
          "md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-r md:border-ink/10 md:bg-cream md:overflow-y-auto " +
          (open ? "block" : "hidden md:block")
        }
      >
        <div className="hidden md:flex items-center gap-3 px-5 py-5 border-b border-ink/10">
          <span className="w-9 h-9 rounded-lg bg-indigo flex items-center justify-center text-white font-bold">
            P
          </span>
          <div>
            <div className="font-semibold tracking-tight">PicoFlow</div>
            <div className="text-[10px] text-ink/50 uppercase tracking-wider">
              Settlement Mesh · {locale}
            </div>
          </div>
        </div>
        <nav className="px-3 py-4 space-y-5">
          {groups.map((g) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-wider text-ink/40 px-2 mb-1">{g}</div>
              <ul className="space-y-0.5">
                {visible
                  .filter((i) => i.group === g)
                  .map((i) => {
                    const active =
                      i.href === "/" ? pathname === "/" : pathname.startsWith(i.href);
                    return (
                      <li key={i.href}>
                        <a
                          href={i.href}
                          title={i.description}
                          onClick={() => setOpen(false)}
                          className={
                            "block px-2 py-1.5 rounded text-sm hover:bg-ink/5 " +
                            (active ? "bg-indigo/10 text-indigo font-medium" : "text-ink/80")
                          }
                        >
                          {i.label}
                        </a>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-ink/10 mt-2">
          {user ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink/40">Signed in</div>
              <div className="text-xs font-semibold mt-1 truncate" title={user.email}>{user.email}</div>
              <div className="text-[11px] text-ink/50 truncate" title={user.org_name}>{user.org_name}</div>
              <div className="mt-1">
                <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider " + (
                  user.role === "admin" ? "bg-red-500/15 text-red-600" :
                  user.role === "seller" ? "bg-indigo/15 text-indigo" :
                  "bg-ink/10 text-ink/60"
                )}>{user.role}</span>
              </div>
              <a href="/account" className="block mt-2 text-xs text-indigo font-semibold">Manage account →</a>
              <form action={dashboardLogout} className="mt-1">
                <button type="submit" className="text-xs text-ink/50 hover:text-ink/80">Sign out</button>
              </form>
            </div>
          ) : (
            <div className="space-y-2">
              <a href="/signup" className="block text-center text-xs font-semibold py-1.5 rounded bg-indigo text-cream">
                Get started free
              </a>
              <a href="/login" className="block text-center text-xs font-semibold py-1.5 rounded border border-ink/15 text-ink/80">
                Sign in
              </a>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
