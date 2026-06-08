import Link from "next/link";

export function CtaFooter(): React.ReactElement {
  return (
    <section className="border-t border-border bg-bg">
      <div className="container py-24 lg:py-32">
        <div className="max-w-3xl">
          <h2
            className="text-display font-normal leading-[0.98] text-balance text-text"
            style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            Ship from your{" "}
            <span className="text-text-sec">local workbench.</span>
          </h2>

          <p className="text-text-sec text-[17px] leading-[1.55] max-w-prose mt-7">
            Eri brings the terminal agent, Agent Manager, MCP context, GenUI
            artifacts, previews, reviews, checkpoints, and deploys into one
            local-first loop. Bring your own keys or use Eri Cloud.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/download"
              className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90 transition-opacity"
            >
              Install locally
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center text-[14px] text-text-sec hover:text-text transition-colors"
            >
              Request access
              <span className="ml-1.5">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
