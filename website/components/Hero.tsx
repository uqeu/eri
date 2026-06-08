import Link from "next/link";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-32 pb-20 lg:pt-44 lg:pb-28">
        <div className="max-w-3xl">

          <h1
            className="text-h1 text-balance mb-6 leading-[1.02]"
            style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            The local agentic workbench for shipping software.
          </h1>

          <p className="text-text-sec text-[17px] leading-[1.55] max-w-prose mb-9">
            Install Eri locally, run the terminal agent, manage specialized
            agents, and connect MCP, APIs, skills, search, previews, reviews,
            checkpoints, and deploys in one workflow.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/download"
              className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90 transition-opacity"
            >
              Install locally
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[14px] text-text hover:bg-bg-card transition-colors"
            >
              Request access
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
