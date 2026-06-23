import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

// A compact closing footer over a very desaturated black-and-white frame of the
// hero — the same sky, drained to memory. Small and quiet, not a spectacle.

const COLUMNS: ReadonlyArray<{ heading: string; links: ReadonlyArray<{ href: string; label: string }> }> = [
  { heading: "Product", links: [
    { href: "/download", label: "Download" },
    { href: "/phone", label: "Phone" },
    { href: "/pricing", label: "Pricing" },
  ] },
  { heading: "Resources", links: [
    { href: "/docs", label: "Docs" },
    { href: "/security", label: "Security" },
    { href: "/careers", label: "Join us" },
  ] },
  { heading: "Legal", links: [
    { href: "/terms", label: "Terms" },
    { href: "/privacy", label: "Privacy" },
  ] },
];

export function MeshFooter(): React.ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer className="relative isolate overflow-hidden bg-[#0b0a10] text-white">
      {/* desaturated B&W hero */}
      <Image
        src="/hero.png"
        alt=""
        aria-hidden
        fill
        sizes="100vw"
        className="-z-10 object-cover"
        style={{ filter: "grayscale(1) brightness(0.72) contrast(1.04)", opacity: 0.9 }}
      />
      <div aria-hidden className="absolute inset-0 -z-10" style={{ background: "linear-gradient(180deg, rgba(11,10,16,0.34) 0%, rgba(11,10,16,0.5) 55%, rgba(11,10,16,0.66) 100%)" }} />

      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="font-display text-white" style={{ fontSize: "1.7rem", fontWeight: 500, letterSpacing: "-0.05em" }}>
              eri
            </Link>
            <p className="mt-3 font-geist text-[14px] leading-relaxed text-white/70">
              <span className="block">The world’s first digital human.</span>
              <span className="block">Built for you, by you.</span>
            </p>
          </div>
          <Link
            href="/download"
            className="group inline-flex w-fit items-center gap-2 rounded-full bg-white px-6 py-3 font-geist text-[14.5px] font-600 text-[#14110b] transition-transform duration-200 hover:-translate-y-0.5"
          >
            Download eri
            <ArrowRight size={16} strokeWidth={2.4} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="mt-12 grid gap-8 border-t border-white/12 pt-10 sm:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="font-geist-mono text-[11px] uppercase tracking-[0.14em] text-white/45">{col.heading}</p>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="font-geist text-[14px] text-white/72 transition-colors hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-white/12 pt-6 sm:flex-row sm:items-center">
          <p className="font-geist text-[12.5px] text-white/50">© {year} Eri Labs. An independent project.</p>
        </div>
      </div>
    </footer>
  );
}
