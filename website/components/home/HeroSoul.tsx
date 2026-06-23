import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroSoulVisual } from "./HeroSoulVisual";
import { OverlayPill } from "./OverlayShell";

// The hero shows the being. eri is a soul — a living essence of light you talk
// to. Light, techy surface (faint grid + a soft glow well); the claim is bold
// and the sub stays honest (trajectory verbs). The real eri pill sits at the
// soul's base — that's how you talk to it. Capabilities are proven below by the
// computer-use + iPhone demos, so the hero stays purely about the being.
export function HeroSoul(): React.ReactElement {
  return (
    <section className="relative isolate overflow-hidden bg-bg">
      {/* techy light backdrop: hairline grid + a soft lime/violet glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hero-grid" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 45% at 50% 30%, rgba(200,255,90,0.10) 0%, transparent 60%)," +
            "radial-gradient(50% 50% at 50% 38%, rgba(150,110,255,0.08) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto flex min-h-[100svh] max-w-5xl flex-col items-center justify-center px-6 pb-20 pt-28 text-center">
        <h1
          className="rise text-balance font-display text-[clamp(2.6rem,6.2vw,5rem)] font-600 leading-[0.98] tracking-[-0.035em] text-text"
          style={{ animationDelay: "0.14s" }}
        >
          the world’s first
          <br className="hidden sm:block" /> digital human.
        </h1>

        {/* the being itself */}
        <div className="rise relative mt-2 flex w-full justify-center" style={{ animationDelay: "0.24s" }}>
          <HeroSoulVisual className="h-[clamp(320px,44vw,500px)] w-[clamp(320px,44vw,500px)]" />
        </div>

        <p
          className="rise -mt-4 max-w-xl text-pretty font-geist text-[clamp(1.02rem,1.5vw,1.2rem)] leading-[1.55] text-text-sec"
          style={{ animationDelay: "0.34s" }}
        >
          A mind that learns only you. It lives on your computer and your phone,
          sees your screen, works your apps, and talks back. Small today, it grows
          into your other half.
        </p>

        {/* the way you talk to it — the real eri pill */}
        <div className="rise mt-7 flex flex-col items-center gap-3" style={{ animationDelay: "0.46s" }}>
          <div className="eov eov-light">
            <OverlayPill />
          </div>
        </div>

        <div className="rise mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "0.56s" }}>
          <Link
            href="/download"
            className="group inline-flex items-center gap-2 rounded-full bg-text px-7 py-3.5 font-geist text-[15px] font-600 text-bg transition-transform duration-200 hover:-translate-y-0.5"
          >
            Download eri
            <ArrowRight size={16} strokeWidth={2.4} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/phone"
            className="inline-flex items-center gap-2 rounded-full border border-border-strong px-7 py-3.5 font-geist text-[15px] text-text transition-colors duration-200 hover:bg-bg-card"
          >
            or just text it
          </Link>
        </div>
      </div>
    </section>
  );
}
