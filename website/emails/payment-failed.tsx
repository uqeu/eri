import * as React from "react";
import { Button, Link, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  buttonStyle,
  headingStyle,
  paragraphStyle,
} from "./_layout";

export interface PaymentFailedEmailProps {
  retryUrl: string;
  manageUrl: string;
  unsubscribeUrl: string;
}

const linkStyle: React.CSSProperties = {
  color: "#E0FF4F",
  textDecoration: "underline",
};

export function PaymentFailedEmail({
  retryUrl,
  manageUrl,
  unsubscribeUrl,
}: PaymentFailedEmailProps): React.ReactElement {
  return (
    <EmailLayout
      preview="We couldn't process your eri payment."
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section>
        <Text style={headingStyle}>We couldn&apos;t process your payment.</Text>
        <Text style={paragraphStyle}>
          Your most recent eri subscription payment failed. This often happens
          because a card expired, was replaced, or hit a temporary block from
          your bank.
        </Text>
        <Text style={paragraphStyle}>
          To keep your subscription active, retry the payment with an updated
          method. Otherwise eri will downgrade to the free tier when the
          current period ends.
        </Text>
        <Button href={retryUrl} style={buttonStyle}>
          Retry payment
        </Button>
        <Text style={paragraphStyle}>
          Or{" "}
          <Link href={manageUrl} style={linkStyle}>
            manage billing
          </Link>{" "}
          to update your payment method.
        </Text>
      </Section>
    </EmailLayout>
  );
}

PaymentFailedEmail.PreviewProps = {
  retryUrl: "https://www.tryeri.ca/billing/portal",
  manageUrl: "https://www.tryeri.ca/billing/portal",
  unsubscribeUrl: "https://www.tryeri.ca/unsubscribe?token=preview",
} satisfies PaymentFailedEmailProps;

export default PaymentFailedEmail;
