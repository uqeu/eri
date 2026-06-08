import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Troubleshooting — eri Help",
  description:
    "Fixes for the most common issues: sign-in failures, microphone problems, Eri Cloud errors, app reset.",
};

interface Article {
  readonly question: string;
  readonly answer: string;
}

const ARTICLES: ReadonlyArray<Article> = [
  {
    question: "Sign-in keeps failing on the website.",
    answer:
      "Three usual causes: (1) the email exists with a different sign-in method — try Sign in with Google; (2) the password is wrong — use Forgot password; (3) a browser extension or strict tracking-protection setting is blocking the session cookie — try a private/incognito window. If none of those work, email phlotu@gmail.com with the email on the account and the operator will check the logs.",
  },
  {
    question: "The Google sign-in popup closes and nothing happens.",
    answer:
      "Most often a third-party cookie / tracking protection issue. Allow tryeri.ca and accounts.google.com to set cookies, or temporarily disable strict tracking protection, then try again. On Safari, make sure \"Prevent cross-site tracking\" is off for tryeri.ca.",
  },
  {
    question: "Voice / microphone isn't working.",
    answer:
      "Open System Settings → Privacy & Security → Microphone (macOS) and make sure eri is allowed. Restart the app after granting permission. If the wakeword still doesn't trigger, try Settings → Voice → Recalibrate. Bluetooth headsets sometimes drop audio quality below what the local listener needs — switching to the built-in mic is a quick test.",
  },
  {
    question: "Eri Cloud returns no output or an error.",
    answer:
      "Three things to check: (1) your account has quota left; (2) your network can reach tryeri.ca; (3) eri is up to date — Settings → About → Check for updates, or run `eri update check`. If the error persists, paste it into a support email and the operator can help interpret.",
  },
  {
    question: "Edits aren't applying or apply to the wrong file.",
    answer:
      "The most common cause is the editor's active file having changed since you composed the prompt. Re-open the file you intended, re-run the prompt, and review the diff before accepting. If the diff looks right but the apply step fails, check that the file isn't read-only and that it's saved with the line endings eri expects (LF on macOS/Linux, CRLF on Windows).",
  },
  {
    question: "How do I reset the app to defaults?",
    answer:
      "Sign out, then delete the eri config directory: ~/Library/Application Support/eri (macOS), %APPDATA%\\eri (Windows), or ~/.config/eri (Linux). Restart eri. Your local projects are untouched — only eri's settings and cache live there.",
  },
  {
    question: "Where do I find logs to attach to a bug report?",
    answer:
      "Help → Reveal logs in the app menu opens the log directory. Zip the most recent log file and attach it to your email to phlotu@gmail.com, along with the eri build number (Help → About) and a description of what you were doing. The logs are local; nothing is uploaded unless you attach them.",
  },
];

export default function HelpTroubleshootingPage() {
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
            <span className="text-paper/55">Troubleshooting</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            When it doesn&apos;t work.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            The fixes for the things that go wrong most. If you don&apos;t see
            your problem here, email phlotu@gmail.com with a description and
            your build number.
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
