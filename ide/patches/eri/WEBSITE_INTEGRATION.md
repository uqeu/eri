# Website integration notes — interactive sections agent

This file describes where the five interactive components built by the
"interactive sections" agent should slot into the marketing site. The hero
agent owns `app/page.tsx`, so any wiring across components needs to happen
there (or in a future pass by whoever lands last).

## Components owned by this agent

All under `/Users/khai/Desktop/eri/website/components/`:

- `Spotlights.tsx` — rebuilt as a six-card bento grid (composer, diffusion,
  palette, gaze, agents, telemetry). Replaces the previous alternating
  spotlight layout.
- `HowItWorks.tsx` — rebuilt as a synchronized three-step loop with per-step
  animated glyphs (voice bars, diffusion cells, preview reveal). Runs on a
  shared 9s clock.
- `Compare.tsx` — rebuilt as a two-lane side-by-side timeline (eri vs.
  typing-only editor) with a shared progress track. Complements the existing
  `CompareTable.tsx` (which is a feature-by-feature table).
- `InteractiveLoop.tsx` — NEW. Full-bleed centerpiece. Three-node loop
  diagram (voice → mercury → preview) with an animated packet flowing between
  nodes and a curved return arc. Distinct from `EriDemo.tsx`: that one walks
  one beat; this one shows the loop as a system.
- `ModelMatrix.tsx` — NEW. Bento grid of five frontier models (Mercury 2,
  Opus 4.7, Sonnet 4.6, GPT-5, Gemini 2.5 Pro). Active model rotates on a
  2.4s tick to make the routing feel live; each card has a per-model tagline,
  status pill, default marker.

## Suggested order in `app/page.tsx`

The hero agent's edit will land first. After that, the recommended ordering is:

```tsx
import { Hero } from "@/components/Hero";
import { HeroBig } from "@/components/HeroBig";
import { EriDemo } from "@/components/EriDemo";
import { InteractiveLoop } from "@/components/InteractiveLoop";
import { Spotlights } from "@/components/Spotlights";
import { HowItWorks } from "@/components/HowItWorks";
import { ModelMatrix } from "@/components/ModelMatrix";
import { CompareTable } from "@/components/CompareTable";
import { Compare } from "@/components/Compare";
import { Personas } from "@/components/Personas";
import { PricingTeaser } from "@/components/PricingTeaser";
import { Testimonials } from "@/components/Testimonials";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <EriDemo />
      <HeroBig />
      <InteractiveLoop />     {/* see the loop as a system */}
      <Spotlights />          {/* six bento product cards */}
      <HowItWorks />          {/* speak → diffuse → see */}
      <ModelMatrix />         {/* five-model routing */}
      <Compare />             {/* punchy side-by-side timeline */}
      <CompareTable />        {/* exhaustive table */}
      <Personas />
      <PricingTeaser />
      <Testimonials />
      <CtaFooter />
      <FooterBig />
    </main>
  );
}
```

## Rationale

- `InteractiveLoop` lives right after `HeroBig` because it's a centerpiece that
  reinforces what the hero promised — a *system* picture, not another demo.
- `Spotlights` then unpacks the six surfaces inside that loop.
- `HowItWorks` slows it down to three discrete steps for readers who want the
  beats.
- `ModelMatrix` answers "but which model is running?" right when it's asked.
- `Compare` lands the speed claim viscerally (timeline animation), then
  `CompareTable` backs it up (feature checklist).

## Animation budget

All five components use only CSS keyframes already defined in `tailwind.config.ts`
plus per-component `setInterval` ticks. No new dependencies, no framer-motion.
Three components run ticks at 80-100ms (`EriDemo`, `InteractiveLoop`,
`HowItWorks`, `Compare`); they're cheap, but if the page feels heavy on lower-end
machines, gate them behind `IntersectionObserver` in a follow-up.

## IP / copy

All copy in these five files is original to eri. Adaline.ai was used once,
through WebFetch, only to understand section ordering and bento density. No
adaline copy or DOM was copied. Three other agents own the hero/features/footer
files and they were not touched.
