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
              A local-first agent that controls your computer, writes your code,
              and learns how you work. An independent project, in private alpha.
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
      </div>

    </footer>
  );
}
