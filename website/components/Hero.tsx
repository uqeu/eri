import Link from "next/link";
import { InstallBlock } from "./InstallBlock";
import { EriTerminal } from "./EriTerminal";

export function Hero(): React.ReactElement {
  return (
    <section className="relative overflow-hidden bg-bg text-text">
      {/* Layered depth: neutral wash + lime-faint mesh + film grain. */}
      <div className="pointer-events-none absolute inset-0 hero-wash" />
      <div className="pointer-events-none absolute inset-0 mesh-bg opacity-70" />
      <div className="pointer-events-none absolute inset-0 grain opacity-[0.5] mix-blend-soft-light" />

      <div className="container relative pt-28 pb-20 lg:pt-36 lg:pb-28">
        {/* Centered pitch */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="rise mono-cap text-text-ter mb-6" style={{ animationDelay: "0ms" }}>
            A personal assistant that uses your computer
          </p>
          <h1 className="rise text-display font-display text-balance mb-6" style={{ animationDelay: "60ms", fontWeight: 500 }}>
            It uses your computer. With you.
          </h1>
          <p className="rise mx-auto max-w-xl text-text-sec text-[18px] leading-[1.55] mb-9" style={{ animationDelay: "140ms" }}>
            eri lives on your Mac. It sees your screen, hears you, and remembers
            how you work, then does things for you while you keep working.
            Summon it over any app, drop into your terminal, or build in your
            editor. One assistant, everywhere, local.
          </p>
          <div className="rise flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "220ms" }}>
            <Link
              href="/download"
              className="group inline-flex items-center gap-2 rounded-md bg-text px-5 py-2.5 text-[14px] font-medium text-bg transition-transform duration-200 ease-out-soft hover:-translate-y-0.5 active:translate-y-0"
            >
              Request access
              <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center rounded-md px-5 py-2.5 text-[14px] text-text-sec transition-colors duration-200 hover:text-text"
            >
              See how it works
            </Link>
          </div>

          {/* Honest pre-launch status (no fake install commands). */}
          <div className="rise mt-10" style={{ animationDelay: "260ms" }}>
            <InstallBlock />
          </div>
        </div>

        {/* The product, Warp-style: the live glass terminal floating on ambient
            light. No hard frame, just a lime glow and a faint grid that fades
            out at the edges, so the glass card is the hero. */}
        <div className="rise relative mx-auto mt-20 max-w-4xl lg:mt-24" style={{ animationDelay: "320ms" }}>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 -bottom-16 -z-10">
            <div
              className="absolute inset-0"
              style={{ background: "radial-gradient(52% 44% at 50% 42%, rgba(224,255,79,0.12), transparent 72%)" }}
            />
            <div
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
                backgroundSize: "44px 44px",
                maskImage: "radial-gradient(58% 50% at 50% 42%, #000, transparent 82%)",
                WebkitMaskImage: "radial-gradient(58% 50% at 50% 42%, #000, transparent 82%)",
              }}
            />
          </div>
          <EriTerminal className="relative mx-auto w-full max-w-[560px]" />
        </div>
      </div>
    </section>
  );
}
