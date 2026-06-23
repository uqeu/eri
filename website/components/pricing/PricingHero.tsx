// Pricing hero. No big-number metric template. It opens on the plain claim
// that you pay for what eri does, not for a seat that sits idle.

export function PricingHero(): React.ReactElement {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-32 sm:pt-36">
      <div className="max-w-3xl">
        <h1 className="font-display text-[clamp(2.4rem,6vw,4.4rem)] font-600 leading-[0.98] tracking-[-0.04em] text-text text-balance">
          Pay for what eri does, not for a seat.
        </h1>

        <p className="mt-6 max-w-xl text-pretty font-geist text-[clamp(1.02rem,1.5vw,1.2rem)] leading-[1.55] text-text-sec">
          eri lives in the cloud and works on real tasks, so it costs real
          tokens. Usage is metered, so a quiet month is a cheap month and you
          only pay for the work eri actually runs.
        </p>
      </div>
    </section>
  );
}
