import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { TextThread } from "@/components/phone/TextThread";
import { MemoryRelayDiagram } from "@/components/phone/MemoryRelayDiagram";
import { PhoneCapabilities } from "@/components/phone/PhoneCapabilities";

export const metadata: Metadata = {
  title: "Phone eri — text the eri that knows your day",
  description:
    "Phone eri is the same eri, reached by text. The cloud half of one brain, backed by the eri on your computer — it knows your day, remembers when things happened, and can act on your machine with confirmation. Two-tier memory keeps the deep parts end-to-end encrypted.",
};

interface ContrastRow {
  readonly them: string;
  readonly eri: string;
}

const CONTRAST: ReadonlyArray<ContrastRow> = [
  {
    them: "A separate cloud chatbot that forgets you between threads.",
    eri: "The cloud half of the eri on your computer — same memory, same brain.",
  },
  {
    them: "Answers from a generic profile it scraped together.",
    eri: "Answers from what actually happened on your machine today.",
  },
  {
    them: "Stores everything you tell it on a server it controls.",
    eri: "Keeps your real memory end-to-end encrypted — only your computer reads it.",
  },
  {
    them: "Can suggest, but can't reach into your real work.",
    eri: "Can act on your computer, with a confirmation gate on anything risky.",
  },
];

function SectionHeading({
  kicker,
  title,
  lead,
}: {
  readonly kicker: string;
  readonly title: string;
  readonly lead?: string;
}): React.ReactElement {
  return (
    <div className="mb-10 border-t border-border pt-10">
      <span className="mono-cap text-text-sec">{kicker}</span>
      <h2
        className="mt-4 max-w-2xl text-h2 text-balance text-text"
        style={{ letterSpacing: "-0.025em", fontWeight: 500 }}
      >
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-text-sec">{lead}</p>
      ) : null}
    </div>
  );
}

export default function PhonePage(): React.ReactElement {
  return (
    <main>
      {/* Hero */}
      <section className="border-b border-border bg-bg">
        <div className="container grid items-center gap-12 pt-28 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:pt-36 lg:pb-28">
          <div>
            <span className="mono-cap text-accent">Phone eri</span>
            <h1
              className="mt-5 max-w-2xl text-h1 text-balance text-text"
              style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
            >
              Text the eri that already knows your day.
            </h1>
            <p className="mt-6 max-w-prose text-[17px] leading-[1.55] text-text-sec">
              Phone eri isn&apos;t another chatbot. It&apos;s the same eri, reached by a
              text message — the cloud half of one brain, backed by the eri living on
              your computer. It knows what you worked on, remembers when things happened,
              and can act on your machine when you ask.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/download"
                className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg transition-opacity hover:opacity-90"
              >
                Get eri for macOS
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center text-[14px] text-text-sec transition-colors hover:text-text"
              >
                Request phone access
                <span className="ml-1.5" aria-hidden>
                  →
                </span>
              </Link>
            </div>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-text-ter">
              Pre-launch alpha · one brain on your computer and your phone
            </p>
          </div>

          <TextThread />
        </div>
      </section>

      {/* One-brain positioning vs shallow chatbots */}
      <section className="container py-20 lg:py-28">
        <SectionHeading
          kicker="The difference"
          title="One brain, two surfaces — not two assistants."
          lead="Most “AI over text” is a shallow cloud chatbot wearing your name. Phone eri is the outpost of the eri you already run."
        />
        <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2">
          <div className="bg-bg-card p-6 sm:p-8">
            <span className="mono-cap text-text-ter">Shallow cloud chatbots</span>
            <ul className="mt-5 space-y-4">
              {CONTRAST.map((row) => (
                <li key={row.them} className="text-[14.5px] leading-relaxed text-text-sec">
                  {row.them}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-bg-card p-6 sm:p-8">
            <span className="mono-cap text-accent">Phone eri</span>
            <ul className="mt-5 space-y-4">
              {CONTRAST.map((row) => (
                <li
                  key={row.eri}
                  className="flex gap-2.5 text-[14.5px] leading-relaxed text-text"
                >
                  <span className="mt-0.5 text-accent" aria-hidden>
                    →
                  </span>
                  <span>{row.eri}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Schematic: two-tier memory + relay */}
      <section className="container py-20 lg:py-28">
        <SectionHeading
          kicker="Architecture"
          title="How the memory and the relay actually work."
          lead="A small profile lives in the cloud so phone eri sounds like you. Everything deep stays encrypted on your computer — and questions or actions that need it relay home."
        />
        <MemoryRelayDiagram />
      </section>

      {/* Capabilities */}
      <section className="container py-20 lg:py-28">
        <SectionHeading
          kicker="What it does"
          title="Four things a real second surface can do."
        />
        <PhoneCapabilities />
      </section>

      {/* Honest CTA */}
      <section className="border-t border-border bg-bg">
        <div className="container py-24 lg:py-32">
          <div className="max-w-3xl">
            <span className="mono-cap text-text-sec">Early access</span>
            <h2
              className="mt-5 text-display font-normal leading-[0.98] text-balance text-text"
              style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
            >
              One eri.{" "}
              <span className="text-text-sec">Now on your phone too.</span>
            </h2>
            <p className="mt-7 max-w-prose text-[17px] leading-[1.55] text-text-sec">
              Phone eri is in pre-launch alpha — we&apos;re onboarding the first
              testers by hand. Install eri on your computer, then request a phone
              number to text. No fake numbers, no waitlist theater — just early,
              honest access while we get it right.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/download"
                className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg transition-opacity hover:opacity-90"
              >
                Get eri for macOS
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center text-[14px] text-text-sec transition-colors hover:text-text"
              >
                Request phone access
                <span className="ml-1.5" aria-hidden>
                  →
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
