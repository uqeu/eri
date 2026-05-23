"use client";

import Link from "next/link";
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

export function SiteHeader({ variant = "transparent" }: SiteHeaderProps) {
  const wrapperClass =
    variant === "solid"
      ? "sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-md"
      : "sticky top-0 z-40 bg-bg/70 backdrop-blur-md border-b border-border";

  const { user, loading } = useUser();

  return (
    <div className={wrapperClass}>
      <header className="relative mx-auto max-w-7xl px-6 h-14 flex items-center justify-between text-text">
        <Link
          href="/"
          className="flex items-center gap-2 group"
          aria-label="eri home"
        >
          <span
            className="font-display text-xl tracking-tight text-text"
            style={{ fontWeight: 500 }}
          >
            eri
          </span>
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-sage-deep transition-transform group-hover:scale-125"
            aria-hidden
          />
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
                className="inline-flex items-center gap-1.5 rounded-md bg-sage-deep px-3.5 py-1.5 text-[13px] font-medium text-bg hover:bg-sage transition-colors"
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
                className="inline-flex items-center gap-1.5 rounded-md bg-sage-deep px-3.5 py-1.5 text-[13px] font-medium text-bg hover:bg-sage transition-colors"
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
