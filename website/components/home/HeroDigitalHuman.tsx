"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EriComposer } from "./EriComposer";
import { BubbleField } from "./BubbleField";
import { useHasWebGL } from "./useHasWebGL";
import { CanvasBoundary } from "./CanvasBoundary";

// Hero → mind, one continuous sequence. It opens on the frosted sunset with the
// claim. As you scroll, the sunset closes inward and hands straight into the
// real eri pill at the centre, while "everything it's thinking" + the
// iridescent bubbles fade in behind it — so the sunset literally becomes eri,
// with no dead scroll. One rAF drives every fade/transform via refs.
// No-JS / reduced-motion: lands on the settled mind state (pill + headline).

export function HeroDigitalHuman(): React.ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const claimRef = useRef<HTMLDivElement>(null);
  const mindRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const [reduced, setReduced] = useState(false);
  const webgl = useHasWebGL();

  useEffect(() => {
    const red = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setReduced(red);

    const section = sectionRef.current;
    const frame = frameRef.current;
    const claim = claimRef.current, mind = mindRef.current, bubbles = bubblesRef.current;
    if (!section || !frame || !claim || !mind || !bubbles) return;

    const clamp = (n: number): number => Math.max(0, Math.min(1, n));
    const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

    if (red) {
      // settled mind state, no morph
      frame.style.opacity = "0"; claim.style.opacity = "0";
      mind.style.opacity = "1"; mind.style.transform = "none"; bubbles.style.opacity = "1";
      progressRef.current = 0.95;
      return;
    }

    let raf = 0, queued = false;
    const apply = (): void => {
      queued = false;
      const vw = window.innerWidth, vh = window.innerHeight;
      const rect = section.getBoundingClientRect();
      const total = rect.height - vh;
      const p = total <= 0 ? 0 : clamp(-rect.top / total);
      progressRef.current = p;

      // sunset closes toward a single point — but it's fully faded (opacity 0)
      // before the point is ever visible.
      const t = smooth(0, 0.6, p);
      const maxSide = Math.max(vw, vh);
      const endSide = Math.min(vw, vh) * 0.015; // → a point
      const side = maxSide + (endSide - maxSide) * t;
      const insetX = Math.max(0, (vw - side) / 2), insetY = Math.max(0, (vh - side) / 2);
      const round = (side / 2) * smooth(0.28, 0.9, p);
      frame.style.clipPath = `inset(${insetY.toFixed(1)}px ${insetX.toFixed(1)}px ${insetY.toFixed(1)}px ${insetX.toFixed(1)}px round ${round.toFixed(1)}px)`;
      frame.style.opacity = (1 - smooth(0.28, 0.46, p)).toFixed(3); // gone before the point

      claim.style.opacity = (1 - smooth(0.08, 0.34, p)).toFixed(3);
      claim.style.transform = `translateY(${(-p * 26).toFixed(1)}px)`;
      claim.style.pointerEvents = p > 0.34 ? "none" : "auto";

      const mindIn = smooth(0.44, 0.78, p);
      mind.style.opacity = mindIn.toFixed(3);
      mind.style.transform = `scale(${(0.94 + 0.06 * mindIn).toFixed(4)})`;
      mind.style.pointerEvents = mindIn > 0.5 ? "auto" : "none";

      bubbles.style.opacity = smooth(0.44, 0.86, p).toFixed(3);
    };
    const onScroll = (): void => { if (!queued) { queued = true; raf = requestAnimationFrame(apply); } };
    // set the p=0 state before paint so there's no mind→sunset flash
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  return (
    <section ref={sectionRef} className="hero-crop relative" aria-label="eri — the world's first digital human">
      <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden bg-bg">
        {/* iridescent bubbles (fade in as the sunset becomes eri) */}
        <div ref={bubblesRef} aria-hidden className="pointer-events-none absolute inset-0" style={{ opacity: 1 }}>
          {webgl ? (
            <CanvasBoundary fallback={<div className="tf-fallback absolute inset-0" />}>
              <BubbleField progressRef={progressRef} reduced={reduced} />
            </CanvasBoundary>
          ) : (
            <div className="tf-fallback absolute inset-0" />
          )}
        </div>

        {/* the sunset frame — closes to a point on scroll; the claim lives INSIDE
            it so the same clip-path crops the text along with the sunset. */}
        <div ref={frameRef} className="hero-frame absolute inset-0" style={{ opacity: 0 }}>
          <Image
            src="/hero.png"
            alt="A wide sunset over mountains — low gold light on the horizon under swept pink and violet clouds."
            fill priority sizes="100vw" className="object-cover"
            style={{ filter: "saturate(0.7) brightness(0.99) contrast(1.02) blur(2.5px)", transform: "scale(1.07)" }}
          />
          <div aria-hidden className="absolute inset-0" style={{ backdropFilter: "blur(1.5px)", WebkitBackdropFilter: "blur(1.5px)", background: "rgba(255,255,255,0.05)" }} />
          <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(16,10,26,0.42) 0%, rgba(16,10,26,0.10) 30%, rgba(16,10,26,0.16) 60%, rgba(16,10,26,0.28) 100%)" }} />

          {/* the opening claim — clipped together with the sunset */}
          <div ref={claimRef} className="absolute inset-0 mx-auto flex h-full max-w-6xl flex-col justify-end px-6 pb-24 pt-32">
            <h1 className="font-display text-[clamp(2.9rem,8vw,6.5rem)] font-600 leading-[0.92] tracking-[-0.045em] text-white drop-shadow-[0_2px_30px_rgba(16,8,26,0.45)]">
              the world&rsquo;s first
              <br /> digital human.
            </h1>
            <p className="mt-6 font-display text-[clamp(1.3rem,2.6vw,2rem)] font-400 leading-[1.12] tracking-[-0.02em] text-white/95 drop-shadow-[0_1px_16px_rgba(16,8,26,0.5)]">
              built for you, by you.
            </p>
            <p className="mt-5 max-w-lg text-pretty font-geist text-[clamp(1rem,1.5vw,1.18rem)] leading-[1.5] text-white/85 drop-shadow-[0_1px_12px_rgba(16,8,26,0.55)]">
              One mind that only ever learns you. It watches your screen, runs your
              apps, texts you back, and slowly turns into your other half.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/download" className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-geist text-[15px] font-600 text-[#16121f] shadow-[0_12px_40px_rgba(16,8,26,0.3)] transition-transform duration-200 hover:-translate-y-0.5">
                Download eri
                <ArrowRight size={16} strokeWidth={2.4} className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link href="/phone" className="inline-flex items-center gap-2 rounded-full border border-white/45 px-7 py-3.5 font-geist text-[15px] text-white backdrop-blur-sm transition-colors duration-200 hover:bg-white/10">
                or just text it
              </Link>
            </div>
          </div>
        </div>

        {/* legibility breath behind the mind copy */}
        <div aria-hidden className="tf-veil pointer-events-none absolute inset-0" />

        {/* the mind: headline + the real eri pill (what the sunset becomes) */}
        <div ref={mindRef} className="relative z-10 flex w-full max-w-2xl flex-col items-center px-6 text-center" style={{ opacity: 0 }}>
          <h2 className="font-display text-balance text-[clamp(2.2rem,5vw,3.8rem)] font-600 leading-[1.0] tracking-[-0.04em] text-text">
            everything it&rsquo;s thinking,
            <br className="hidden sm:block" /> while you just talk to it.
          </h2>
          <p className="mt-5 max-w-md text-pretty font-geist text-[clamp(1rem,1.5vw,1.18rem)] leading-[1.55] text-text-sec">
            One mind, always on. It reads, decides, acts. You just say what you
            want and it goes and does it.
          </p>
          <div className="mt-9 flex w-full justify-center">
            <EriComposer />
          </div>
        </div>
      </div>
    </section>
  );
}
