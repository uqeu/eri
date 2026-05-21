"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { signOut, useUser, type PublicUser } from "@/lib/auth-client";

interface NavItem {
  href: string;
  label: string;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/billing", label: "Billing" },
  { href: "/usage", label: "Usage" },
  { href: "/account", label: "Account" },
];

function initials(user: PublicUser): string {
  const source = user.display_name?.trim() || user.email;
  const parts = source.split(/\s+|@/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, error } = useUser();
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/sign-in");
    }
  }, [loading, user, router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        {error ?? "Redirecting to sign in…"}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <header className="md:hidden flex items-center justify-between border-b border-white/10 px-6 py-4">
        <Link
          href="/dashboard"
          className="font-display text-xl tracking-tight"
        >
          eri
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label="Toggle navigation"
          className="text-paper p-2 -mr-2"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {mobileOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </header>

      <aside
        className={`${
          mobileOpen ? "block" : "hidden"
        } md:block md:w-64 md:min-h-screen border-b md:border-b-0 md:border-r border-white/10 bg-ink`}
      >
        <div className="hidden md:flex items-center gap-3 px-6 py-6">
          <Link
            href="/dashboard"
            className="font-display text-2xl tracking-tight hover:text-accent transition"
          >
            eri
          </Link>
        </div>
        <div className="px-6 py-4 border-t border-b border-white/10 md:border-t-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-accent text-ink flex items-center justify-center font-medium">
              {initials(user)}
            </div>
            <div className="min-w-0">
              <div className="text-sm text-paper truncate">
                {user.display_name ?? user.email}
              </div>
              <div className="text-xs text-muted uppercase tracking-[0.2em]">
                {user.tier}
              </div>
            </div>
          </div>
        </div>
        <nav className="flex flex-col py-4">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-6 py-3 text-sm transition border-l-2 ${
                  active
                    ? "border-accent text-paper bg-white/5"
                    : "border-transparent text-muted hover:text-paper hover:bg-white/5"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="px-6 py-3 text-sm text-left text-muted hover:text-paper hover:bg-white/5 transition border-l-2 border-transparent"
          >
            Sign out
          </button>
        </nav>
      </aside>

      <main className="flex-1 px-6 py-8 md:px-12 md:py-12">{children}</main>
    </div>
  );
}
