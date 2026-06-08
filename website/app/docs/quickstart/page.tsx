import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Quickstart — eri Docs",
  description:
    "Install, sign in, and run your first agent-assisted edit in ten minutes.",
};

interface Step {
  readonly title: string;
  readonly body: string;
}

const STEPS: ReadonlyArray<Step> = [
  {
    title: "1. Download eri",
    body: "Get the macOS app from tryeri.ca/download, or install the CLI with `curl -fsSL https://tryeri.ca/install | sh`. First launch walks you through microphone, accessibility, and screen-recording permissions — these let eri hear you, see your screen, and act for you. Grant what you're comfortable with; you can use eri keyboard-first and add the rest later.",
  },
  {
    title: "2. Log in and sync your device",
    body: "Sign in with your eri account (or run `eri auth login` in the terminal). Your plan, memory, and preferences sync to this device, so eri picks up where you left off and starts learning how you work.",
  },
  {
    title: "3. Set your hotkey",
    body: "Pick any shortcut — it can be anything. From then on, that key pulls eri up instantly, anywhere on your computer. eri stays active in the background, ready to listen, look, and act the moment you call it.",
  },
  {
    title: "4. Talk to it — or point with your eyes",
    body: "Press your hotkey and say what you want: \"open my email,\" \"search YouTube for lofi,\" \"draft a reply to this, then open my inbox.\" eri reads what's on screen, plans the steps, and does them — confirming before anything risky. Look at the thing you mean and say \"click this,\" and gaze resolves the target.",
  },
  {
    title: "5. Let it build, too",
    body: "Open a folder (or run `eri build` / `eri chat` in any repo) and ask: \"add a settings page and run the tests.\" The same agent that runs your computer plans, edits across files, previews the diff, and ships — voice- and gaze-driven. Review and apply, or throw it away.",
  },
  {
    title: "6. Watch it get sharper",
    body: "eri keeps a private, on-device memory of your projects, habits, and preferences, and starts to anticipate — \"you usually open this next, want me to?\" Voice, gaze, and memory stay on your machine; the cloud is used only when it genuinely helps, and you always see what left the device.",
  },
];

export default function QuickstartPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
            <Link href="/docs" className="text-accent hover:text-paper transition">
              Docs
            </Link>
            <span aria-hidden className="text-paper/30">/</span>
            <span className="text-paper/55">Quickstart</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Ten minutes to hands-free.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            The shortest path from a fresh download to eri running your
            computer — listening, looking at your screen, and getting work
            done. If anything below diverges from what you see in the app, the
            app wins — email phlotu@gmail.com and the operator will update
            this page.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <div className="flex flex-col gap-10">
            {STEPS.map((s) => (
              <div key={s.title}>
                <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                  {s.title}
                </h2>
                <p className="mt-3 text-muted leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
