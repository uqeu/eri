"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useUser } from "@/lib/auth-client";

interface SiteHeaderProps {
  variant?: "transparent" | "solid";
}

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/pricing", label: "Pricing" },
  { href: "/features", label: "Features" },
  { href: "/security", label: "Security" },
  { href: "/changelog", label: "Changelog" },
];

// Routes that already render their own logo + nav via DashboardShell — the
// global SiteHeader would be a duplicate, so we suppress it on these paths.
const DASHBOARD_PREFIXES = [
  "/dashboard",
  "/billing",
  "/usage",
  "/devices",
  "/account",
];

export function SiteHeader({ variant = "transparent" }: SiteHeaderProps) {
  const pathname = usePathname();
  if (pathname && DASHBOARD_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const wrapperClass =
    variant === "solid"
      ? "sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-md"
      : "sticky top-0 z-40 bg-bg/70 backdrop-blur-md border-b border-border";

  const { user, loading } = useUser();

  return (
    <div className={wrapperClass}>
      <header className="relative mx-auto max-w-7xl px-6 h-14 flex items-center justify-between text-text">
        <Link href="/" className="flex items-center" aria-label="eri home">
          <span
            className="font-display text-text"
            style={{ fontSize: "1.5rem", fontWeight: 500, letterSpacing: "-0.05em" }}
          >
            eri
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-1.5 text-[14px] text-text-sec hover:text-text transition-colors rounded-sm"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {loading ? (
            <div className="h-7 w-24 rounded-sm bg-bg-card-2 animate-pulse" />
          ) : user ? (
            <>
              <Link
                href="/dashboard"
                className="hidden sm:inline-flex px-3 py-1.5 text-[13px] text-text-sec hover:text-text transition-colors"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  void signOut();
                }}
                className="hidden sm:inline-flex px-3 py-1.5 text-[13px] text-text-sec hover:text-text transition-colors"
              >
                Sign out
              </button>
              <Link
                href="/account"
                className="inline-flex items-center gap-1.5 rounded-md bg-text px-3.5 py-1.5 text-[13px] font-medium text-bg hover:opacity-90 transition-colors"
                aria-label={`Account: ${user.email}`}
              >
                {(user.display_name ?? user.email).split("@")[0]}
                <span aria-hidden className="text-[10px]">
                  →
                </span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="hidden sm:inline-flex px-3 py-1.5 text-[13px] text-text-sec hover:text-text transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-1.5 rounded-md bg-text px-3.5 py-1.5 text-[13px] font-medium text-bg hover:opacity-90 transition-colors"
              >
                Try eri free
                <span aria-hidden className="text-[10px]">
                  →
                </span>
              </Link>
            </>
          )}
        </div>
      </header>
    </div>
  );
}
