import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Workbench — eri Docs",
  description:
    "Layout, panels, composer, terminal context, review flow, and keymaps inside eri.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "Workbench layout",
    body: "eri keeps code, terminal output, task history, and agent review in one local workspace. The centre area is the editor substrate; the side panels hold the composer (⌘K), chat (⌘L), mentions (@ for files, # for symbols, / for commands), and the review queue.",
  },
  {
    heading: "The composer",
    body: "⌘K opens the composer. Type a prompt, optionally @-mention files or #-mention symbols, and hit Enter. eri builds a bounded request from the mentioned context plus the current selection or active file. The response becomes a proposed diff, command, or plan that waits for your review.",
  },
  {
    heading: "Review step",
    body: "Every agent edit lands in a review panel before it touches your files. Hunks can be accepted individually, partially accepted, or rejected. Until you accept, nothing changes on disk. eri keeps a local checkpoint of the file state before each apply, so a bad edit can be reverted in one action.",
  },
  {
    heading: "Mentions",
    body: "@ pulls in a file by name; the mention picker fuzzy-matches against the indexed files in the workspace. # pulls in a symbol — function, class, type. / triggers a slash command (commit, run, test, etc.). Mentions are bounded context: only what you mention is sent.",
  },
  {
    heading: "Voice mode",
    body: "The microphone button (or wakeword) starts local transcription. Audio frames stay on the device. Voice mode supports the same @-mentions and slash commands as the keyboard composer — speak them naturally and the parser handles them.",
  },
  {
    heading: "Terminal context",
    body: "Command output is part of the workspace. When a build, test, or script fails, eri can use the active terminal buffer as context, propose the next command, and keep the reasoning attached to the task history.",
  },
  {
    heading: "Cloud handoff",
    body: "Local work stays local until a task needs remote runtime, longer execution, or hosted resources. Cloud handoff shows what will leave the machine, what credentials are in scope, and where the run will happen before you start it.",
  },
  {
    heading: "Keymaps",
    body: "⌘K composer, ⌘L chat, ⌘⇧L new chat, ⌘. apply selected hunks, ⌘\\ toggle AI panel. The full keymap lives in Settings → Keyboard Shortcuts and is fully rebindable.",
  },
];

export default function IdeDocsPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
            <Link href="/docs" className="text-accent hover:text-paper transition">
              Docs
            </Link>
            <span aria-hidden className="text-paper/30">/</span>
            <span className="text-paper/55">Workbench</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            The workbench.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            How the editor substrate, composer, terminal context, review
            step, and cloud handoff fit together. The short version: ⌘K to
            ask, review what changes, then apply or run only what you accept.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <div className="flex flex-col gap-10">
            {SECTIONS.map((s) => (
              <div key={s.heading}>
                <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                  {s.heading}
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
