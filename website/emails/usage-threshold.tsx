import * as React from "react";
import { Button, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  buttonStyle,
  headingStyle,
  paragraphStyle,
} from "./_layout";

export interface UsageThresholdEmailProps {
  percentage: number;
  upgradeUrl: string;
  unsubscribeUrl: string;
}

export function UsageThresholdEmail({
  percentage,
  upgradeUrl,
  unsubscribeUrl,
}: UsageThresholdEmailProps): React.ReactElement {
  const rounded = Math.max(0, Math.min(100, Math.round(percentage)));
  return (
    <EmailLayout
      preview={`You've used ${rounded}% of this month's eri credits.`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section>
        <Text style={headingStyle}>
          You&apos;ve used {rounded}% of this month&apos;s credits
        </Text>
        <Text style={paragraphStyle}>
          Heads up — you are approaching your monthly diffusion-token limit.
          When you hit 100%, eri will throttle remote planner calls until your
          credits reset.
        </Text>
        <Text style={paragraphStyle}>
          Upgrading takes about thirty seconds and gives you more headroom for
          the rest of this billing cycle.
        </Text>
        <Button href={upgradeUrl} style={buttonStyle}>
          Upgrade plan
        </Button>
      </Section>
    </EmailLayout>
  );
}

UsageThresholdEmail.PreviewProps = {
  percentage: 82,
  upgradeUrl: "https://eri.dev/billing",
  unsubscribeUrl: "https://eri.dev/unsubscribe?token=preview",
} satisfies UsageThresholdEmailProps;

export default UsageThresholdEmail;
