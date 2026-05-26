// `/playground` — try eri without installing anything.
//
// Type a prompt, get a streamed answer. We intentionally don't expose
// the full ship pipeline here (no filesystem, no tandem, no apply) —
// the playground is a "feel the brain" surface so visitors decide to
// install. The whole UI talks to `/api/v1/agent/playground` which
// requires no bearer (rate-limited per-IP instead).

import type { Metadata } from "next";
import { Playground } from "./playground-client";

export const metadata: Metadata = {
  title: "eri · playground",
  description:
    "Try eri's brain in your browser — no install, no sign-in. Type a prompt, watch the agent route + stream a response.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PlaygroundPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10 space-y-3">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          eri · playground
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
          Try eri in the browser
        </h1>
        <p className="text-zinc-400">
          Type a prompt below. eri's brain picks a model and streams the
          answer back — no sign-in, no install. To use the full IDE
          (voice, gaze, tandem ship, persistent memory), install eri.app or
          run <code className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-200">curl -fsSL https://tryeri.ca/install | sh</code>.
        </p>
      </header>
      <Playground />
      <footer className="mt-12 border-t border-zinc-800 pt-6 text-sm text-zinc-500">
        Rate-limited at the gateway. Don&apos;t paste secrets — playground
        traffic is logged for abuse review and discarded after 24h.
      </footer>
    </main>
  );
}
