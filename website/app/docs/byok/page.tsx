import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Bring your own keys — eri Docs",
  description:
    "Connect Anthropic, OpenAI, Google, or an OpenAI-compatible endpoint with your own API key.",
};

interface Provider {
  readonly name: string;
  readonly notes: string;
}

const PROVIDERS: ReadonlyArray<Provider> = [
  {
    name: "Anthropic (Claude)",
    notes:
      "Generate a key at console.anthropic.com. Paste it into Settings → Models → Add provider → Anthropic. Claude 4.x models are auto-discovered. Spend limits are set on the Anthropic side; eri does not throttle BYOK calls.",
  },
  {
    name: "OpenAI",
    notes:
      "Generate a key at platform.openai.com. Paste it into Settings → Models → Add provider → OpenAI. GPT-4-class and o-series reasoning models are auto-discovered. The Org ID field is optional.",
  },
  {
    name: "Google AI",
    notes:
      "Generate a key at aistudio.google.com. Paste it into Settings → Models → Add provider → Google. Gemini models are auto-discovered.",
  },
  {
    name: "OpenAI-compatible endpoint",
    notes:
      "Anything that speaks the OpenAI Chat Completions API works — Together, Groq, Fireworks, your own vLLM/Ollama. Settings → Models → Add provider → Custom. Provide the base URL, the key (or a placeholder if none), and an optional model list override.",
  },
  {
    name: "Local (Ollama / llama.cpp)",
    notes:
      "Point eri at http://localhost:11434/v1 (Ollama) or http://localhost:8080/v1 (llama.cpp server). No key required. Latency and capability depend entirely on the local model — small ones run fast but produce weaker diffs.",
  },
];

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "Where keys live",
    body: "BYOK keys are stored in your OS keychain — macOS Keychain on Mac, Windows Credential Manager on Windows, Secret Service (libsecret) on Linux. They are never written to a config file in plaintext, never synced to the operator's cloud, and never included in crash reports.",
  },
  {
    heading: "Selecting a provider per call",
    body: "Each workspace has a default provider, set in Settings → Models. You can override per call in the composer with a slash command like /use openai or /use anthropic. The active provider shows in the composer status line.",
  },
  {
    heading: "Rotating a key",
    body: "Settings → Models → <provider> → Replace key. The old key is overwritten in the keychain immediately. If the new key is invalid, eri keeps the old one and shows a banner; nothing breaks until you confirm.",
  },
  {
    heading: "When BYOK vs the eri proxy",
    body: "Free plan: BYOK only — the eri inference proxy is gated to paid plans. Paid plan: the eri proxy is enabled by default for diffusion edits, BYOK is available for any provider you've connected, and you can mix per call. BYOK calls do not count against your paid-plan allowance.",
  },
];

export default function ByokDocsPage() {
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
            <span className="text-paper/55">BYOK</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Bring your own keys.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Hook up Anthropic, OpenAI, Google, an OpenAI-compatible endpoint,
            or a fully local model. Keys live in your OS keychain — the
            operator does not see them.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Providers
          </h2>
          <ul className="mt-8 flex flex-col gap-3">
            {PROVIDERS.map((p) => (
              <li
                key={p.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <h3 className="font-display text-lg tracking-tight text-paper">
                  {p.name}
                </h3>
                <p className="mt-3 text-muted leading-relaxed">{p.notes}</p>
              </li>
            ))}
          </ul>
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
