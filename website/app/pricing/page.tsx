import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { PricingContent } from "./pricing-content";

export const metadata: Metadata = {
  title: "Pricing — eri",
  description:
    "Adaptive, Frontier, or Personalized Eri. Free forever (voice included, no keys to bring), or $15–$45/mo for cross-session memory, premium voice presets, and multi-model routing.",
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
