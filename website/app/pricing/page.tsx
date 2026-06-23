import type { Metadata } from "next";
import { HomeHeader } from "@/components/home/HomeHeader";
import { MeshFooter } from "@/components/home/MeshFooter";
import { PricingExperience } from "@/components/pricing/PricingExperience";

export const metadata: Metadata = {
  title: "Pricing: eri",
  description:
    "Four plans: Free, Starter, Pro and Pro+. Usage is metered on top, so you pay for what eri does, not for a seat.",
};

// Pricing: same light world as the homepage, wrapped in `.theme-light` with the
// shared floating header and mesh footer. The body lives in PricingExperience.
export default function PricingPage(): React.ReactElement {
  return (
    <div className="theme-light bg-bg text-text">
      <HomeHeader />
      <PricingExperience />
      <MeshFooter />
    </div>
  );
}
