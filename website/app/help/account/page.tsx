import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Account — eri Help",
  description: "Sign-in, OAuth, password, and account deletion in eri.",
};

interface Article {
  readonly question: string;
  readonly answer: string;
}

const ARTICLES: ReadonlyArray<Article> = [
  {
    question: "How do I switch to Sign in with Google?",
    answer:
      "On the sign-in screen, click Sign in with Google. If your Google email matches an existing eri account, the two get linked automatically. From that point you can use either method to sign in. If you'd like to remove the email-and-password sign-in option after linking, head to dashboard → Account → Connected accounts.",
  },
  {
    question: "I forgot my password.",
    answer:
      "On the sign-in page, click Forgot password. Enter the email on your account; the operator will send a reset link that expires in one hour. If the email never arrives, check spam first, then email phlotu@gmail.com with the email address on the account.",
  },
  {
    question: "How do I change my email?",
    answer:
      "Dashboard → Account → Email. Enter the new email; a confirmation link is sent to the new address. The change takes effect once you confirm. Billing receipts move with the email.",
  },
  {
    question: "How do I delete my account?",
    answer:
      "Dashboard → Account → Delete account. The action is final: your account record, usage counters, and any cached data are removed within 30 days. Stripe billing records are retained for the period Canadian tax law requires (six years). If you can't sign in to do this yourself, email phlotu@gmail.com and the operator will delete the account for you.",
  },
  {
    question: "How do I export my data?",
    answer:
      "Dashboard → Account → Export data. The operator will email you a JSON file with everything the cloud side holds on your account: profile, subscription state, usage counters. It does not include prompts or code because those are never stored on the cloud side.",
  },
  {
    question: "Can I share my account with a teammate?",
    answer:
      "No — one human per account. A team feature with seats is on the roadmap. In the meantime, each teammate signs up separately, which also means each one keeps their own settings and history.",
  },
];

export default function HelpAccountPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

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
            <span className="text-paper/55">Account</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Your account.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Sign-in methods, password, OAuth linking, deletion, and export.
            Most of this lives behind dashboard → Account.
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
