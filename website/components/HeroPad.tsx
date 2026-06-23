import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { HeroStage } from "./home/HeroStage";

// The homepage hero: lead with the real product doing real work. The living
// demo below is the actual eri overlay (the surface that ships in Eri.app)
// driving a desktop hands-free, with the panic-stop and undo in frame the whole
// time — the move no one else in the category shows. Dark, Funnel Display
// headline, lime used once on the primary CTA and inside the product.
export function HeroPad(): React.ReactElement {
  return (
    <section className="relative overflow-hidden bg-bg text-text">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(58% 44% at 82% -8%, rgba(224,255,79,0.10) 0%, transparent 60%)," +
            "radial-gradient(48% 40% at 8% 2%, rgba(255,255,255,0.045) 0%, transparent 60%)",
        }}
      />

      <div className="container relative pt-20 pb-10 lg:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-white/[0.03] px-3 py-1 font-geist-mono text-[12px] text-text-sec">
            <span className="size-1.5 rounded-full bg-accent" />
            one brain, every device
          </span>

          <h1 className="mt-7 font-display text-balance text-[clamp(2.6rem,6.2vw,5rem)] font-600 leading-[0.98] tracking-[-0.035em] text-text">
            the AI operating
            <br className="hidden sm:block" /> system for a person
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-[clamp(1.05rem,1.6vw,1.22rem)] leading-[1.55] text-text-sec">
            eri uses your computer with you, hands-free. It runs your apps,
            reaches 1,000+ of your services, texts you from your pocket, and
            remembers everything, across every device.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/download"
              className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-[15px] font-600 text-[#14180a] transition-transform duration-200 hover:-translate-y-0.5"
            >
              Download eri
              <ArrowRight
                size={16}
                strokeWidth={2.4}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/phone"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-strong)] px-6 py-3 text-[15px] text-text transition-colors duration-200 hover:bg-white/[0.04]"
            >
              or just text it
            </Link>
          </div>

          <p className="mt-5 inline-flex items-center gap-2 font-geist text-[13px] text-text-ter">
            <ShieldCheck size={14} strokeWidth={2} className="text-text-sec" />
            Watches before it acts. Undo anything. Asks before anything risky.
          </p>
        </div>
      </div>

      <div className="container relative pb-20 lg:pb-28">
        <HeroStage />
      </div>
    </section>
  );
}
