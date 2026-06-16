# Eri Production Hardening

Date: 2026-06-02

## Product Bar

Eri should feel like an agentic product first and an editor substrate second. The product promise is: describe a software outcome, let Eri plan, edit, preview, verify, checkpoint, and ship, while the user stays in control through reviewable artifacts.

## Benchmarks

- Antigravity: agent manager as the main surface, artifacts as the trust layer, editor/terminal/browser as controlled tools.
- Nia: agentic search that spans internal and external data, with connectors and answer workflows instead of raw search boxes.
- Hermes Agent: memory, skills, gateways, terminal continuity, scheduled automations, and remote/cloud execution.
- Langflow: visual graph builder for agents and workflows, useful for power-user flow editing.
- Dify: production agent platform traits: app templates, deployments, datasets/knowledge, monitoring, access control.
- gcli2api: CLI-to-API adapter pattern; useful as a reminder that Eri should expose stable local/HTTP tool surfaces without leaking backend providers.
- YC agent companies: the recurring pattern is infrastructure, authorization, observability, workflows, and outcome ownership rather than simple chat.

## Non-Negotiables

- Do not expose internal engine, provider, or routing names in product chrome.
- No dead controls. Every button either opens a working surface or is absent.
- First user lands on Agent Manager, not legacy chat.
- Payment-selected sign-up preserves plan intent through account creation.
- Voice and sight are explicit, permissioned, visible states.
- Eri CLI, IDE, web dashboard, and account state should agree on identity, plan, quota, and active workflow.

## Production Checklist

### Website

- First viewport shows Eri as an agentic software builder, not only a voice IDE.
- Pricing CTAs preserve plan intent into sign-up and checkout.
- Sign-up differentiates free no-card start from paid checkout continuation.
- Dashboard has next-step onboarding: download, sign into IDE, run first agent task, create checkpoint.
- Trust pages are honest but should also show concrete controls: keys, retention, local storage, audit logs, permissions.

### Account And Billing

- Stripe checkout and portal flows should be one-click from dashboard.
- Billing webhooks need idempotency and audit logs visible to support.
- Quota/usage pages should match extension status bar labels.
- Failed payment and rate-limit states should recommend Eri local/BYOK paths without internal names.

### IDE Shell

- Agent Manager is the product face.
- Chat is a tool, not the default face.
- Preview, editor, terminal, git, search, debugger, and extensions remain available as expert surfaces.
- Artifacts are the trust layer: plan, changes, preview, review, checkpoint.
- `eri.ide.*` tools are the agent-facing control API.

### Agent Runtime

- Tasks should be represented as durable records with status, artifacts, and replayable actions.
- Memory and skills should be visible and editable from the product.
- Long jobs should be checkpointed and resumable.
- Agent actions should be permissioned by risk: read, edit, command, network, payment, credential.
- Tool results should become artifacts, not disappear into chat transcript.

### CLI

- CLI should mirror IDE verbs: `ask`, `plan`, `edit`, `preview`, `review`, `ship`, `checkpoint`.
- CLI auth should land in the same account/session model as IDE.
- CLI output should be artifact-like: concise summary, changed files, tests, next action.
- CLI can expose local gateway/API mode for integrations without leaking providers.

### Voice And Sight

- Onboarding must test mic and gaze with clear pass/fail states.
- Always show when mic, gaze, screen, or camera capture is active.
- Sight context should be local-first and scoped to the active app/surface unless user explicitly grants more.
- Agent should accept visible targets as context: focused UI element, preview element, terminal block, file range.

## First Implementation Pass

1. Preserve selected website plan from pricing to sign-up to billing checkout.
2. Make IDE onboarding end at Agent Manager.
3. Add regression tests for both flows.
4. Keep Workbench tests enforcing artifact and surface-control structure.

## Second Implementation Pass

1. Add dashboard onboarding checklist with account, download, IDE sign-in, first task, and billing status.
2. Add Agent Manager task state: current intent, artifact statuses, active preview URL, and last checkpoint.
3. Add `eri.ide.*` tool discovery payload for the agent runtime.
4. Add voice/sight permission health cards in Agent Manager.
5. Add CLI artifact output mode for `eri plan` and intent-driven `eri ship`.
6. Keep CLI help and structured completion output free of internal route names.

## Next Implementation Pass

1. Make Agent Manager task records durable across reloads and connect them to real plan/edit/review/checkpoint events.
2. Add Settings Hub permission health cards for mic, camera, screen, preview relay, and terminal targeting.
3. Add `eri review` to the CLI so terminal workflows match IDE review verbs.
4. Add local gateway/API mode for `eri.ide.*` discovery and state snapshots.
5. Add observability artifacts: last tool call, approval decision, check output, and rollback point.

## Third Implementation Pass

1. Added `npx eri-wizard` first-run artifacts for `AGENTS.md`, workflow, onboarding, install, and MCP manifests.
2. Expanded wizard personas and templates around agentic SaaS, internal agents, browser agents, CLI/MCP agents, and Eri workbench extensions.
3. Removed internal engine/provider names and legacy editor-shell names from wizard setup, SDK docs, and CLI docs.
4. Added terminal-agent market brief for Claude Code, Gemini CLI, Antigravity, Lovable, and YC agentic coding patterns.
5. Added regression tests that block internal/provider/competitor names from public wizard/template catalogs.
