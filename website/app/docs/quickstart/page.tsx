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
    title: "1. Install eri",
    body: "Download from tryeri.ca/download. On macOS, drag eri.app into Applications and launch. On Windows, run the installer. On Linux, follow the per-distro instructions. First launch will ask for microphone and accessibility permissions — grant them to enable voice and inline editing, or skip them and use eri as a keyboard-first workbench.",
  },
  {
    title: "2. Sign in",
    body: "Click Sign in on the launch screen and choose the account path you prefer. You'll land in your home tab with no projects yet.",
  },
  {
    title: "3. Review workspace secrets",
    body: "Open Settings → Secrets before your first agent turn. Paid plans include managed cloud turns; local and external service credentials stay in your OS keychain and are scoped to the workspace. See /docs/byok for the longer version.",
  },
  {
    title: "4. Open a project",
    body: "File → Open Folder. Pick any directory — even a fresh one. eri indexes the files in the background so prompts can reference them by name.",
  },
  {
    title: "5. Run your first edit",
    body: "Hit ⌘K (or Ctrl-K on Windows/Linux) to open the composer. Type what you want changed — for example: \"Add a function in main.py that prints the first 10 prime numbers.\" eri proposes the change as a diff. Review it. Click Apply to write it to disk, or Cancel to throw it away. That's the local loop.",
  },
  {
    title: "6. Try voice (optional)",
    body: "Hit the microphone button or say the wakeword. Speak your prompt as you would type it. eri's local transcription pipeline turns it into text, then runs the same composer flow. Audio stays on your device; the reviewed request is the only part eligible for cloud handoff.",
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
            Ten minutes to first edit.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            The shortest path from a fresh download to a working
            agent-assisted edit. If anything below diverges from what you see
            in the app, the app wins — email phlotu@gmail.com and the
            operator will update this page.
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
