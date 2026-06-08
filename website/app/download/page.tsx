import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Download eri — your computer, hands-free",
  description:
    "Get eri for macOS. Three steps: download, sign in and sync your device, set your hotkey. Then eri is always one keypress away — voice, eyes, and a coding agent in one.",
};

interface Step {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

const STEPS: ReadonlyArray<Step> = [
  {
    n: "1",
    title: "Download eri",
    body: "Get the macOS app below, or install the CLI from your terminal. First launch walks you through microphone, accessibility, and screen-recording permissions — these are what let eri hear you, see your screen, and act on your behalf. You stay in control: nothing is granted you don't approve.",
  },
  {
    n: "2",
    title: "Log in and sync your device",
    body: "Sign in with your eri account. Your plan, memory, and preferences sync to this device so eri picks up where you left off — and learns how you work from the first session.",
  },
  {
    n: "3",
    title: "Set your hotkey",
    body: "Pick any shortcut — it can be anything. From then on, that key pulls eri up instantly, anywhere on your computer. eri stays active in the background, ready to listen, look, and act the moment you call it.",
  },
];

interface Capability {
  readonly title: string;
  readonly body: string;
}

const CAN_DO: ReadonlyArray<Capability> = [
  {
    title: "Run your computer hands-free",
    body: "“Open my email.” “Search YouTube for lofi.” “Join the call.” Say it or point with your eyes — eri operates your real apps and confirms before anything risky.",
  },
  {
    title: "Write, then act",
    body: "“Draft a reply to this email, then open my inbox.” eri writes it clean, then carries the task across apps without you touching the mouse.",
  },
  {
    title: "Build software",
    body: "“Add a settings page and run the tests.” The same agent that runs your computer plans, edits across files, and ships — voice- and gaze-driven.",
  },
  {
    title: "Pull up your day",
    body: "“What's on my plan today?” eri reads what's on screen and in your memory, and tees up the next thing before you ask.",
  },
];

function PlatformCard({
  label,
  sub,
  href,
  primary,
}: {
  readonly label: string;
  readonly sub: string;
  readonly href: string;
  readonly primary?: boolean;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className={`flex flex-col rounded-lg border p-6 transition-colors ${
        primary
          ? "border-border-strong bg-bg-card hover:bg-bg-card-2"
          : "border-border bg-bg-card/60 hover:bg-bg-card"
      }`}
    >
      <span className="font-display text-lg text-text">{label}</span>
      <span className="mt-1 text-sm text-text-sec">{sub}</span>
    </Link>
  );
}

export default function DownloadPage(): React.ReactElement {
  return (
    <main>
      {/* Hero */}
      <section className="bg-bg text-text">
        <div className="container pt-28 pb-12 lg:pt-36 lg:pb-16">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-text-sec mb-5">
              Download
            </p>
            <h1
              className="text-h1 text-balance mb-6 leading-[1.02]"
              style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
            >
              Your computer, hands-free — in three steps.
            </h1>
            <p className="text-text-sec text-[17px] leading-[1.55] max-w-prose">
              Download eri, sign in, set a hotkey. After that, one keypress pulls
              eri up anywhere — to listen, look at your screen, remember you, and
              get the work done. macOS first; Windows and Linux are on the way.
            </p>
          </div>
        </div>
      </section>

      {/* Platform options */}
      <section className="container pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PlatformCard
            label="Download for macOS"
            sub="Apple Silicon & Intel · .dmg"
            href="/api/download/macos"
            primary
          />
          <PlatformCard
            label="Windows"
            sub="Coming soon"
            href="/contact"
          />
          <PlatformCard label="Linux" sub="Coming soon" href="/contact" />
        </div>

        <div className="mt-6 rounded-lg border border-border bg-bg-card/60 p-6">
          <p className="text-sm text-text-sec mb-3">
            Prefer the terminal? Install the eri CLI:
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-bg px-4 py-3 font-mono text-[13px] text-text">
            <code>curl -fsSL https://tryeri.ca/install | sh</code>
          </pre>
          <p className="mt-3 text-xs text-text-ter">
            The CLI gives you <code className="text-text-sec">eri chat</code>,{" "}
            <code className="text-text-sec">eri build</code>,{" "}
            <code className="text-text-sec">eri control</code>, and{" "}
            <code className="text-text-sec">eri watch</code> — the same agent,
            scriptable. See the{" "}
            <Link href="/docs/quickstart" className="text-text underline underline-offset-2">
              quickstart
            </Link>
            .
          </p>
        </div>
      </section>

      {/* 3-step onboarding */}
      <section className="container mb-20 lg:mb-28">
        <div className="mb-10 border-t border-border pt-10">
          <h2
            className="text-h2 text-balance max-w-2xl text-text"
            style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
          >
            Set up once. Then it's always there.
          </h2>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-bg-card p-7">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-bg font-display text-lg text-text">
                {s.n}
              </div>
              <h3 className="mt-5 font-display text-xl tracking-tight font-normal text-text">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-text-sec leading-relaxed">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* What you can do day one */}
      <section className="container mb-24 lg:mb-32">
        <div className="mb-10 border-t border-border pt-10">
          <h2
            className="text-h2 text-balance max-w-2xl text-text"
            style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
          >
            What to try first.
          </h2>
          <p className="mt-4 max-w-xl text-text-sec text-[15px] leading-relaxed">
            Once your hotkey is set, just talk to eri. A few things to ask on day
            one:
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {CAN_DO.map((c) => (
            <article
              key={c.title}
              className="rounded-lg border border-border bg-bg-card/60 p-6"
            >
              <h3 className="font-display text-lg tracking-tight font-normal text-text">
                {c.title}
              </h3>
              <p className="mt-2 text-sm text-text-sec leading-relaxed">
                {c.body}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/sign-up"
            className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90 transition-opacity"
          >
            Create your account
          </Link>
          <Link
            href="/docs/quickstart"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[14px] text-text hover:bg-bg-card transition-colors"
          >
            Read the quickstart
          </Link>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
