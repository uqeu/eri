import Link from "next/link";

interface FooterLink {
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
  readonly badge?: string;
}

interface FooterColumn {
  readonly heading: string;
  readonly links: ReadonlyArray<FooterLink>;
}

const COLUMNS: ReadonlyArray<FooterColumn> = [
  {
    heading: "Product",
    links: [
      { href: "/download", label: "Download" },
      { href: "/pricing", label: "Pricing" },
      { href: "/changelog", label: "Changelog" },
      { href: "/features", label: "Features" },
      { href: "/releases", label: "Releases", badge: "0.4" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/forum", label: "Forum" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/blog", label: "Blog" },
      { href: "/careers", label: "Careers", badge: "hiring" },
      { href: "/press", label: "Press" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/security", label: "Security" },
      { href: "/trust", label: "Trust" },
    ],
  },
];

interface FooterColumnProps {
  readonly column: FooterColumn;
}

function FooterColumnView({ column }: FooterColumnProps): React.ReactElement {
  return (
    <div>
      <h3 className="mono-cap text-paper/40">{column.heading}</h3>
      <ul className="mt-5 space-y-3">
        {column.links.map((link) => {
          const content = (
            <span className="inline-flex items-center gap-2">
              <span>{link.label}</span>
              {link.badge ? (
                <span className="rounded-sm bg-accent/15 px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-wider text-accent">
                  {link.badge}
                </span>
              ) : null}
            </span>
          );
          return (
            <li key={link.href + link.label}>
              {link.external ? (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group inline-flex items-center gap-1.5 text-[14px] text-paper/65 transition hover:text-paper"
                >
                  {content}
                  <span
                    aria-hidden
                    className="text-paper/30 transition group-hover:text-paper/70"
                  >
                    ↗
                  </span>
                </a>
              ) : (
                <Link
                  href={link.href}
                  className="inline-flex items-center gap-1.5 text-[14px] text-paper/65 transition hover:text-paper"
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Footer(): React.ReactElement {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-white/[0.08] bg-bg-2">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      <div className="mx-auto max-w-7xl px-6 pt-24 pb-10">
        <div className="grid gap-14 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span className="font-display text-2xl text-paper">eri</span>
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_rgba(224,255,79,0.7)]"
              />
            </Link>
            <p className="mt-5 text-[14px] leading-relaxed text-paper/55">
              The local workbench for agentic software work. Speak or type the
              next step, review the patch, run the CLI, and hand off cloud work
              when your laptop should not be the runtime.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-paper/55">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-[#41d57c] shadow-[0_0_8px_rgba(65,213,124,0.7)]"
                />
                All systems operational
              </span>
            </div>
            <div className="mt-7 inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1 font-mono text-[11px]">
              <button
                type="button"
                aria-label="Light theme (coming soon)"
                disabled
                className="rounded-md px-2.5 py-1 text-paper/35 transition hover:text-paper/55 disabled:cursor-not-allowed"
              >
                light
              </button>
              <button
                type="button"
                aria-label="Dark theme (active)"
                className="rounded-md bg-white/[0.07] px-2.5 py-1 text-paper"
              >
                dark
              </button>
              <button
                type="button"
                aria-label="System theme (coming soon)"
                disabled
                className="rounded-md px-2.5 py-1 text-paper/35 transition hover:text-paper/55 disabled:cursor-not-allowed"
              >
                system
              </button>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <FooterColumnView key={col.heading} column={col} />
          ))}
        </div>

        <div className="mt-16 border-t border-white/[0.05] pt-6 font-mono text-[11px] text-paper/55">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(224,255,79,0.5)]"
            />
            Workspace secrets stay local by default — stored in OS Keychain,
            never synced to our servers.
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-6 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 font-mono text-[12px] text-paper/40">
            <span>© {year} eri</span>
            <span className="text-paper/30">
              independent project · ontario, canada · provided as-is
            </span>
          </div>
        </div>

        <div
          aria-hidden
          className="mt-12 select-none overflow-hidden text-center"
        >
          <span className="font-display text-[clamp(64px,16vw,220px)] leading-[0.85] tracking-tight text-paper/[0.04]">
            eri
          </span>
        </div>
      </div>
    </footer>
  );
}
