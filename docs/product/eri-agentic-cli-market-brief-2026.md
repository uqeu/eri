# Eri Agentic CLI Market Brief

Date: 2026-06-02

## What The Current Bar Looks Like

- Terminal agents are becoming the durable interface. Claude Code documents a
  terminal-first agent that can start interactively, accept one-off prompts,
  continue/resume sessions, expose slash commands, and connect to MCP servers.
- Gemini CLI documents the same direction from Google: a local terminal agent
  using a reason-act loop, built-in tools such as grep, terminal, file
  read/write, web search/fetch, and local or remote MCP servers.
- Antigravity pushes the higher-level shell: Agent Manager, artifact review,
  hooks around the execution loop, CLI slash commands, skills, plugins,
  subagents, and background tasks.
- Lovable’s Build mode sets the product expectation for non-experts: visible
  tasks, file diffs, verification, browser checks, prompt queues, pause/resume,
  and review before moving on.
- YC agentic coding startups are converging on the same shape: preview/browser
  context, long-horizon task execution, multi-agent planning/review, isolated
  worktrees, custom MCP integrations, security review, and production-ready PRs.

## Implications For Eri

Eri should not present itself as a chat panel or a branded editor fork. It should
be an agentic development workbench with three first-class entrypoints:

- `eri` in the terminal: interactive agent session from any project.
- Eri Agent Manager: artifacts, approvals, preview, terminal, git, review,
  checkpoint, and ship as controllable surfaces.
- `eri-mcp-server`: the same local tools exposed to other clients and automation.

## CLI Contract

The CLI should mirror the IDE verbs:

- `eri`: interactive session.
- `eri ask`: one-off project question.
- `eri plan`: artifact-first plan.
- `eri build`: first working draft.
- `eri iterate`: targeted edit.
- `eri preview`: local preview control.
- `eri review`: risk-ranked review.
- `eri checkpoint`: reversible state marker.
- `eri ship`: deploy, PR, or artifact-backed shipping loop.
- `eri agent`: active persona selection.
- `eri memory`: durable preferences.

Structured modes such as `--output artifact-json` should make the CLI scriptable
without losing the same artifacts users see in the workbench.

## First-Run Contract

`npx eri-wizard` should make any repo agent-ready by writing:

- `.eri/persona`
- `.eri/template`
- `.eri/workflow.json`
- `.eri/onboarding.json`
- `.eri/install.json`
- `.eri/mcp.json`
- `AGENTS.md`

This contract turns the first run into a product moment: Eri knows the active
persona, install paths, workflow loop, permissions, onboarding tasks, and MCP
entrypoint immediately.

## Product Rules

- Keep all public copy Eri-branded. Do not expose internal engine, provider, or
  routing names.
- Every visible control must map to a working action or be removed.
- Artifacts are the trust layer: plan, changes, preview, review, checkpoint,
  ship.
- Preview/browser context must be first-class for UI tasks.
- Voice, gaze, screen, and camera capture must be opt-in and visible while
  active.
- Long-running work needs status, cancellation, resumability, and checkpoints.
- Payment, secrets, destructive shell commands, and network mutation require
  explicit approval.

## Sources Reviewed

- https://docs.anthropic.com/en/docs/claude-code/overview
- https://docs.anthropic.com/en/docs/claude-code/cli-usage
- https://docs.cloud.google.com/gemini/docs/codeassist/gemini-cli
- https://antigravity.google/docs/ide-overview
- https://antigravity.google/docs/artifact-review
- https://antigravity.google/docs/hooks
- https://www.antigravity.google/product/antigravity-cli
- https://docs.lovable.dev/features/agent-mode
- https://www.ycombinator.com/companies/stagewise
- https://www.ycombinator.com/companies/syntropy
- https://www.ycombinator.com/companies/codeant-ai
- https://github.com/uqeu/claude-code
- https://github.com/uqeu/claude-code/blob/main/docs/architecture.md
- https://github.com/uqeu/claude-code/blob/main/docs/tools.md
