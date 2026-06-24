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
  { href: "/connections", label: "Connections" },
  { href: "/devices", label: "Devices" },
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
      <div className="theme-light bg-bg text-text min-h-screen flex items-center justify-center font-geist text-text-ter">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="theme-light bg-bg text-text min-h-screen flex items-center justify-center font-geist text-text-ter">
        {error ?? "Redirecting to sign in…"}
      </div>
    );
  }

  return (
    <div className="theme-light bg-bg text-text min-h-screen flex flex-col md:flex-row font-geist">
      <header className="md:hidden flex items-center justify-between border-b border-border bg-bg-card px-6 py-4">
        <Link
          href="/dashboard"
          className="font-display text-xl text-text"
          style={{ letterSpacing: "-0.05em" }}
        >
          eri
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label="Toggle navigation"
          className="text-text p-2 -mr-2"
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
        } md:block md:w-64 md:min-h-screen md:shrink-0 border-b md:border-b-0 md:border-r border-border bg-bg-card`}
      >
        <div className="hidden md:flex items-center gap-3 px-6 py-6">
          <Link
            href="/dashboard"
            className="font-display text-2xl text-text transition-opacity hover:opacity-70"
            style={{ letterSpacing: "-0.05em" }}
          >
            eri
          </Link>
        </div>
        <div className="px-5 py-4 border-t border-b border-border md:border-t-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-text text-bg flex items-center justify-center font-geist text-[13px] font-600">
              {initials(user)}
            </div>
            <div className="min-w-0">
              <div className="text-[14px] text-text truncate">
                {user.display_name ?? user.email}
              </div>
              <div className="text-[11px] text-text-ter uppercase tracking-[0.18em]">
                {user.tier}
              </div>
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-3 py-4">
          {(user?.is_admin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV).map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-[14px] transition-colors ${
                  active
                    ? "bg-bg-card-2 text-text font-500"
                    : "text-text-sec hover:text-text hover:bg-bg-card-2"
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
            className="mt-1 rounded-lg px-3 py-2 text-left text-[14px] text-text-sec hover:text-text hover:bg-bg-card-2 transition-colors"
          >
            Sign out
          </button>
        </nav>
      </aside>

      <main className="flex-1 px-6 py-8 md:px-12 md:py-12">{children}</main>
    </div>
  );
}
