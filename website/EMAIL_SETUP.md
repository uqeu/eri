# Email setup

eri's transactional email stack is **Resend + React Email**. Templates are
plain React components under `emails/`, render helpers live in `lib/email.ts`,
and the API routes call those helpers fire-and-forget.

## 1. Get a Resend API key

1. Sign up at <https://resend.com>.
2. Open <https://resend.com/api-keys> and create a key with `Send` scope.
3. Set it in your environment:

   ```bash
   export RESEND_API_KEY="re_xxxxxxxxxxxxx"
   ```

   Vercel/host equivalent: add `RESEND_API_KEY` to project env. Also set
   `NEXT_PUBLIC_BASE_URL` (e.g. `https://eri.dev`) so links resolve correctly.

If `RESEND_API_KEY` is **unset**, every send helper logs the rendered email
to the console and returns successfully — local flows keep working without a
Resend account.

## 2. DNS for `eri.dev`

Resend will generate the exact records for your domain in
<https://resend.com/domains>. The shape is always the same; add these to your
DNS provider:

| Type | Host                              | Value                                                     |
| ---- | --------------------------------- | --------------------------------------------------------- |
| MX   | `send.eri.dev`                    | `feedback-smtp.<region>.amazonses.com` (priority 10)      |
| TXT  | `send.eri.dev`                    | `v=spf1 include:amazonses.com ~all`                       |
| TXT  | `resend._domainkey.eri.dev`       | DKIM public key (Resend will display the exact value)     |
| TXT  | `_dmarc.eri.dev`                  | `v=DMARC1; p=none; rua=mailto:dmarc@eri.dev`              |

After adding the records, hit **Verify** in the Resend dashboard. Verification
typically completes in under five minutes.

**Sending domain:** the helpers send from `eri <noreply@eri.dev>`. Change this
in `lib/email.ts` (`FROM` constant) if you ever move domains.

## 3. Local development (no Resend account needed)

```bash
unset RESEND_API_KEY
pnpm dev   # or: npm run dev
```

Trigger any flow that sends — signup, password reset, etc. — and the rendered
email is dumped to your dev server log:

```
[email:welcome] RESEND_API_KEY unset; would send to user@example.com
Subject: Welcome to eri
Welcome, Khai.

eri is a voice-first diffusion IDE...
```

This is the "log-only" branch in `lib/email.ts::deliver`. It uses React Email's
`render(..., { plainText: true })` to give you readable output without firing
the SDK.

## 4. Previewing a single template

React Email ships a local preview server. From `website/`:

```bash
npx react-email preview emails/welcome.tsx
```

That spins up <http://localhost:3000> (or the next free port) showing the
welcome email with the `PreviewProps` from the file. Repeat for any of:

- `emails/welcome.tsx`
- `emails/password-reset.tsx`
- `emails/subscription-confirmation.tsx`
- `emails/payment-failed.tsx`
- `emails/payment-receipt.tsx`
- `emails/usage-threshold.tsx`

Each template exports a `PreviewProps` object so the preview server has data
to render with.

## 5. Which routes send which email

| Trigger                                    | Helper                              | Template                          |
| ------------------------------------------ | ----------------------------------- | --------------------------------- |
| `POST /api/auth/signup`                    | `sendWelcomeEmail`                  | `welcome.tsx`                     |
| `POST /api/auth/password-reset`            | `sendPasswordResetEmail`            | `password-reset.tsx`              |
| Stripe `customer.subscription.created`     | `sendSubscriptionConfirmationEmail` | `subscription-confirmation.tsx`   |
| Stripe `invoice.payment_succeeded`         | `sendPaymentReceiptEmail`           | `payment-receipt.tsx`             |
| Stripe `invoice.payment_failed`            | `sendPaymentFailedEmail`            | `payment-failed.tsx`              |
| `POST /api/usage/ping` crossing 80% / mo.  | `sendUsageThresholdEmail`           | `usage-threshold.tsx`             |

The usage-threshold send is **debounced** with `users.last_threshold_email_at`
— at most one per 7-day window per user. Payment receipts intentionally have
no unsubscribe link (transactional records must remain reachable).

## 6. Failure mode

Every helper catches its own errors. A Resend outage will log to stderr and
the API request will still succeed — sending email is never on the critical
path of signup, password reset, billing webhooks, or usage pings.
