import Link from "next/link";

// Light homepage footer (the global FooterBig is dark and stays on other pages).

const COLUMNS: ReadonlyArray<{ heading: string; links: ReadonlyArray<{ href: string; label: string }> }> = [
  {
    heading: "Product",
    links: [
      { href: "/download", label: "Download" },
      { href: "/phone", label: "Phone" },
      { href: "/pricing", label: "Pricing" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/help", label: "Help" },
      { href: "/security", label: "Security" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

export function HomeFooter(): React.ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-bg px-6 pb-12 pt-16 text-text">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-[2fr_repeat(3,minmax(0,1fr))]">
          <div>
            <Link href="/" className="font-display text-text" style={{ fontSize: "1.6rem", fontWeight: 500, letterSpacing: "-0.05em" }}>
              eri
            </Link>
            <p className="mt-5 max-w-xs text-[14px] leading-relaxed text-text-sec">
              An AGI lab building Engineered Relative Intelligence, a mind that
              learns you and grows into your other half.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="font-geist-mono text-[11px] uppercase tracking-[0.16em] text-text-ter">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="text-[14px] text-text-sec transition-colors hover:text-text">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-border pt-7 sm:flex-row sm:items-center">
          <p className="font-geist text-[13px] text-text-ter">© {year} Eri Labs. An independent project.</p>
        </div>
      </div>
    </footer>
  );
}
