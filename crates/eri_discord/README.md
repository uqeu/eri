# eri_discord

A Discord bot that turns any channel into an eri build surface. Users
`@-mention` the bot (or shout `!eri build me a coffee shop landing page`) and
the bot replies with a deployed Vercel URL within ~10 seconds.

## Quick start

1. Create a Discord application at <https://discord.com/developers/applications>.
2. Add a bot user, copy the **bot token** (Settings → Bot → "Reset token").
3. Enable the **MESSAGE CONTENT** privileged intent (Settings → Bot →
   "Privileged Gateway Intents"). Without this, the bot can't read message
   bodies and `@-mention` triggers will silently no-op.
4. Invite the bot to your server with the scopes `bot` and
   `applications.commands`, granting at minimum: **Read Messages**,
   **Send Messages**, **Add Reactions**, **Use Slash Commands**.
5. Install the [Vercel CLI](https://vercel.com/cli) on the bot host and run
   `vercel login` once so deploys can proceed non-interactively.
6. Run the bot:

   ```sh
   export DISCORD_TOKEN=...
   export MERCURY_API_KEY=...
   cargo run -p eri_discord
   ```

## Required intents

The bot subscribes to the following gateway intents:

- `GUILDS`
- `GUILD_MESSAGES`
- `DIRECT_MESSAGES`
- `MESSAGE_CONTENT` (privileged; toggle in the Discord developer portal)

## Required environment

| Variable          | Required | Purpose                                                                 |
| ----------------- | -------- | ----------------------------------------------------------------------- |
| `DISCORD_TOKEN`   | yes      | Bot token from the Discord developer portal                             |
| `MERCURY_API_KEY` | yes      | Inception Labs API key for Mercury 2 (or set `INCEPTION_API_KEY`)       |
| `ERI_COST_LIMIT_USD` | no    | Global Mercury spend cap shared with the rest of eri (CLI, IDE panel)   |
| `ERI_VERCEL_BIN`  | no       | Override path to the `vercel` CLI; defaults to `vercel` on `$PATH`      |

The same env vars that govern the `eri` CLI and IDE panel govern the bot —
this is by design so a single `.env` works everywhere.

## Required host setup

- `vercel` on `$PATH`, already authenticated (`vercel login`).
- Network access to `api.inceptionlabs.ai` (Mercury) and `api.vercel.com`.
- A writable working directory: the bot stores intermediate HTML under
  `./eri-discord-builds/<message-id>/index.html` before deploying.

## Triggers

Two equivalent forms; both end up running the same Mercury 2 prompt:

```text
@eri build me a coffee shop landing page
!eri build me a coffee shop landing page
```

The bot strips conversational verbs (`build me a`, `make`, `create`) so
the underlying prompt sent to Mercury is `coffee shop landing page`.

## Slash commands

- `/eri build <prompt>` — same flow as the `@-mention`, but with a
  structured prompt field.
- `/eri list-templates` — replies with the bundled template registry.
- `/eri scaffold <template>` — instant scaffold + Vercel deploy from a
  template slug; skips Mercury entirely (zero API cost).

## Concurrency

Concurrent Mercury builds are capped at **4** via a `tokio::sync::Semaphore`.
Additional requests queue at the semaphore rather than spawning unbounded
tasks. This protects the Mercury budget and keeps Vercel's CLI from
fork-bombing the host.

## Cost notes

Every `@-mention` and `/eri build` spends real Mercury 2 tokens. Run the bot
in a controlled server, gate it behind a role, or set a low
`ERI_COST_LIMIT_USD` until you're confident in the surface. `/eri scaffold`
is free (template HTML, no Mercury call) and is the recommended public
entry point for high-traffic servers.
