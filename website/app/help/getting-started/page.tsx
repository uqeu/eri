import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Getting started — eri Help",
  description: "Install eri, sign in, and run your first AI-assisted edit.",
};

interface Article {
  readonly question: string;
  readonly answer: string;
}

const ARTICLES: ReadonlyArray<Article> = [
  {
    question: "What do I need to run eri?",
    answer:
      "A modern Mac (Apple Silicon recommended) running macOS 13 or later, or a Windows or Linux machine with the eri build available for it. A working microphone is required for voice features. A webcam is required for gaze features. Both can be disabled in Settings → Privacy if you don't want them.",
  },
  {
    question: "How do I install eri?",
    answer:
      "Download the latest build from tryeri.ca/download, open the installer, and drag eri into your Applications folder (macOS) or run the installer (Windows / Linux). The first launch will ask for microphone and accessibility permissions — granting them lets voice and inline editing work; declining still leaves you with a usable IDE.",
  },
  {
    question: "How do I sign in?",
    answer:
      "Open eri and click Sign in. The recommended path is Sign in with Google — it's the fewest steps and doesn't require a password. If you'd rather use an email and password, the sign-up screen has a link for that. Existing accounts can mix and match: signing in with Google on an email-based account will link them.",
  },
  {
    question: "Free vs paid — what do I get?",
    answer:
      "The free tier lets you use eri with your own provider keys (BYOK) — Anthropic, OpenAI, Google, or a local endpoint. The paid tier gives you the eri inference proxy (diffusion-based code generation) and counts your usage against a monthly allowance. Full breakdown lives at /pricing.",
  },
  {
    question: "How do I run my first AI-assisted edit?",
    answer:
      "Open any project folder. Hit ⌘K to bring up the composer. Type or say what you want to change. eri will propose an edit as a diff; review it; accept or reject. Your code never leaves your machine for review — only the prompt and the relevant context are sent to the model.",
  },
  {
    question: "Where do I find the docs?",
    answer:
      "Product docs live at /docs. They're skeletal right now and growing. If you can't find a topic, email phlotu@gmail.com and the operator will either point you at the answer or write the missing page.",
  },
];

export default function GettingStartedPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
            <Link
              href="/help"
              className="text-accent hover:text-paper transition"
            >
              Help
            </Link>
            <span aria-hidden className="text-paper/30">
              /
            </span>
            <span className="text-paper/55">Getting started</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Getting started.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            From zero to first edit. The fastest path is: install, sign in
            with Google, hit ⌘K.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <div className="flex flex-col gap-10">
            {ARTICLES.map((a) => (
              <div key={a.question}>
                <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                  {a.question}
                </h2>
                <p className="mt-3 text-muted leading-relaxed">{a.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
