# ADR-0002: Phone eri transport (Sendblue) + remote computer control via a polled command queue

- Status: Accepted
- Date: 2026-06-14
- Context: [[project_phone_eri]] plan (`/Users/khai/.claude/plans/i-want-that-phone-cached-lagoon.md`)

## Context

iMessage has no official bot API. AI-in-iMessage assistants (Poke/Folk/Lindy) ride on infra
providers that give you a phone number + webhook (managed Mac-mini farms). We also want phone
eri to act on the user's *computer* remotely. Vercel has no native queue/worker.

## Decision

1. **Infra: Sendblue** ($100/mo AI-Agent tier; SOC2/HIPAA; RCS auto-fallback). Behind a
   `lib/imessage/provider.ts` abstraction so Sendblue/Linq/SMS are swappable. **SMS/RCS fallback
   modeled from day one** (`phone_links.last_service`) because Apple can ban iMessage numbers
   without notice (Lindy was banned once; Beeper Mini was killed).
2. **Phone↔user binding** via a separate `phone_links` table (+ `phone_pairings` codes), not a
   `users.phone` column: supports multiple numbers, and unverified numbers never authenticate.
   Webhook acts only on `verified_at IS NOT NULL` links + a verified provider signature.
3. **Remote control via a DB-table command queue** (`command_queue`) the **computer eri polls**
   (it drives the poll, so no Vercel worker needed). The computer runs each goal through the
   EXISTING control stack (`run_control_agent` + `ControlGate` + `action_log` + `HttpBridge`) —
   nothing new in the control loop. Offline computer → row stays `pending` with a TTL.
4. **Remote-confirm safety (crux):** remote mode NEVER auto-confirms. Any
   `ControlAction::is_risky()` (send/quit/purchase/destructive) sets the row to `awaiting_confirm`
   and bounces the prompt to the phone ("eri wants to send X — reply YES"); it executes only on
   confirmation. The `action_log` trust layer (`eri control --history`/`--undo`) is the audit
   trail for everything eri does remotely.

## Consequences

- Phone turns must be bounded (low max_tokens, single-shot) to fit the Vercel function budget;
  heavier work delegates to the computer with a "working on it" + follow-up.
- Webhook needs idempotency (dedup on provider `message_handle`) to survive retries.
- The poll/complete endpoints are powerful → same `eri_sk_*` bearer auth, only ever the caller's
  own `user_id` rows.

### Correction (verified against Sendblue docs, 2026-06-14)

The original plan assumed a Stripe-style **HMAC** of the raw body. Sendblue does **not** do
that — its webhooks carry a **shared secret you configure** (per-webhook `secret` or a
`globalSecret`), echoed back in a request header; you verify by **constant-time comparing** it
to `SENDBLUE_SIGNING_SECRET`, not by recomputing an HMAC. So the inbound route mirrors the
billing webhook's *idempotency + reject-on-bad-auth shape*, but the auth check is a secret
compare, not a signature. Inbound payload fields: `from_number`, `content`, `message_handle`
(dedup key), `is_outbound`, `status` (`RECEIVED`), `date_sent`, `media_url`, `service`. Outbound
sends use `sb-api-key-id` + `sb-api-secret-key` headers to `POST /api/send-message`
(`{from_number, number, content}`) — kept in `SENDBLUE_API_KEY_ID` / `SENDBLUE_API_SECRET`.

## Alternatives rejected

- **Custom Mac-mini bridge** (own the iMessage hardware): infra overhead + 2am Apple-ban debugging
  (Lindy rewrote this 3×). Use managed infra.
- **SMS-only (Twilio)**: safest (no Apple risk) but green-bubble, loses the magic — kept as fallback.
- **Cloud worker/queue service**: unnecessary; the computer polling a DB table fits Vercel's
  constraints and keeps the queue trivially auditable.
