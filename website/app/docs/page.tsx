import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Docs — eri",
  description: "Documentation for the eri voice-first IDE. Coming soon.",
};

interface QuickLink {
  readonly title: string;
  readonly description: string;
  readonly status: string;
}

const QUICK_LINKS: ReadonlyArray<QuickLink> = [
  {
    title: "Voice setup",
    description:
      "Pick a microphone, calibrate the wakeword, and tune push-to-talk versus lazy listening to the rhythm of your day.",
    status: "Draft · 12 sections",
  },
  {
    title: "Cmd-K keymap",
    description:
      "Every Cmd-K action in eri, with the spoken alias next to the chord. Includes the rebind config for vim-style users.",
    status: "Draft · 47 actions",
  },
  {
    title: "MCP servers",
    description:
      "How to register Model Context Protocol servers, scope their tool surface, and audit what the agent called and when.",
    status: "Draft · 8 sections",
  },
  {
    title: "Bring your own keys",
    description:
      "Wire up Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint. Storage, rotation, and team-level sharing.",
    status: "Draft · 6 sections",
  },
];

export default function DocsPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Docs
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Coming soon.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            We're polishing the full docs site — search, code samples, the
            works. In the meantime, here are the four guides most teams reach
            for first. Email{" "}
            <a
              href="mailto:hello@eri.dev"
              className="text-accent underline underline-offset-4"
            >
              hello@eri.dev
            </a>{" "}
            and we'll send the current drafts.
          </p>
          <div className="mt-8">
            <a
              href="mailto:hello@eri.dev?subject=Docs%20preview"
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            >
              Request the drafts <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Quick links
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {QUICK_LINKS.map((link) => (
              <div
                key={link.title}
                className="flex h-full flex-col rounded-lg border border-white/10 bg-white/[0.02] p-6 transition hover:border-white/20"
              >
                <h3 className="font-display text-xl tracking-tight text-paper">
                  {link.title}
                </h3>
                <p className="mt-3 flex-1 text-muted leading-relaxed">
                  {link.description}
                </p>
                <p className="mt-5 font-mono text-[11px] uppercase tracking-wider text-paper/40">
                  {link.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="font-display text-3xl tracking-tight">
            Already running eri?
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Every action in the app has an inline help button that links into
            the matching draft. If you can't find the answer there, the{" "}
            <Link
              href="/contact"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              contact page
            </Link>{" "}
            lists the inbox that maps to your question.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
