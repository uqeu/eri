# Eri Nia-Plus Feature Matrix

Date: 2026-06-02

## Goal

Eri should match the best agentic search/context products while staying an
agentic builder first. Nia's current public surface sets a useful bar:
installable CLI, API, Skill, MCP, universal search, sandbox repo search,
Oracle-style research, context sharing, dataset/document support, autosubscribe,
sync, tracer, pricing credits, and self-hosting.

Eri should have those capabilities and connect them directly to coding actions:
plan, edit, preview, review, checkpoint, and ship.

## Capability Targets

| Capability | Eri Target |
| --- | --- |
| CLI install | `curl -fsSL https://tryeri.ca/install \| sh`, `eri`, `eri auth login`, `npx eri-wizard` |
| Auto update | Signed server manifest, local updater, staged rollout, rollback, release channels |
| Universal search | Code, docs, PDFs, datasets, web, app connectors, local memories |
| Sandbox agentic search | Ephemeral repo clone/search for public repos, no permanent indexing required |
| Oracle research | Multi-step grounded search with citations and hallucination checks |
| Context sharing | Save plans, artifacts, cited sources, summaries; resume in CLI/workbench/cloud |
| Dataset support | Hugging Face, CSV, parquet, JSONL, SQL; schema and row-level search |
| Document agent | PDFs, papers, books, specs, diagrams; page/section citations |
| Autosubscribe | Parse dependency manifests and attach current docs automatically |
| Sync engine | Opt-in local folders, notes, browser history, app data, chat summaries |
| Tracer | Autonomous GitHub/repo search subagent with bounded budget and citations |
| MCP | Local MCP server config, preset installer, tool discovery, tool-call audit |
| API | HTTP/JSON API for search, context, runs, artifacts, billing, updates |
| Skill mode | Lightweight skill file that lets other agents call Eri without a daemon |
| GenUI | Eri component contracts for streamed UI artifacts before app-code generation |
| Self-hosting | Enterprise local index/search/gateway with RBAC, retention, audit logs |
| Builder loop | Search/context feeds directly into plan, edit, preview, review, ship |

## Server/Local Split

Local by default:

- Workspace files, shell, git, preview, checkpoints.
- Local memory, local MCP servers, local audit logs.
- Voice, gaze, screen/camera context unless explicitly sent to cloud.
- Local indexes where possible.

Eri server:

- Account, billing, quota, feature flags.
- Hosted inference and cloud runners.
- Update manifests and signed release metadata.
- Shared context/team indexes when enabled.
- Enterprise policy, retention, and audit aggregation.

## CLI Surface

`eri` should start a console that immediately shows:

- Workspace path.
- Active agent/persona.
- Account state.
- MCP config.
- Setup health.

Slash commands:

- `/tools`: available capabilities.
- `/sources`: source types Eri can index/read.
- `/mcp`: local MCP config and servers.
- `/doctor`: local setup health.
- `/agent list`, `/agent set <name>`.
- `/memory recall|remember|forget`.
- `/plan`, `/ship`, `/ask`.
- `/ui`: generate an Eri GenUI artifact contract.

## Update Architecture

1. Installer writes a stable local binary/app and an updater config.
2. Local updater checks `https://tryeri.ca/api/v1/updates/eri-cli` with current
   version, OS, architecture, channel, and entitlement.
3. Server returns signed manifest: version, URL, SHA-256, signature, rollout
   percentage, release notes, minimum compatible server/API versions.
4. Updater downloads to a staging directory, verifies hash/signature, swaps
   atomically, and keeps the previous version for rollback.
5. Workbench and CLI expose update state in `/doctor`, settings, and status.
6. Enterprise/self-hosted customers can point the update channel at their own
   release server.

## Privacy Rules

- Reading local sources is opt-in by category.
- Camera, mic, screen, browser history, notes, and chat history require visible
  active-state indicators.
- Secrets never enter prompts by default.
- Source citations and audit records are visible to the user.
- Cloud indexing is disabled unless the user or team explicitly enables it.

## Immediate Implementation Slices

1. CLI capability console: `/tools`, `/sources`, `/mcp`, `/doctor`.
2. First-run wizard writes `.eri/workflow.json`, `.eri/mcp.json`, and
   `AGENTS.md`.
3. Eri server release manifest spec and updater CLI command.
4. Local source index manifest: code/docs/PDF/dataset/app connector entries.
5. MCP preset install from CLI, not only workbench.
6. Context artifact store shared by CLI/workbench/cloud runs.
7. GenUI renderer in Agent Manager using the same Eri component contract as
   `eri ui`.

## Sources Reviewed

- https://www.trynia.ai/
- https://docs.trynia.ai/integrations/installation/overview
- https://docs.trynia.ai/context-sharing
- https://docs.trynia.ai/document-agent
- https://docs.trynia.ai/source-types
