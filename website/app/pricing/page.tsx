import type { Metadata } from "next";
import { PricingContent } from "./pricing-content";

export const metadata: Metadata = {
  title: "Pricing — eri",
  description:
    "Free during alpha — invite-only. Paid tiers when we open up: personalized eri that remembers how you build, cross-session.",
};

export default function PricingPage() {
  return <PricingContent />;
}
