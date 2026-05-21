# eri_slack

A Slack bot that turns any channel into an eri build surface. Users
`@-mention` the bot (or run `/eri build me a coffee shop landing page`) and the
bot replies in-thread with a deployed Vercel URL within ~10 seconds.

The bot connects to Slack via **Socket Mode** — no public URL or ngrok tunnel
is needed. As long as the host can reach `slack.com`, `api.inceptionlabs.ai`,
and `api.vercel.com`, it works.

## Slack app setup

1. Open <https://api.slack.com/apps> → **Create New App** → **From scratch**.
   Pick a name (e.g. `eri`) and your workspace.

2. **Socket Mode** → toggle **Enable Socket Mode** on. When prompted, generate
   an **app-level token** with the `connections:write` scope. Save the value
   that starts with `xapp-...` — this is your `SLACK_APP_TOKEN`.

3. **OAuth & Permissions** → under **Bot Token Scopes**, add:
   - `app_mentions:read`
   - `chat:write`
   - `commands`
   - `reactions:write`

   Then **Install to Workspace**. After install, copy the **Bot User OAuth
   Token** (starts with `xoxb-...`) — this is your `SLACK_BOT_TOKEN`.

4. **Event Subscriptions** → toggle **Enable Events** on. Under **Subscribe to
   bot events**, add `app_mention`. (Socket Mode delivers these — no Request
   URL is needed.)

5. **Slash Commands** → **Create New Command**:
   - Command: `/eri`
   - Short description: `Build a webpage with eri`
   - Usage hint: `build <prompt> | list-templates | scaffold <template>`

6. Install the [Vercel CLI](https://vercel.com/cli) on the bot host and run
   `vercel login` once so deploys can proceed non-interactively.

7. Run the bot:

   ```sh
   export SLACK_APP_TOKEN=xapp-...
   export SLACK_BOT_TOKEN=xoxb-...
   export MERCURY_API_KEY=...
   cargo run -p eri_slack
   ```

## Required environment

| Variable             | Required | Purpose                                                                 |
| -------------------- | -------- | ----------------------------------------------------------------------- |
| `SLACK_APP_TOKEN`    | yes      | App-level token from Slack (starts with `xapp-`)                        |
| `SLACK_BOT_TOKEN`    | yes      | Bot user OAuth token (starts with `xoxb-`)                              |
| `MERCURY_API_KEY`    | yes      | Inception Labs API key for Mercury 2 (or set `INCEPTION_API_KEY`)       |
| `ERI_COST_LIMIT_USD` | no       | Global Mercury spend cap shared with the rest of eri (CLI, IDE panel)   |
| `ERI_VERCEL_BIN`     | no       | Override path to the `vercel` CLI; defaults to `vercel` on `$PATH`      |

The same env vars that govern the `eri` CLI, IDE panel, and Discord bot govern
this bot — a single `.env` works everywhere.

## Required host setup

- `vercel` on `$PATH`, already authenticated (`vercel login`).
- Network access to `slack.com`, `api.inceptionlabs.ai`, and `api.vercel.com`.
- A writable working directory: the bot stores intermediate HTML under
  `./eri-slack-builds/req-<event-ts>/index.html` before deploying.

## Triggers

Mention the bot in any channel it's been invited to:

```text
@eri build me a coffee shop landing page
```

The bot strips conversational verbs (`build me a`, `make`, `create`) so the
underlying prompt sent to Mercury is `coffee shop landing page`.

## Slash commands

- `/eri build <prompt>` — same flow as the `@-mention`, but with a structured
  prompt field.
- `/eri list-templates` — replies with the bundled template registry.
- `/eri scaffold <template>` — instant scaffold + Vercel deploy from a template
  slug; skips Mercury entirely (zero API cost).

## Concurrency

Concurrent Mercury builds are capped at **4** via a `tokio::sync::Semaphore`.
Additional requests queue at the semaphore rather than spawning unbounded
tasks. This protects the Mercury budget and keeps Vercel's CLI from
fork-bombing the host.

## Cost notes

Every `@-mention` and `/eri build` spends real Mercury 2 tokens. Run the bot
in a controlled workspace, gate it behind a private channel, or set a low
`ERI_COST_LIMIT_USD` until you're confident in the surface. `/eri scaffold`
is free (template HTML, no Mercury call) and is the recommended public entry
point for high-traffic workspaces.
