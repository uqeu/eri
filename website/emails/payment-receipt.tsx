import * as React from "react";
import { Button, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  buttonStyle,
  headingStyle,
  paragraphStyle,
} from "./_layout";

export interface PaymentReceiptEmailProps {
  amountUsd: number;
  tier: string;
  periodStart: number;
  periodEnd: number;
  manageUrl: string;
}

const rowStyle: React.CSSProperties = {
  color: "#F5F2EC",
  fontSize: 14,
  lineHeight: "22px",
  margin: 0,
};

const labelStyle: React.CSSProperties = {
  color: "#8A8780",
  display: "inline-block",
  width: 96,
};

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatPeriod(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PaymentReceiptEmail({
  amountUsd,
  tier,
  periodStart,
  periodEnd,
  manageUrl,
}: PaymentReceiptEmailProps): React.ReactElement {
  const niceTier =
    tier === "pro" ? "Pro" : tier === "starter" ? "Starter" : tier;
  return (
    <EmailLayout
      preview={`Receipt for your eri ${niceTier} payment of ${formatUsd(amountUsd)}.`}
    >
      <Section>
        <Text style={headingStyle}>Payment received</Text>
        <Text style={paragraphStyle}>
          Thanks for your payment. Your eri {niceTier} subscription is renewed
          for the period below.
        </Text>
        <Text style={rowStyle}>
          <span style={labelStyle}>Amount</span>
          <b>{formatUsd(amountUsd)}</b>
        </Text>
        <Text style={rowStyle}>
          <span style={labelStyle}>Plan</span>
          eri {niceTier}
        </Text>
        <Text style={rowStyle}>
          <span style={labelStyle}>Period</span>
          {formatPeriod(periodStart)} — {formatPeriod(periodEnd)}
        </Text>
        <Section style={{ marginTop: 24 }}>
          <Button href={manageUrl} style={buttonStyle}>
            Manage billing
          </Button>
        </Section>
        <Text style={{ ...paragraphStyle, marginTop: 24 }}>
          Keep this email for your records.
        </Text>
      </Section>
    </EmailLayout>
  );
}

PaymentReceiptEmail.PreviewProps = {
  amountUsd: 20,
  tier: "pro",
  periodStart: Math.floor(Date.now() / 1000),
  periodEnd: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  manageUrl: "https://www.tryeri.ca/billing/portal",
} satisfies PaymentReceiptEmailProps;

export default PaymentReceiptEmail;
