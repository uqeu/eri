import { Hero } from "@/components/Hero";
import { HeroBig } from "@/components/HeroBig";
import { EriDemo } from "@/components/EriDemo";
import { EngineRoom } from "@/components/EngineRoom";
import { WhyEri } from "@/components/WhyEri";
import { Promises } from "@/components/Promises";
import { Spotlights } from "@/components/Spotlights";
import { ModelMatrix } from "@/components/ModelMatrix";
import { PromptPipeline } from "@/components/PromptPipeline";
import { Compare } from "@/components/Compare";
import { CompareTable } from "@/components/CompareTable";
import { Personas } from "@/components/Personas";
import { PricingTeaser } from "@/components/PricingTeaser";
import { Testimonials } from "@/components/Testimonials";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />
      <EriDemo />
      <EngineRoom />
      <HeroBig />
      <WhyEri />
      <Promises />
      <Spotlights />
      <ModelMatrix />
      <PromptPipeline />
      <Compare />
      <CompareTable />
      <Personas />
      <PricingTeaser />
      <Testimonials />
      <CtaFooter />
      <FooterBig />
    </main>
  );
}
