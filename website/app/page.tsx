import { HomeHeader } from "@/components/home/HomeHeader";
import { SmoothScroll } from "@/components/home/SmoothScroll";
import { HeroDigitalHuman } from "@/components/home/HeroDigitalHuman";
import { Manifesto, GrowsWith } from "@/components/home/Thesis";
import { StackPanels } from "@/components/home/StackPanels";
import { Faq } from "@/components/home/Faq";
import { MeshFooter } from "@/components/home/MeshFooter";

// Homepage — Eri Labs, an AGI lab. A scroll journey: the sunset hero states the
// claim ("the world's first digital human, built for you, by you"), then eri's
// mind drifts past as real iridescent bubbles (waabi-style parallax), the
// manifesto defines Engineered Relative Intelligence, "grows with you" is the
// part no one else owns, three full-page beats stack up (computer / phone /
// memory), a short FAQ, and a mesh-gradient footer closes it. Light, scoped via
// `.theme-light`.
export default function HomePage(): React.ReactElement {
  return (
    <div className="theme-light bg-bg text-text">
      <SmoothScroll />
      <HomeHeader />
      <main>
        <HeroDigitalHuman />
        <Manifesto />
        <GrowsWith />
        <StackPanels />
        <Faq />
      </main>
      <MeshFooter />
    </div>
  );
}
