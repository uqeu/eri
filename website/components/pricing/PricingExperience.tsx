import { PricingHero } from "./PricingHero";
import { PlanCards } from "./PlanCards";
import { MeteredNote } from "./MeteredNote";
import { FeatureMatrix } from "./FeatureMatrix";
import { PricingFaq } from "./PricingFaq";

// The pricing page body, between the shared header and footer. A single light
// surface with deliberate vertical rhythm: hero and cards sit close together so
// the offer lands fast, then the page breathes out into the explainer, the full
// comparison, and the FAQ. (No closing CTA: the plan cards already carry the
// download button, so a second one is redundant.)

export function PricingExperience(): React.ReactElement {
  return (
    <main className="relative isolate">
      {/* soft ambient wash behind the hero, quiet depth, no hard band */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh]"
        style={{
          background:
            "radial-gradient(120% 70% at 50% -10%, rgba(224,255,79,0.07) 0%, rgba(245,245,247,0.7) 40%, transparent 72%)",
        }}
      />

      <PricingHero />

      <div className="mt-14 sm:mt-16">
        <PlanCards />
      </div>

      <div className="mt-28 sm:mt-36">
        <MeteredNote />
      </div>

      <div className="mt-28 sm:mt-36">
        <FeatureMatrix />
      </div>

      <div className="mb-28 mt-28 sm:mb-36 sm:mt-36">
        <PricingFaq />
      </div>
    </main>
  );
}
