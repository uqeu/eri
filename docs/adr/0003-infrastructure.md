# ADR-0003: eri infrastructure — serverless cloud + on-device daemon + hosted connectors, with a cheap always-on worker later

- Status: Accepted
- Date: 2026-06-14
- Context: [[project_phone_eri]]; builds on ADR-0001 (memory) + ADR-0002 (transport/remote control).

## Context

Phone eri must be reachable 24/7 (texts arrive any time), eri must act on the user's
*physical* computer, and — the proactive vision — eri must check the user's connected
services (GitHub, Slack, Gmail) **on its own**, even when the user's laptop is off, so it
can say "I saw you push to GitHub 50 times and you were busy in Slack" without being told.
The question: what has to run where, and what does the operator actually have to provision?

## Decision

eri runs in **three tiers**, deliberately keeping the always-on surface serverless + hosted
so there's almost nothing to babysit:

1. **Cloud brain — serverless (Vercel + Supabase).** The Next.js `/api/v1/*` surface (auth,
   billing, memory, the iMessage webhook, the command queue, crons) runs on **Vercel
   functions** — always-on by nature, no box. State lives in **Supabase Postgres**, which
   **MUST be on a paid tier** (the free tier auto-pauses, which would kill 24/7 phone eri and
   the queue). This tier holds: the command queue, phone links, memory blobs, the Tier-A
   profiles, usage/billing.

2. **On-device eri — the Rust daemon (`eri remote`) on the user's machine.** The only tier
   that needs a machine *on*, and only for tasks that need the *physical* computer (open/run
   apps, edit local files, drive the screen). The user's laptop being awake with `eri remote`
   running covers it; offline → the goal waits (TTL) and eri texts "couldn't reach your
   computer."

3. **Connectors — hosted (Composio).** Composio holds each user's OAuth tokens in its own
   vault and exposes their apps as a remote MCP server. So the **cloud brain can read/act on
   GitHub/Slack/Gmail per user WITHOUT the user's computer being on.** This is the key split:
   *physical-computer work → the Mac; knowing-your-day + connectors + proactive → the cloud.*

4. **Always-on cloud worker — Fly.io, built LATER (not yet).** A small 24/7 service becomes
   worth it only for the **proactive / no-computer-needed** work: executing connector-only
   command-queue goals via Composio while the laptop is off, running memory consolidation
   (episodic→semantic), and ingesting Composio **triggers** ("new GitHub event") into the
   user's memory. Chosen platform: **Fly.io** — infrastructure-as-code (committed
   `fly.toml` + `Dockerfile`), one interactive `fly auth login`, the rest scripted/deployed
   from the dev loop. Railway is the zero-config fallback; a raw DigitalOcean droplet is the
   manual fallback. **RunPod is the wrong tool** — that's GPU pricing; eri runs no models
   locally (Claude does inference), so we never need a GPU box.

## What the operator provisions

- **Now (everything the current build needs):** Supabase **Pro** (done — anti-pause), Vercel
  **Pro** (done — cron frequency + function limits), Sendblue (sandbox now, dedicated line
  later), Composio (have credits). **No VPS.**
- **Later (when the proactive layer ships):** one cheap Fly.io app (~$5–10/mo) running the
  cloud-eri worker. Provisioned mostly from code — the operator runs `fly auth login` once.

## Costs (rough, monthly)

Supabase Pro ~$25 · Vercel Pro ~$20 · Sendblue ~$100 (dedicated line) · Composio = usage
(metered per tool call, counts as COGS) · Fly.io worker ~$5–10 (later). Anthropic tokens are
the real COGS, metered per user against their plan.

## Consequences

- The 24/7 promise is met by serverless + hosted services today — minimal ops.
- Physical-computer remote control depends on the user's machine being awake + `eri remote`.
- The proactive "eri already checked your stuff" magic depends on Composio (connectors) +
  the Fly.io worker (autonomous polling/consolidation/triggers) — both deferred but designed
  for here.
- Composio tool calls + the worker's Claude calls must be metered as COGS (mirrors token
  metering; see review M4 for the remote-compute metering gap to close).

## Alternatives rejected

- **Run everything on a always-on VPS** (move the cloud brain off Vercel): more ops, loses
  serverless scale-to-zero; only the *worker* benefits from a persistent box.
- **GPU host (RunPod) for eri:** unnecessary — inference is Claude's (cloud API), not local.
- **Self-host connector OAuth instead of Composio:** weeks of per-provider OAuth + a token
  vault we'd own; Composio is the managed layer (see the connector assessment).
