"use client";

import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

interface FooterColumn {
  readonly heading: string;
  readonly links: ReadonlyArray<{
    readonly href: string;
    readonly label: string;
    readonly external?: boolean;
  }>;
}

const COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    heading: "Product",
    links: [
      { href: "/download", label: "Download" },
      { href: "/features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/changelog", label: "Changelog" },
      { href: "/releases", label: "Releases" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/help", label: "Help" },
      { href: "/status", label: "Status" },
      { href: "/forum", label: "Forum" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/blog", label: "Blog" },
      { href: "/careers", label: "Careers" },
      { href: "/press", label: "Press" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/legal/acceptable-use", label: "Acceptable use" },
      { href: "/legal/ai-policy", label: "AI policy" },
      { href: "/legal/sub-processors", label: "Sub-processors" },
      { href: "/legal/cookies", label: "Cookies" },
      { href: "/security", label: "Security" },
      { href: "/trust", label: "Trust" },
    ],
  },
];

interface SocialDef {
  readonly href: string;
  readonly label: string;
  readonly path: React.ReactNode;
}

const SOCIALS: ReadonlyArray<SocialDef> = [
  {
    href: "https://x.com/eri",
    label: "X",
    path: (
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    ),
  },
  {
    href: "https://youtube.com/@eri",
    label: "YouTube",
    path: (
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.546 15.568V8.432L15.818 12l-6.272 3.568z" />
    ),
  },
];

export function FooterBig(): React.ReactElement {
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden border-t border-border bg-bg-card text-text px-6 pt-20 pb-12">
      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-14 lg:grid-cols-[1.6fr_1fr_repeat(4,_minmax(0,_0.9fr))]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span className="font-display text-3xl text-text">eri</span>
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-sage-deep"
              />
            </Link>
            <p className="mt-6 max-w-sm text-[14px] leading-relaxed text-text-sec">
              The voice-first IDE for solo founders and small teams. Native
              macOS, diffusion edits, your keys, your repo, your shape of work.
            </p>
            <div className="mt-7 flex items-center gap-2">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={s.label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-ter transition-colors hover:border-border-strong hover:bg-bg-card-2 hover:text-text"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="currentColor"
                    aria-hidden
                  >
                    {s.path}
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div className="lg:col-span-1">
            <p className="text-text-sec text-[13px] pb-3 uppercase tracking-wider">Newsletter</p>
            <p className="mt-1 text-[13px] leading-relaxed text-text-sec">
              One short note when something ships. No drip campaigns.
            </p>
            <form
              className="mt-5 flex flex-col gap-2"
              onSubmit={(e) => e.preventDefault()}
            >
              <label htmlFor="footer-newsletter" className="sr-only">
                Email address
              </label>
              <input
                id="footer-newsletter"
                type="email"
                required
                placeholder="you@studio.dev"
                className="w-full rounded-md border border-border bg-bg-card-2 px-3 py-2.5 font-mono text-[12px] text-text placeholder:text-text-ter outline-none transition-colors focus:border-sage-deep"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-sage-deep px-3 py-2 font-mono text-[11px] uppercase tracking-wider font-medium text-bg transition-colors hover:bg-sage"
              >
                Subscribe <span aria-hidden>→</span>
              </button>
            </form>
            <p className="mt-3 font-mono text-[10px] text-text-ter">
              No spam. Unsubscribe in one click.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="text-text-sec text-[13px] pb-3 uppercase tracking-wider">{col.heading}</p>
              <ul className="mt-1 space-y-1">
                {col.links.map((link) =>
                  link.external ? (
                    <li key={link.href + link.label}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="group inline-flex items-center gap-1 text-[14px] text-text-sec hover:text-text py-1.5 transition-colors"
                      >
                        {link.label}
                        <span
                          aria-hidden
                          className="text-text-ter transition-colors group-hover:text-text-sec"
                        >
                          ↗
                        </span>
                      </a>
                    </li>
                  ) : (
                    <li key={link.href + link.label}>
                      <Link
                        href={link.href}
                        className="text-text-sec hover:text-text text-[14px] py-1.5 inline-block transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-2 border-t border-border pt-6 font-mono text-[11px] text-text-sec sm:flex-row sm:items-start sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-sage-deep"
            />
            BYOK keys never leave your machine — stored in OS Keychain, never
            synced to our servers.
          </span>
        </div>

        <div className="container flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mt-12 pt-6 border-t border-border text-text-sec text-[13px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px]">
            <span>© {year} eri</span>
            <span aria-hidden className="text-text-ter">
              ·
            </span>
            <span>independent project · ontario, canada</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[12px]">
            <Link
              href="/status"
              className="inline-flex items-center gap-2 hover:text-text transition-colors"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[#41d57c] shadow-[0_0_8px_rgba(65,213,124,0.7)]"
              />
              status
            </Link>
            <span aria-hidden className="text-text-ter">
              ·
            </span>
            <Link
              href="/legal/disclaimer"
              className="hover:text-text transition-colors"
            >
              provided as-is
            </Link>
            <span aria-hidden className="text-text-ter">
              ·
            </span>
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none relative -mt-2 select-none overflow-hidden text-center"
      >
        <span className="font-display text-[clamp(72px,18vw,260px)] leading-[0.85] tracking-tight text-text/[0.05]">
          eri.
        </span>
      </div>
    </footer>
  );
}
