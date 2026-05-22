import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "The IDE — eri Docs",
  description:
    "Layout, panels, composer, apply step, and keymaps inside the eri IDE.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "Layout",
    body: "eri is a VSCodium-fork IDE with the standard left activity bar, a centre editor area, and a right AI panel. The AI panel is the home of the composer (⌘K), the chat (⌘L), and the mention picker (@ for files, # for symbols, / for slash commands). Everything you know from VS Code keybindings still works — the AI surfaces are additive.",
  },
  {
    heading: "The composer",
    body: "⌘K opens the composer. Type a prompt, optionally @-mention files or #-mention symbols, and hit Enter. eri sends only the mentioned context (plus the current selection or active file) to the model. The model responds with a diff in search-and-replace blocks, which the apply step writes to disk after you review.",
  },
  {
    heading: "Apply step",
    body: "Every model edit lands in a review panel before it touches your files. Hunks can be accepted individually, partially accepted, or rejected. Until you accept, nothing changes on disk. eri keeps a local checkpoint of the file state before each apply, so a bad edit can be reverted in one action.",
  },
  {
    heading: "Mentions",
    body: "@ pulls in a file by name; the mention picker fuzzy-matches against the indexed files in the workspace. # pulls in a symbol — function, class, type. / triggers a slash command (commit, run, test, etc.). Mentions are bounded context: only what you mention is sent.",
  },
  {
    heading: "Voice mode",
    body: "The microphone button (or wakeword) starts local transcription. Audio frames stay on the device; only the resulting prompt is sent. Voice mode supports the same @-mentions and slash commands as the keyboard composer — speak them naturally and the parser handles them.",
  },
  {
    heading: "Gaze mode",
    body: "If you've enabled gaze tracking, eri uses your gaze to follow which file or symbol you're looking at and biases the composer's default context accordingly. The gaze estimator runs entirely on the device and produces no telemetry. Disable it in Settings → Privacy if you'd rather not.",
  },
  {
    heading: "Keymaps",
    body: "⌘K composer, ⌘L chat, ⌘⇧L new chat, ⌘. apply selected hunks, ⌘\\ toggle AI panel. The full keymap lives in Settings → Keyboard Shortcuts and is fully rebindable.",
  },
];

export default function IdeDocsPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
            <Link href="/docs" className="text-accent hover:text-paper transition">
              Docs
            </Link>
            <span aria-hidden className="text-paper/30">/</span>
            <span className="text-paper/55">The IDE</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            The IDE.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            How the editor, composer, and apply step fit together. The
            short version: ⌘K to ask, review the diff, accept the hunks
            you want.
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
