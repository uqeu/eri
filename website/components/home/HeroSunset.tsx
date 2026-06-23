import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AskExpand } from "./AskExpand";

// The cinematic hero: a real sunset (public/hero.png) full-bleed, the headline
// over it, and the actual eri overlay floating in the sky — eri appearing next
// to you, asking what you want to do. A scrim keeps white text legible (AA),
// and the bottom fades to white so the page resolves into the calm light body.
export function HeroSunset(): React.ReactElement {
  return (
    <section className="relative isolate overflow-hidden">
      <Image
        src="/hero.png"
        alt="A wide sunset over mountains, gold light low on the horizon under swept pink and violet clouds."
        fill
        priority
        sizes="100vw"
        className="-z-10 object-cover"
        style={{ filter: "saturate(0.92) brightness(1.0) blur(1.5px)", transform: "scale(1.05)" }}
      />
      {/* legibility scrim + blend-to-white at the bottom */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(20,12,30,0.42) 0%, rgba(20,12,30,0.12) 22%, rgba(20,12,30,0.18) 55%, rgba(255,255,255,0.0) 78%, #ffffff 100%)",
        }}
      />

      <div className="mx-auto flex min-h-[100svh] max-w-6xl flex-col items-center justify-center px-6 pb-24 pt-28 text-center">
        <h1 className="rise font-display text-balance text-[clamp(2.8rem,6.6vw,5.25rem)] font-600 leading-[0.98] tracking-[-0.035em] text-white drop-shadow-[0_2px_20px_rgba(20,10,30,0.35)]" style={{ animationDelay: "0.16s" }}>
          the intelligence
          <br className="hidden sm:block" /> that becomes yours
        </h1>

        <p className="rise mx-auto mt-6 max-w-xl text-pretty text-[clamp(1.05rem,1.7vw,1.3rem)] leading-[1.5] text-white/90 drop-shadow-[0_1px_12px_rgba(20,10,30,0.4)]" style={{ animationDelay: "0.32s" }}>
          Not one mind for everyone. eri is intelligence engineered for you, it
          learns you, runs your world hands-free, and grows into your other half.
        </p>

        <div className="rise mt-9 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "0.46s" }}>
          <Link
            href="/download"
            className="group inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-[15px] font-600 text-[#14180a] shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-transform duration-200 hover:-translate-y-0.5"
          >
            Download eri
            <ArrowRight size={16} strokeWidth={2.4} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/phone"
            className="inline-flex items-center gap-2 rounded-full border border-white/40 px-7 py-3.5 text-[15px] text-white backdrop-blur-sm transition-colors duration-200 hover:bg-white/10"
          >
            or just text it
          </Link>
        </div>

        {/* the real eri overlay, appearing in the sky */}
        <div className="rise mt-14 flex w-full justify-center" style={{ animationDelay: "0.6s" }}>
          <AskExpand variant="light" />
        </div>
      </div>
    </section>
  );
}
