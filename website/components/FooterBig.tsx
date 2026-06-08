"use client";

import Link from "next/link";

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
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/help", label: "Help" },
      { href: "/status", label: "Status" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
      { href: "/security", label: "Security" },
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
        <div className="grid gap-14 lg:grid-cols-[2fr_repeat(3,_minmax(0,_1fr))]">
          <div>
            <Link href="/" className="inline-flex items-center">
              <span
                className="font-display text-text"
                style={{ fontSize: "1.75rem", fontWeight: 500, letterSpacing: "-0.05em" }}
              >
                eri
              </span>
            </Link>
            <p className="mt-6 max-w-sm text-[14px] leading-relaxed text-text-sec">
              The local-first agentic workbench for teams that ship from their
              repos, terminals, APIs, MCP servers, and cloud agents.
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
      </div>

    </footer>
  );
}
