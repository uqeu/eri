import Link from "next/link";
import { InstallBlock } from "./InstallBlock";
import { MorphPad } from "./MorphPad/MorphPad";

export function Hero(): React.ReactElement {
  return (
    <section className="relative overflow-hidden bg-bg text-text">
      {/* Layered depth: neutral wash + lime-faint mesh + film grain. */}
      <div className="pointer-events-none absolute inset-0 hero-wash opacity-80" />
      <div className="pointer-events-none absolute inset-0 mesh-bg opacity-30" />
      <div className="pointer-events-none absolute inset-0 grain opacity-[0.4] mix-blend-soft-light" />

      <div className="container relative pt-28 pb-20 lg:pt-36 lg:pb-28">
        {/* Centered pitch */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="rise mono-cap text-text-ter mb-6" style={{ animationDelay: "0ms" }}>
            One glass pad — it opens into everything
          </p>
          <h1 className="rise text-display font-display text-balance mb-6" style={{ animationDelay: "60ms", fontWeight: 500 }}>
            It uses your computer. With you.
          </h1>
          <p className="rise mx-auto max-w-xl text-text-sec text-[18px] leading-[1.55] mb-9" style={{ animationDelay: "140ms" }}>
            One glass pad with two modes. <span className="text-text">Control</span> it
            and it runs your real apps, reads your screen, and remembers you.
            Tell it to <span className="text-text">Build</span> and it expands
            into a full editor that ships. One surface, on your Mac, local.
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

        {/* The product IS the hero: one glass pad on a real, colourful desktop,
            morphing between Control and Build. */}
        <div className="relative mx-auto mt-16 lg:mt-20">
          <MorphPad />
        </div>
      </div>
    </section>
  );
}
