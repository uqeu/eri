import * as React from "react";
import { Button, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  buttonStyle,
  headingStyle,
  paragraphStyle,
} from "./_layout";

export type SubscriptionTier = "starter" | "pro" | "pro_plus" | "teams";

export interface SubscriptionConfirmationEmailProps {
  tier: SubscriptionTier;
  manageUrl: string;
  unsubscribeUrl: string;
}

const BENEFITS: Record<SubscriptionTier, ReadonlyArray<string>> = {
  starter: [
    "20M diffusion tokens / month",
    "Voice and gaze sidecars",
    "Priority TTS routing",
  ],
  pro: [
    "30M diffusion tokens / month",
    "Everything in Starter",
    "Long-context handoff to remote planner",
    "Direct email support",
  ],
  pro_plus: [
    "Everything in Pro",
    "5x credit allowance",
    "Frontier model lane (Claude Opus, GPT-5, Gemini Ultra)",
    "Cloud agents that keep running with the app closed",
    "Priority Claude polish queue",
  ],
  teams: [
    "Everything in Pro",
    "Shared team project context and iteration history",
    "Centrally managed rules and skill libraries",
    "Automated security-review agent",
    "SSO via SAML 2.0 / OIDC",
    "Per-seat usage analytics",
    "Centralized billing on one invoice",
  ],
};

const NICE_TIER: Record<SubscriptionTier, string> = {
  starter: "Starter",
  pro: "Pro",
  pro_plus: "Pro+",
  teams: "Teams",
};

export function SubscriptionConfirmationEmail({
  tier,
  manageUrl,
  unsubscribeUrl,
}: SubscriptionConfirmationEmailProps): React.ReactElement {
  const niceTier = NICE_TIER[tier];
  const benefits = BENEFITS[tier];
  return (
    <EmailLayout
      preview={`Thanks for subscribing to eri ${niceTier}.`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section>
        <Text style={headingStyle}>Thanks for subscribing to eri {niceTier}.</Text>
        <Text style={paragraphStyle}>
          Your subscription is active. Here is what is now unlocked:
        </Text>
        {benefits.map((benefit) => (
          <Text key={benefit} style={paragraphStyle}>
            • {benefit}
          </Text>
        ))}
        <Button href={manageUrl} style={buttonStyle}>
          Manage billing
        </Button>
      </Section>
    </EmailLayout>
  );
}

SubscriptionConfirmationEmail.PreviewProps = {
  tier: "pro",
  manageUrl: "https://www.tryeri.ca/billing/portal",
  unsubscribeUrl: "https://www.tryeri.ca/unsubscribe?token=preview",
} satisfies SubscriptionConfirmationEmailProps;

export default SubscriptionConfirmationEmail;
