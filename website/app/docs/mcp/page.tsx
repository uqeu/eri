import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "MCP — eri Docs",
  description:
    "Register Model Context Protocol servers, scope their tools, audit their calls.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "What MCP is",
    body: "Model Context Protocol is an open protocol for letting language models call external tools and read external resources in a structured, auditable way. Servers expose tools and resources; clients (eri, in this case) discover them, surface them in the composer, and route invocations through them. eri's MCP client lives in the sidecar crate eri_mcp.",
  },
  {
    heading: "Registering a server",
    body: "Settings → MCP → Add server. You can register a server by stdio command (a local binary eri spawns) or by URL (an HTTP/SSE endpoint eri connects to). The discovery handshake lists every tool and resource the server exposes; eri populates the composer's slash-command and mention pickers from that list.",
  },
  {
    heading: "Scoping",
    body: "Every tool from every server is opt-in. By default a newly registered server is enabled only for the workspace where you added it, and only its read-only resources are available. To grant a tool the ability to write, run shell commands, or call the network, flip its scope explicitly in Settings → MCP → <server>. The toggles are remembered per workspace.",
  },
  {
    heading: "Auditing",
    body: "Every MCP call eri makes is logged to the workspace-local activity panel: the tool name, the arguments, the response (truncated). You can filter the log to a single server or a single tool. The activity log is local-only; nothing is uploaded.",
  },
  {
    heading: "Authoring a server",
    body: "If you want to build your own MCP server for eri, follow the MCP spec at modelcontextprotocol.io. Anything the spec supports, eri supports — stdio and HTTP/SSE transports, tool definitions, resource discovery, prompt templates. eri does not require any eri-specific extensions.",
  },
];

export default function McpDocsPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
            <Link href="/docs" className="text-accent hover:text-paper transition">
              Docs
            </Link>
            <span aria-hidden className="text-paper/30">/</span>
            <span className="text-paper/55">MCP</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Model Context Protocol.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            How to wire external tools and resources into eri using MCP. The
            short version: every tool is opt-in, every call is logged, and
            you can scope per-workspace.
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
