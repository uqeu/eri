import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Docs — eri",
  description: "Documentation for the eri voice-first IDE. Coming soon.",
};

interface DocLink {
  readonly href: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
}

const DOC_LINKS: ReadonlyArray<DocLink> = [
  {
    href: "/docs/quickstart",
    title: "Quickstart",
    description:
      "Install, sign in, and run your first AI-assisted edit. Ten-minute path from download to working diff.",
    status: "Draft",
  },
  {
    href: "/docs/ide",
    title: "The IDE",
    description:
      "Layout, panels, the composer, the apply step, keymaps, and how to make eri behave like the editor you already use.",
    status: "Draft",
  },
  {
    href: "/docs/sidecar",
    title: "The Rust sidecar",
    description:
      "How the eri_coreutils sidecar talks to the IDE, what each crate does, and the protocol between them.",
    status: "Draft",
  },
  {
    href: "/docs/mcp",
    title: "MCP integration",
    description:
      "Registering Model Context Protocol servers, scoping their tools, and reviewing what the agent called.",
    status: "Draft",
  },
  {
    href: "/docs/byok",
    title: "Bring your own keys",
    description:
      "Connecting Anthropic, OpenAI, Google, or an OpenAI-compatible endpoint with your own API key.",
    status: "Draft",
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
            Docs.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Working documentation for eri — the IDE, the Rust sidecar, MCP
            integration, BYOK. The pages below are drafts that grow as the
            product does. If a topic isn&apos;t covered yet, email{" "}
            <a
              href="mailto:hello@tryeri.ca"
              className="text-accent underline underline-offset-4"
            >
              hello@tryeri.ca
            </a>{" "}
            and the operator will point you at the answer or write the
            missing page.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Start here
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {DOC_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group flex h-full flex-col rounded-lg border border-white/10 bg-white/[0.02] p-6 transition hover:border-white/20"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-xl tracking-tight text-paper group-hover:text-accent transition">
                    {link.title}
                  </h3>
                  <span
                    aria-hidden
                    className="text-paper/40 group-hover:text-accent transition"
                  >
                    →
                  </span>
                </div>
                <p className="mt-3 flex-1 text-muted leading-relaxed">
                  {link.description}
                </p>
                <p className="mt-5 font-mono text-[11px] uppercase tracking-wider text-paper/40">
                  {link.status}
                </p>
              </Link>
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
