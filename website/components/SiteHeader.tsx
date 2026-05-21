import Link from "next/link";

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
      ? "sticky top-0 z-40 border-b border-white/5 bg-ink/80 backdrop-blur-md"
      : "sticky top-0 z-40 bg-ink/60 backdrop-blur-md border-b border-white/[0.04]";

  return (
    <div className={wrapperClass}>
      <header className="relative mx-auto max-w-7xl px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 group"
          aria-label="eri home"
        >
          <span
            className="font-display text-xl tracking-tight text-paper"
            style={{ fontWeight: 500 }}
          >
            eri
          </span>
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-accent transition-transform group-hover:scale-125"
            aria-hidden
          />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-1.5 text-[13px] text-paper/70 hover:text-paper transition rounded-sm"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden sm:inline-flex px-3 py-1.5 text-[13px] text-paper/70 hover:text-paper transition"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px]"
          >
            Try eri free
            <span aria-hidden className="text-[10px]">
              →
            </span>
          </Link>
        </div>
      </header>
    </div>
  );
}
