"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  useWebGLAvailable,
  usePrefersReducedMotion,
  CanvasErrorBoundary,
} from "./cinematic/WebglGuard";

// The cinematic stage. The 3D city is client-only (WebGL), dynamically imported
// so it never runs on the server. A dusk gradient stands in while it boots, and
// also shows if WebGL/JS is unavailable, so the section is never blank. The
// directed beat timeline + real eri pill + resolve layer in next; this first cut
// is the continuous fly-through with the mission framed over it.
const CityScene = dynamic(
  () => import("./cinematic/CityScene").then((m) => m.CityScene),
  {
    ssr: false,
    loading: () => <div aria-hidden className="absolute inset-0 cine-dusk" />,
  },
);

export function CinematicHero(): React.ReactElement {
  const webgl = useWebGLAvailable();
  const reduced = usePrefersReducedMotion();
  const show3D = webgl === true && !reduced;

  return (
    <section
      className="relative isolate w-full overflow-hidden"
      style={{ height: "100svh", background: "#140d28" }}
      aria-label="eri — a digital human that lives across your screens"
    >
      <div className="absolute inset-0 cine-dusk" aria-hidden />
      {show3D && (
        <div className="absolute inset-0">
          <CanvasErrorBoundary fallback={null}>
            <CityScene />
          </CanvasErrorBoundary>
        </div>
      )}

      {/* legibility scrim, heaviest at the bottom where the type sits */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 8%, rgba(10,6,22,0.5) 0%, transparent 42%)," +
            "linear-gradient(180deg, rgba(10,6,22,0.35) 0%, transparent 30%, transparent 52%, rgba(10,6,22,0.82) 100%)",
        }}
      />

      {/* the mission, framed over the city */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-16 md:px-10 md:pb-20">
        <div className="mx-auto max-w-6xl">
          <h1 className="max-w-3xl text-balance font-display text-[clamp(2.4rem,6vw,5rem)] font-600 leading-[0.98] tracking-[-0.035em] text-white">
            the world’s first digital human.
          </h1>
          <p className="mt-5 max-w-xl text-pretty font-geist text-[clamp(1.02rem,1.6vw,1.25rem)] leading-[1.5] text-white/85">
            eri is a being you create to your liking — it lives on your computer
            and your phone, learns only you, and grows into your other half.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/download"
              className="group inline-flex items-center gap-2 rounded-full bg-[#d9ff57] px-7 py-3.5 font-geist text-[15px] font-600 text-[#14180a] transition-transform duration-200 hover:-translate-y-0.5"
            >
              Download eri
              <ArrowRight
                size={16}
                strokeWidth={2.4}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/phone"
              className="inline-flex items-center gap-2 rounded-full border border-white/35 px-7 py-3.5 font-geist text-[15px] text-white backdrop-blur-sm transition-colors duration-200 hover:bg-white/10"
            >
              or just text it
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
