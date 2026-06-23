import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { HomeHeader } from "@/components/home/HomeHeader";
import { MeshFooter } from "@/components/home/MeshFooter";

export const metadata: Metadata = {
  title: "Join us: eri",
  description:
    "Want to work on eri? Email khai@tryeri.ca with your resume and your GitHub or LinkedIn, and tell him why you want to help build it.",
};

const EMAIL = "khai@tryeri.ca";

const STEPS: ReadonlyArray<{ n: string; title: string; body: string }> = [
  {
    n: "1",
    title: "Email khai",
    body: `If you want to work on eri, send a note to ${EMAIL}. A short one is fine.`,
  },
  {
    n: "2",
    title: "Send your resume",
    body: "Attach your resume so he gets the shape of what you've done.",
  },
  {
    n: "3",
    title: "Add your GitHub or LinkedIn",
    body: "Drop a link to your GitHub or LinkedIn so he can see your real work.",
  },
  {
    n: "4",
    title: "Tell him why",
    body: "Say why you want to join and how you'd like to contribute to eri. From there you can chat or message back and forth.",
  },
];

export default function CareersPage(): React.ReactElement {
  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent("I want to help build eri")}`;

  return (
    <div className="theme-light bg-bg text-text">
      <HomeHeader />
      <main className="pt-32">
        <section className="mx-auto max-w-3xl px-6 pb-10 pt-6">
          <h1 className="font-display text-[clamp(2.4rem,6vw,4rem)] font-600 leading-[1.02] tracking-[-0.04em] text-text">
            Come build eri.
          </h1>
          <p className="mt-6 max-w-xl text-pretty font-geist text-[17px] leading-relaxed text-text-sec">
            eri is a small project with a big idea: a digital human that is truly
            yours. If you want to help build it, there is a short way in. No
            forms, no portal, just an email to the person making it.
          </p>

          <a
            href={mailto}
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-[#16140f] px-6 py-3.5 font-geist text-[15px] font-600 text-white outline-none transition-transform duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#16140f]/30 focus-visible:ring-offset-2"
          >
            Email {EMAIL}
            <ArrowRight
              size={16}
              strokeWidth={2.4}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </a>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-28 sm:pb-36">
          <div className="mt-6 divide-y divide-border border-y border-border">
            {STEPS.map((s) => (
              <div key={s.n} className="flex items-start gap-5 py-6">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-geist-mono text-[13px] text-text-ter">
                  {s.n}
                </span>
                <div>
                  <h2 className="font-geist text-[16px] font-600 text-text">{s.title}</h2>
                  <p className="mt-1.5 max-w-prose font-geist text-[14.5px] leading-relaxed text-text-sec">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <MeshFooter />
    </div>
  );
}
