"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import {
  APP_DIRECTORY,
  CAPABILITY_GROUPS,
  DIRECTORY_TAIL,
  DOC_SECTIONS,
  FALLBACK_LINE,
  GETTING_STARTED,
  PATHS,
  PHONE_CHANNELS,
  PLANS,
  STREAM_EXAMPLE,
  TRUST_POINTS,
  USAGE_LINE,
  type DirectoryCategory,
  type StreamLine,
} from "@/components/docs/docs-content";

const EASE = "cubic-bezier(0.16,1,0.3,1)"; // ease-out-expo
const ACCENT = "#d9ff57";

// The docs body: a sticky left rail that highlights the section you are reading,
// and a single readable content column at a ~70ch measure. Everything is plain
// `.theme-light` tokens so it matches the rest of the marketing site. Motion is
// transform/opacity only, and the reveal is disabled under reduced-motion.
export function DocsExperience(): React.ReactElement {
  const active = useScrollSpy(DOC_SECTIONS.map((s) => s.id));

  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-16">
      <SidebarNav active={active} />
      <div className="min-w-0">
        <MobileNav active={active} />
        <article className="flex flex-col gap-20 pb-24 lg:gap-28">
          <GettingStarted />
          <WhatEriDoes />
          <HowEriWorks />
          <ThoughtStream />
          <PhoneSection />
          <TrustSection />
          <PlansSection />
        </article>
      </div>
    </div>
  );
}

// --- Scroll spy ------------------------------------------------------------

// Tracks which section heading is nearest the top of the viewport. Uses an
// IntersectionObserver band in the upper third of the screen so the rail lights
// the section you are actually reading, not the one just scrolling past.
function useScrollSpy(ids: ReadonlyArray<string>): string {
  const [active, setActive] = useState<string>(ids[0] ?? "");

  useEffect(() => {
    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          seen.set(entry.target.id, entry.intersectionRatio);
        }
        let best = "";
        let bestRatio = -1;
        for (const id of ids) {
          const ratio = seen.get(id) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        }
        if (bestRatio > 0 && best) setActive(best);
      },
      { rootMargin: "-12% 0px -70% 0px", threshold: [0, 0.25, 0.5, 1] },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

// --- Sidebar (desktop) -----------------------------------------------------

function SidebarNav({ active }: { active: string }): React.ReactElement {
  return (
    <nav
      aria-label="Docs sections"
      className="hidden lg:block"
    >
      <div className="sticky top-28">
        <p className="font-geist text-[12.5px] font-medium text-[#86868b]">
          On this page
        </p>
        <ul className="mt-4 flex flex-col gap-0.5 border-l border-black/[0.08]">
          {DOC_SECTIONS.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={on ? "true" : undefined}
                  className="group relative -ml-px flex items-center border-l-2 py-1.5 pl-4 font-geist text-[14px] outline-none transition-colors duration-200"
                  style={{
                    borderColor: on ? "#1d1d1f" : "transparent",
                    color: on ? "#1d1d1f" : "#86868b",
                    fontWeight: on ? 600 : 450,
                    transitionTimingFunction: EASE,
                  }}
                >
                  {s.nav}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

// --- Mobile nav ------------------------------------------------------------

function MobileNav({ active }: { active: string }): React.ReactElement {
  return (
    <nav
      aria-label="Docs sections"
      className="mb-12 lg:hidden"
    >
      <p className="font-geist text-[12.5px] font-medium text-[#86868b]">
        On this page
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
        {DOC_SECTIONS.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? "true" : undefined}
                className="inline-flex rounded-full px-3.5 py-1.5 font-geist text-[13.5px] outline-none transition-colors duration-200"
                style={{
                  background: on ? "#1d1d1f" : "rgba(20,16,8,0.045)",
                  color: on ? "#ffffff" : "#515154",
                  fontWeight: on ? 600 : 450,
                  transitionTimingFunction: EASE,
                }}
              >
                {s.nav}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// --- Shared section shell --------------------------------------------------

function SectionHead({
  id,
  title,
  lede,
}: {
  id: string;
  title: string;
  lede: string;
}): React.ReactElement {
  return (
    <header className="max-w-[70ch] scroll-mt-28" id={id}>
      <h2
        className="font-display text-[#1d1d1f]"
        style={{
          fontSize: "clamp(1.7rem, 3vw, 2.4rem)",
          letterSpacing: "-0.025em",
          lineHeight: 1.1,
          fontWeight: 500,
        }}
      >
        {title}
      </h2>
      <p className="mt-4 font-geist text-[17px] leading-relaxed text-[#515154]">
        {lede}
      </p>
    </header>
  );
}

// --- Sections --------------------------------------------------------------

function GettingStarted(): React.ReactElement {
  return (
    <section>
      <SectionHead
        id="getting-started"
        title="Getting started"
        lede="The shortest path from a fresh download to eri running your Mac for you."
      />
      <ol className="mt-10 flex flex-col gap-8">
        {GETTING_STARTED.map((step, i) => (
          <li key={step.title} className="flex max-w-[70ch] gap-5">
            <span
              aria-hidden
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-geist-mono text-[13px] font-medium"
              style={{ background: "#f0eee9", color: "#1d1d1f" }}
            >
              {i + 1}
            </span>
            <div>
              <h3 className="font-geist text-[16.5px] font-semibold text-[#1d1d1f]">
                {step.title}
              </h3>
              <p className="mt-1.5 font-geist text-[15.5px] leading-relaxed text-[#515154]">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 max-w-[70ch] font-geist text-[15.5px] leading-relaxed text-[#515154]">
        Once it is running, summon it any time with{" "}
        <Kbd>&#8984;&#8997;E</Kbd> and tell it what you need.
      </p>
    </section>
  );
}

function WhatEriDoes(): React.ReactElement {
  // The headline catalog is the "It runs your apps" group: a real task per app.
  const runApps = CAPABILITY_GROUPS.find((g) => g.heading === "It runs your apps");

  return (
    <section>
      <SectionHead
        id="what-eri-does"
        title="What eri does"
        lede="A working catalog, not a wishlist. Each line is a real task eri carries out in the app you already use."
      />
      {runApps ? (
        <div className="mt-10 max-w-[72ch]">
          <h3 className="font-geist text-[17px] font-semibold text-[#1d1d1f]">
            {runApps.heading}
          </h3>
          <p className="mt-1.5 font-geist text-[15px] leading-relaxed text-[#86868b]">
            {runApps.intro}
          </p>
          <ul className="mt-5 flex flex-col divide-y divide-black/[0.06] border-y border-black/[0.06]">
            {runApps.items.map((item) => (
              <li
                key={item.app}
                className="flex flex-col gap-1 py-3.5 sm:flex-row sm:gap-6"
              >
                <span className="font-geist text-[15px] font-medium text-[#1d1d1f] sm:w-[200px] sm:shrink-0">
                  {item.app}
                </span>
                <span className="font-geist text-[15px] leading-relaxed text-[#515154]">
                  {item.does}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <AppDirectory />
    </section>
  );
}

// The wider directory: expandable category groups. Collapsed by default, opened
// one at a time. Built on native <details>/<summary> so it is keyboard
// accessible for free (Enter/Space toggles, focus ring on the summary). The
// chevron and the panel use transform/opacity only, disabled under
// prefers-reduced-motion via the global motion guard.
function AppDirectory(): React.ReactElement {
  return (
    <div className="mt-14 max-w-[72ch]">
      <h3 className="font-geist text-[17px] font-semibold text-[#1d1d1f]">
        More apps eri works with
      </h3>
      <p className="mt-1.5 font-geist text-[15px] leading-relaxed text-[#86868b]">
        Browse by category. Open a group to see the apps it covers.
      </p>
      <div className="mt-5 flex flex-col divide-y divide-black/[0.06] border-y border-black/[0.06]">
        {APP_DIRECTORY.map((category) => (
          <DirectoryGroup key={category.title} category={category} />
        ))}
      </div>
      <p className="mt-5 font-geist text-[14px] leading-relaxed text-[#86868b]">
        <Link
          href="/pricing"
          className="rounded-sm underline decoration-black/15 underline-offset-2 outline-none transition-colors duration-200 hover:decoration-black/40 focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ transitionTimingFunction: EASE }}
        >
          {DIRECTORY_TAIL}
        </Link>
      </p>
    </div>
  );
}

function DirectoryGroup({
  category,
}: {
  category: DirectoryCategory;
}): React.ReactElement {
  return (
    <details className="group/disc py-1">
      <summary
        className="flex cursor-pointer list-none items-center justify-between rounded-md py-3 font-geist text-[15px] font-medium text-[#1d1d1f] outline-none transition-colors duration-200 hover:text-black focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ transitionTimingFunction: EASE }}
      >
        <span className="flex items-center gap-2.5">
          {category.title}
          <span className="font-geist text-[13px] font-normal text-[#86868b]">
            {category.apps.length}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden
          className="text-[#86868b] transition-transform duration-300 group-open/disc:rotate-180 motion-reduce:transition-none"
          style={{ transitionTimingFunction: EASE }}
        />
      </summary>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 pb-4 pt-1 sm:grid-cols-3">
        {category.apps.map((app) => (
          <li
            key={app.name}
            className="flex items-center gap-2.5 font-geist text-[14.5px] text-[#515154]"
          >
            {app.logo ? (
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/[0.07] bg-white"
              >
                <img
                  src={`/logos/${app.logo}.svg`}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-4 w-4 object-contain"
                />
              </span>
            ) : (
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/[0.07] bg-[#f5f5f7] font-geist text-[12px] font-medium text-[#86868b]"
              >
                {app.name.charAt(0)}
              </span>
            )}
            <span className="min-w-0 truncate">{app.name}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function HowEriWorks(): React.ReactElement {
  return (
    <section>
      <SectionHead
        id="how-eri-works"
        title="How eri works"
        lede="There are two ways eri gets something done, and it moves between them on its own."
      />
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {PATHS.map((path, i) => (
          <div
            key={path.title}
            className="rounded-2xl border border-black/[0.08] bg-white p-6"
            style={{ boxShadow: "0 1px 2px rgba(20,16,8,0.04)" }}
          >
            <p className="font-geist-mono text-[12px] text-[#86868b]">
              {`Path ${String.fromCharCode(97 + i)}`}
            </p>
            <h3 className="mt-2 font-geist text-[17px] font-semibold text-[#1d1d1f]">
              {path.title}
            </h3>
            <p className="mt-2 font-geist text-[15px] leading-relaxed text-[#515154]">
              {path.body}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-8 max-w-[70ch] font-geist text-[15.5px] leading-relaxed text-[#515154]">
        {FALLBACK_LINE}
      </p>
    </section>
  );
}

function ThoughtStream(): React.ReactElement {
  return (
    <section>
      <SectionHead
        id="thought-stream"
        title="The thought stream"
        lede="When eri does anything that is not trivial, it shows its work in a small terminal. It thinks, runs a command, streams the output, and finishes, so you can watch how it got there."
      />
      <div className="mt-10 max-w-[70ch]">
        <StreamBlock lines={STREAM_EXAMPLE} app="Gmail" />
        <p className="mt-6 font-geist text-[15.5px] leading-relaxed text-[#515154]">
          Each command in the stream is also an entry in the action log, so the
          live view and the record are the same events: one shown as it happens,
          one kept for later. When it matters, the stream names the path it took,
          for instance a note that it is driving an app on screen because no
          connection was found.
        </p>
      </div>
    </section>
  );
}

// The signature dark mono terminal, rendered as static text. Each line kind
// gets its own tone: thinking is dim, the command is lime, output is neutral,
// done is green. No animated shadows or filters, fully static so it stays smooth
// with hardware acceleration off.
function StreamBlock({
  lines,
  app,
}: {
  lines: ReadonlyArray<StreamLine>;
  app: string;
}): React.ReactElement {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: "#0e0e13", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div
        className="flex items-center gap-2 border-b px-4 py-2.5"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a44" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a44" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a44" }} />
        </span>
        <span className="font-geist-mono text-[12px] text-white/40">
          {`eri · ${app}`}
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-geist-mono text-[13.5px] leading-[1.7]">
        {lines.map((line, i) => (
          <div key={i} style={{ color: lineColor(line.kind) }}>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function lineColor(kind: StreamLine["kind"]): string {
  switch (kind) {
    case "think":
      return "rgba(255,255,255,0.5)";
    case "cmd":
      return "#d7f06a";
    case "out":
      return "rgba(255,255,255,0.82)";
    case "done":
      return "#79e08a";
  }
}

function PhoneSection(): React.ReactElement {
  return (
    <section>
      <SectionHead
        id="phone"
        title="eri on your phone"
        lede="The same eri travels with you. It runs on the Spectrum messaging layer, Photon, so it shows up wherever you already text."
      />
      <div className="mt-8 max-w-[72ch]">
        <ul className="flex flex-wrap gap-2">
          {PHONE_CHANNELS.map((c) => (
            <li
              key={c}
              className="rounded-full border border-black/[0.08] bg-white px-3.5 py-1.5 font-geist text-[14px] text-[#1d1d1f]"
            >
              {c}
            </li>
          ))}
        </ul>
        <p className="mt-6 font-geist text-[15.5px] leading-relaxed text-[#515154]">
          When eri replies in a thread, it answers with tap-able mini apps right
          in the chat, not just a wall of text, so you can act on the answer
          without leaving the conversation. It is not a second app with a second
          memory. It is one mind across your Mac and your phone, so the thread you
          started at your desk is the one waiting in your texts.
        </p>
      </div>
    </section>
  );
}

function TrustSection(): React.ReactElement {
  return (
    <section>
      <SectionHead
        id="trust"
        title="Trust and control"
        lede="An agent that runs your computer has to be legible. eri is built so you can always see what it did and take it back."
      />
      <div className="mt-10 flex flex-col gap-7">
        {TRUST_POINTS.map((point) => (
          <div key={point.title} className="max-w-[70ch]">
            <h3 className="font-geist text-[16.5px] font-semibold text-[#1d1d1f]">
              {point.title}
            </h3>
            <p className="mt-1.5 font-geist text-[15.5px] leading-relaxed text-[#515154]">
              {point.body}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-9 max-w-[70ch] rounded-xl border border-black/[0.08] bg-[#f5f5f7] p-5">
        <p className="font-geist text-[14.5px] leading-relaxed text-[#515154]">
          See what eri has done and roll back anything reversible from the
          terminal:
        </p>
        <pre className="mt-3 overflow-x-auto font-geist-mono text-[13.5px] leading-[1.7] text-[#1d1d1f]">
{`$ eri control --history
$ eri control --undo`}
        </pre>
      </div>
    </section>
  );
}

function PlansSection(): React.ReactElement {
  return (
    <section>
      <SectionHead
        id="plans"
        title="Plans and usage"
        lede="Four plans, with metered cloud work layered on top only if you choose it."
      />
      <ul className="mt-10 flex max-w-[72ch] flex-col divide-y divide-black/[0.06] border-y border-black/[0.06]">
        {PLANS.map((plan) => (
          <li key={plan.name} className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-6">
            <span className="font-geist text-[15.5px] font-semibold text-[#1d1d1f] sm:w-[120px] sm:shrink-0">
              {plan.name}
            </span>
            <span className="font-geist text-[15px] leading-relaxed text-[#515154]">
              {plan.line}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-8 max-w-[70ch] font-geist text-[15.5px] leading-relaxed text-[#515154]">
        {USAGE_LINE}
      </p>
      <Link
        href="/pricing"
        className="group mt-7 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 font-geist text-[14.5px] font-semibold text-white outline-none transition-transform duration-200 hover:-translate-y-[1px] focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: "#16140f", transitionTimingFunction: EASE }}
      >
        See full pricing
        <ArrowUpRight
          size={15}
          strokeWidth={2.4}
          className="transition-transform duration-300 group-hover:translate-x-[2px] group-hover:-translate-y-[2px]"
          style={{ transitionTimingFunction: EASE }}
        />
      </Link>
    </section>
  );
}

// A small inline keycap. The hotkey is a real interactive affordance in the
// product, so this is the one place lime is allowed to touch, used as a hairline
// underglow on the cap rather than as text on white.
function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd
      className="inline-flex items-center rounded-md border px-1.5 py-0.5 font-geist-mono text-[13px] font-medium text-[#1d1d1f]"
      style={{
        background: "#ffffff",
        borderColor: "rgba(20,16,8,0.14)",
        boxShadow: `0 1px 0 rgba(20,16,8,0.06), inset 0 -2px 0 ${ACCENT}`,
      }}
    >
      {children}
    </kbd>
  );
}
