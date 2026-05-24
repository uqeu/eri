import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "The sidecar — eri Docs",
  description:
    "The eri_coreutils Rust sidecar — what it does, how it talks to the IDE, and the crate layout.",
};

interface Crate {
  readonly name: string;
  readonly purpose: string;
}

const CRATES: ReadonlyArray<Crate> = [
  {
    name: "eri_coreutils",
    purpose:
      "The umbrella crate. Exposes the JSON-RPC surface the IDE talks to and re-exports the focused crates below.",
  },
  {
    name: "eri_inference",
    purpose:
      "Model backends, template registry, streaming token bookkeeping, and the diffusion provider wrap.",
  },
  {
    name: "eri_git",
    purpose:
      "Git operations the IDE needs — status, diff, blame, commit, stash. Wraps libgit2 with eri-specific helpers.",
  },
  {
    name: "eri_index",
    purpose:
      "Workspace index — files, symbols, mention sources. Feeds the @-mention picker and the apply step.",
  },
  {
    name: "eri_mcp",
    purpose:
      "Model Context Protocol client. Registers MCP servers, scopes their tools, and audits invocations.",
  },
];

export default function SidecarDocsPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
            <Link href="/docs" className="text-accent hover:text-paper transition">
              Docs
            </Link>
            <span aria-hidden className="text-paper/30">/</span>
            <span className="text-paper/55">The sidecar</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            The Rust sidecar.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            The IDE is a VSCodium fork. Everything that isn&apos;t the
            editor — model calls, git plumbing, the workspace index, MCP —
            runs in a Rust process called the sidecar. The IDE talks to it
            over a local socket. This is what each crate is for.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Crate layout
          </h2>
          <ul className="mt-8 flex flex-col gap-3">
            {CRATES.map((c) => (
              <li
                key={c.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <h3 className="font-mono text-sm text-accent">{c.name}</h3>
                <p className="mt-3 text-muted leading-relaxed">{c.purpose}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Why a sidecar
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            VSCodium is a TypeScript/Electron environment. eri&apos;s
            performance-sensitive work — large diffs, tokeniser bookkeeping,
            workspace indexing, MCP fan-out — wants memory-managed,
            multi-threaded native code. Splitting the model and tooling
            layer into a Rust process lets each side play to its
            strengths. The IDE stays a thin shell around the editor; the
            sidecar can be upgraded independently and even reused outside
            VSCodium later.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
