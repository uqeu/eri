import Link from "next/link";
import { DemoShowcase } from "./DemoShowcase";
import { InstallBlock } from "./InstallBlock";
import { EriToolsTerminal } from "./EriToolsTerminal";
import { EriAssistantCard } from "./EriAssistantCard";

export function Hero(): React.ReactElement {
  return (
    <section className="relative overflow-hidden bg-bg text-text">
      {/* Layered depth: neutral wash + lime-faint mesh + film grain. */}
      <div className="pointer-events-none absolute inset-0 hero-wash" />
      <div className="pointer-events-none absolute inset-0 mesh-bg opacity-70" />
      <div className="pointer-events-none absolute inset-0 grain opacity-[0.5] mix-blend-soft-light" />

      <div className="container relative pt-24 pb-16 lg:pt-32 lg:pb-20">
        {/* Centered pitch */}
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="rise mono-cap text-text-ter mb-6"
            style={{ animationDelay: "0ms" }}
          >
            Hands-free computer control
          </p>
          <h1
            className="rise text-display font-display text-balance mb-6"
            style={{ animationDelay: "60ms", fontWeight: 500 }}
          >
            Your computer, hands-free.
          </h1>
          <p
            className="rise mx-auto max-w-xl text-text-sec text-[18px] leading-[1.55] mb-9"
            style={{ animationDelay: "140ms" }}
          >
            eri sees your screen, hears you, and remembers you — then does the
            work. One local-first agent that controls your computer, writes your
            code, and learns how you work. Click through what it does.
          </p>
          <div
            className="rise flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "220ms" }}
          >
            <Link
              href="/download"
              className="group inline-flex items-center gap-2 rounded-md bg-text px-5 py-2.5 text-[14px] font-medium text-bg transition-transform duration-200 ease-out-soft hover:-translate-y-0.5 active:translate-y-0"
            >
              Download eri
              <span
                aria-hidden
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-[14px] text-text transition-colors duration-200 hover:border-border-strong hover:bg-bg-card"
            >
              See how it works
            </Link>
          </div>

          {/* Nia-style install command block */}
          <div className="rise mt-10" style={{ animationDelay: "260ms" }}>
            <InstallBlock />
          </div>
        </div>

        {/* The interactive, click-through demo — with the tools terminal
            floating over its corner (the "one agent, many tools" proof). */}
        <div
          className="rise relative mx-auto mt-14 max-w-5xl"
          style={{ animationDelay: "320ms" }}
        >
          <DemoShowcase />
          <EriToolsTerminal className="relative z-10 mt-4 md:absolute md:bottom-5 md:left-5 md:mt-0 md:w-[380px] md:max-w-[46%]" />
          <EriAssistantCard className="relative z-10 mx-auto mt-4 w-full max-w-[340px] md:absolute md:right-5 md:bottom-8 md:mt-0 md:w-[320px]" />
        </div>
      </div>
    </section>
  );
}
