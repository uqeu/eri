import { Resend } from "resend";
import { render } from "@react-email/components";
import * as React from "react";
import { WelcomeEmail } from "@/emails/welcome";
import { PasswordResetEmail } from "@/emails/password-reset";
import {
  SubscriptionConfirmationEmail,
  type SubscriptionTier,
} from "@/emails/subscription-confirmation";
import { PaymentFailedEmail } from "@/emails/payment-failed";
import { PaymentReceiptEmail } from "@/emails/payment-receipt";
import { UsageThresholdEmail } from "@/emails/usage-threshold";

const FROM = "eri <phlotu@gmail.com>";

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.tryeri.ca";
}

function unsubscribeUrl(email: string): string {
  const u = new URL("/unsubscribe", baseUrl());
  u.searchParams.set("email", email);
  return u.toString();
}

let cachedClient: Resend | null = null;

function client(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (cachedClient) return cachedClient;
  cachedClient = new Resend(apiKey);
  return cachedClient;
}

interface SendArgs {
  to: string;
  subject: string;
  element: React.ReactElement;
  context: string;
}

async function deliver({
  to,
  subject,
  element,
  context,
}: SendArgs): Promise<void> {
  const resend = client();
  if (!resend) {
    let preview = "";
    try {
      preview = await render(element, { plainText: true });
    } catch (error) {
      preview = `<render failed: ${getErrorMessage(error)}>`;
    }
    // Dev fallback: log instead of sending so local flows aren't blocked.
    console.log(
      `[email:${context}] RESEND_API_KEY unset; would send to ${to}\n` +
        `Subject: ${subject}\n${preview}`,
    );
    return;
  }
  try {
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ]);
    const result = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      text,
    });
    if (result.error) {
      console.error(`[email:${context}] resend returned error`, result.error);
    }
  } catch (error) {
    // Never throw — transactional sends must not break the main flow.
    console.error(`[email:${context}] send failed`, error);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unknown error";
}

export async function sendWelcomeEmail(opts: {
  to: string;
  displayName?: string;
}): Promise<void> {
  const downloadUrl = new URL("/download", baseUrl()).toString();
  await deliver({
    to: opts.to,
    subject: "Welcome to eri",
    element: React.createElement(WelcomeEmail, {
      displayName: opts.displayName,
      downloadUrl,
      unsubscribeUrl: unsubscribeUrl(opts.to),
    }),
    context: "welcome",
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  await deliver({
    to: opts.to,
    subject: "Reset your eri password",
    element: React.createElement(PasswordResetEmail, {
      resetUrl: opts.resetUrl,
    }),
    context: "password-reset",
  });
}

const SUBSCRIPTION_TIER_LABEL: Record<SubscriptionTier, string> = {
  starter: "Starter",
  pro: "Pro",
  pro_plus: "Pro+",
  teams: "Teams",
};

export async function sendSubscriptionConfirmationEmail(opts: {
  to: string;
  tier: SubscriptionTier;
  manageUrl: string;
}): Promise<void> {
  const niceTier = SUBSCRIPTION_TIER_LABEL[opts.tier];
  await deliver({
    to: opts.to,
    subject: `Welcome to eri ${niceTier}`,
    element: React.createElement(SubscriptionConfirmationEmail, {
      tier: opts.tier,
      manageUrl: opts.manageUrl,
      unsubscribeUrl: unsubscribeUrl(opts.to),
    }),
    context: "subscription-confirmation",
  });
}

export async function sendPaymentFailedEmail(opts: {
  to: string;
  retryUrl: string;
}): Promise<void> {
  await deliver({
    to: opts.to,
    subject: "Your eri payment failed",
    element: React.createElement(PaymentFailedEmail, {
      retryUrl: opts.retryUrl,
      manageUrl: opts.retryUrl,
      unsubscribeUrl: unsubscribeUrl(opts.to),
    }),
    context: "payment-failed",
  });
}

export async function sendPaymentReceiptEmail(opts: {
  to: string;
  amountUsd: number;
  tier: string;
  periodStart: number;
  periodEnd: number;
  manageUrl: string;
}): Promise<void> {
  // Receipts cannot be unsubscribed — required for transactional records.
  const tierLabel =
    opts.tier === "pro"
      ? "Pro"
      : opts.tier === "starter"
        ? "Starter"
        : opts.tier === "pro_plus"
          ? "Pro+"
          : opts.tier === "teams"
            ? "Teams"
            : opts.tier === "enterprise"
              ? "Enterprise"
              : opts.tier;
  await deliver({
    to: opts.to,
    subject: `Receipt for your eri ${tierLabel} payment`,
    element: React.createElement(PaymentReceiptEmail, {
      amountUsd: opts.amountUsd,
      tier: opts.tier,
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      manageUrl: opts.manageUrl,
    }),
    context: "payment-receipt",
  });
}

export async function sendUsageThresholdEmail(opts: {
  to: string;
  percentage: number;
  upgradeUrl: string;
}): Promise<void> {
  const rounded = Math.max(0, Math.min(100, Math.round(opts.percentage)));
  await deliver({
    to: opts.to,
    subject: `You've used ${rounded}% of this month's eri credits`,
    element: React.createElement(UsageThresholdEmail, {
      percentage: opts.percentage,
      upgradeUrl: opts.upgradeUrl,
      unsubscribeUrl: unsubscribeUrl(opts.to),
    }),
    context: "usage-threshold",
  });
}
