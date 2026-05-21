import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { PricingContent } from "./pricing-content";

export const metadata: Metadata = {
  title: "Pricing — eri",
  description:
    "Adaptive, Frontier, or Personalized Eri. Free with your own keys, or $20–$60/mo for cross-session memory, premium eri voice presets, and multi-model routing. Teams and Enterprise also available.",
};

export default function PricingPage() {
  return (
    <main>
      <SiteHeader variant="solid" />
      <PricingContent />
      <Footer />
    </main>
  );
}
