# Competitive Synthesis — May 2026

> Synthesizes 10 briefs: seven competitor categories (`01_windsurf` → `07_enterprise_plays`) plus three Cursor deep-dives (`/research/cursor/01–03`). The goal is to define where eri wins, where the category is converging, and which three things matter most this quarter.

---

## 1. The Landscape — One Giant Table

Legend: ✓ = ships and is a marketed surface · ◐ = partial / limited / preview · ✗ = absent · — = not applicable.

| Tool | In-house model | Local index | Local Tab | Local Apply | Voice | Gaze | Multi-file edit format | BYOK respects agent | MCP | Rules / skills | Checkpoint | Diff UI per-block | Onboarding walkthrough | On-prem / VPC | JetBrains 1st-party | Free tier | Enterprise SSO+SCIM | Pricing model |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Cursor** | Composer 2.5, Tab/Fusion, Fast Apply | ✗ (Turbopuffer cloud) | ✗ | ✗ | ✗ | ✗ | Search-replace via Fast Apply + multi-file diff | ✗ (Composer locked) | ✓ marketplace | `.cursor/rules/*.mdc` 4-mode | ✓ | ✓ | ✓ Cursor 3 | ✗ | ✗ (ACP plugin Mar 2026) | ◐ capped | ✓ Teams/Ent | Credit pool + overage [cursor: 03] |
| **Windsurf** | SWE-1.5/1.6 (Cerebras) | ✗ cloud | ✗ | ✗ | ◐ voice prompt | ✗ | Cascade multi-file + Supercomplete | ✓ Pro BYOK runs Cascade | ✓ 100-tool cap | `.windsurf/`, Workflows, Memories | ✓ | ✓ | ✓ | ✓ FedRAMP via Palantir | ◐ plugin | ✓ | ✓ | Quota + ACUs [brief: 01_windsurf] |
| **Copilot** | NES (completion only) | ✗ | ✗ | ✗ | ✗ | ✗ | Edits + Agent Mode | ✗ | ✓ + 1st-party GH MCP | `copilot-instructions.md`, Skills | ✗ no shadow git | ◐ | ◐ | ✗ | ✓ JetBrains, VS, Xcode, Vim, Eclipse | ✓ 50 chat | ✓ | $10/$39 credits June 1 [brief: 02_github_copilot] |
| **Cline** | ✗ | ◐ | ✗ inline | ✗ | ✗ | ✗ | Whole-file rewrites (token-heavy) | ✓ 30+ providers | ✓ marketplace | `.clinerules/`, multi-agent | ✓ shadow Git | ✓ approval gates | ✗ | ✓ via BYOK | ✓ | ✓ OSS | ✓ Enterprise | $0 OSS + Enterprise [brief: 03_open_source] |
| **Continue.dev** | ✗ | ✓ local | ✓ via Ollama | ✗ | ✗ | ✗ | Edit + agent | ✓ Hub proxy | ✓ SSE + Streamable HTTP | `.continue/checks/rules/agents/` | ✗ | ◐ | ✗ | ✓ Hub proxy | ✓ + Vim + VS Code | ✓ Solo | ✓ Company | $0 / $20 Team [brief: 03_open_source] |
| **Roo Code** | — (shutdown May 15, 2026) | — | — | — | — | — | Diff-based | ✓ | ✓ | 5-mode + Mode Gallery | ✓ | ✓ | — | — | — | — | — | DEFUNCT [brief: 03_open_source] |
| **Zoo Code (fork)** | ✗ | ◐ | ✗ | ✗ | ✗ | ✗ | Diff-based | ✓ | ✓ | `.zoo/` 5-mode | ✓ | ✓ | ✗ | ✓ via BYOK | ✗ | ✓ OSS | ✗ | Donation [brief: 03_open_source] |
| **Aider** | ✗ | ✓ repo-map | — CLI | ✓ SEARCH/REPLACE cascade | ✗ | ✗ | SEARCH/REPLACE, udiff, whole, patch | ✓ any model | ✗ | `.aider.conf.yml` | ✓ git commits | text only | ✗ | ✓ trivially | — CLI | ✓ free | ✗ | $0 OSS [brief: 04_cli_coders] |
| **Claude Code** | — uses Claude | ✗ | — CLI | ◐ Edit tool exact match | ✗ | ✗ | Edit tool (`old_string`/`new_string`) | ◐ via Anthropic key | ✓ 3000+ | Skills + Hooks + `CLAUDE.md` | ✗ | text only | ◐ TUI | ✓ via subscription | — CLI | ✓ via Pro | ✓ via Claude Team | Bundled w/ $17–$200 Claude plan [brief: 04_cli_coders] |
| **Codex CLI** | — uses GPT-5.5 | ✗ | — CLI | ◐ structured patches | ✗ | ✗ | OpenAI Patch format | ◐ via OpenAI key | ✓ | AGENTS.md | ✓ via sandbox | text only | ◐ TUI | ◐ sandbox per-process | — CLI | ✓ via Go $8 | ✓ | Bundled w/ $8–$200 OpenAI plan [brief: 04_cli_coders] |
| **Replit Agent** | — | — server | ✗ | — | ✗ | ✗ | File-edit + container restart | ✗ | ✗ | Agent rules | ✓ checkpoints (paid) | ✗ | ✓ | ✗ | ✗ | ◐ daily | ✓ Teams | $20/$100 + $0.25/checkpoint [brief: 05_vibe_coding] |
| **Lovable** | — | — | ✗ | — | ✗ | ✗ | Whole-file rewrites | ✗ | ✗ | minimal | ✗ | ✗ | ✓ chat-only | ✗ | ✗ | ✓ 5/day | ✓ Business | $25 + credits [brief: 05_vibe_coding] |
| **v0** | — | — | ✗ | — | ✗ | ✗ | RSC streaming + Git (Feb 2026) | ✗ | ✗ | minimal | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ $5 credits | ✓ Business | $20–$100 token [brief: 05_vibe_coding] |
| **Bolt.new** | — | WebContainer | ✗ | — | ✗ | ✗ | Whole-file in browser | ✗ | ✗ | minimal | ✗ | ✓ in editor | ✓ | ✗ | ✗ | ✓ limited | ◐ | $20 token-based [brief: 05_vibe_coding] |
| **Zed** | Zeta2 (open weights), Mercury Coder provider | ✓ via Ollama | ✓ Zeta2 local | ✗ | ◐ multiplayer voice | ✗ | Agent Panel multi-file | ✓ list+10% | ✓ | `.rules` | ✓ | ✓ GPU diff | ◐ | ✗ | ✗ | ✓ Personal | ✓ Business | $10/$30 list+10% [brief: 06_ide_makers] |
| **JetBrains AI+Junie** | Mellum 4B (open) | ✓ | ✓ Mellum local | ✗ | ✗ | ✗ | Junie + refactor-as-tool | ✓ | ✓ | rules/prompts | ✓ | ✓ | ✓ | ✗ | ✓ (is JetBrains) | ✓ unlim local | ✓ | $8–$30 + credits [brief: 06_ide_makers] |
| **JetBrains Air** | — orchestrates Codex/Claude/Gemini/Junie | ✓ | ✗ | ✗ | ✗ | ✗ | Per-agent worktree | ✓ | ✓ | per-agent | ✓ worktree | ✓ | ◐ preview | ✗ | — | ✓ preview | ✓ | preview, unpriced [brief: 06_ide_makers] |
| **Tabnine** | Tabnine Protected (own) | ✓ | ✓ on-prem | ✗ | ✗ | ✗ | Inline + agent | ✓ switchboard | ✓ agentic tier | rules | ✗ | ◐ | ◐ | ✓ VPC + air-gapped | ✓ | ✗ paid only | ✓ | $39/$59 + license [brief: 07_enterprise] |
| **Amazon Q Dev** | — | — | ✗ | — | ✗ | ✗ | Inline + agent | ✗ Bedrock only | ◐ AWS | rules | ✗ | ◐ | ✓ | ◐ via AWS | ✓ + VS + CLI + console | ✓ 50/mo | ✓ via IAM IC | $19/seat [brief: 07_enterprise] |
| **Augment Code** | — | ✓ context-engine 500k files | ✗ | ✗ | ✗ | ✗ | Cross-repo edits | ✓ | ✓ | rules | ✓ | ✓ | ✓ | ✓ | ✓ JetBrains | ✓ Community | ✓ Standard team | Credit-based $20–$200 [brief: 07_enterprise] |
| **Sourcegraph Amp / Cody Enterprise** | — | ✓ code graph | ✗ | ✗ | ✗ | ✗ | Multi-repo agent | ✓ | ✓ | rules | ✗ | ◐ | ✓ | ✓ self-hosted | ✓ | ✓ Amp free | ✓ | $59/seat list [brief: 07_enterprise] |
| **eri (current)** | — uses paid diffusion-class API for plan/edit | ✓ Ollama nomic-embed-text | ◐ llama.cpp FFI in flight | ✓ deterministic SEARCH/REPLACE cascade, no ML | ✓ Whisper local sidecar | ✓ MediaPipe local sidecar | search-replace blocks + per-block accept | ✓ OS Keychain, agent unaffected | ✓ async stdio + Streamable HTTP | `.eri/skills/` in flight, rules engine live | ✓ checkpoint timeline UI | ✓ per-block | ✓ 6-step | ◐ architectural-ready | ✗ | ◐ TBD | ◐ TBD | TBD: flat with BYOK respect |

Single most important row delta vs every competitor: **eri is the only product with `✓` on Voice, `✓` on Gaze, `✓` on local Apply, `✓` on local index, and `✓` on agent-respecting BYOK simultaneously**. Every competitor has at most three of those.

---

## 2. Dominant Strategies — One Sentence Each

- **Cursor** — out-polish the IDE, train an in-house model (Composer 2.5) to repair gross margin, and dominate the heavy-IC dollar via $20→effective-$40 credit-pool economics [cursor: 01, 03].
- **Copilot** — let Microsoft's distribution and a $10/seat floor commodify the category, then pivot to a multi-agent "Agent HQ" marketplace inside the GitHub forge [brief: 02_github_copilot].
- **Windsurf** — sell the regulated-industry stack (FedRAMP/HIPAA/ITAR) and rebrand around Devin so every Windsurf seat upsells to autonomous cloud engineers [brief: 01_windsurf].
- **Cline** — give away the most aggressive autonomous agent on GitHub, monetize Enterprise SSO + audit, and ride the BYOK refugee wave [brief: 03_open_source].
- **Continue.dev** — be the cleanest BYOK escape hatch with a `.continue/checks/` CI pivot that turns the IDE assistant into a code-review pipeline [brief: 03_open_source].
- **Roo Code (dead) → Zoo Code** — diff-based edits and 5-mode discipline; original maintainer concluded IDEs are dead and pivoted to Slack-bot agent Roomote [brief: 03_open_source].
- **Aider** — be the reference open-source CLI; let everyone copy the SEARCH/REPLACE format and the benchmark leaderboard [brief: 04_cli_coders].
- **Claude Code** — make the harness a free side-effect of any Anthropic subscription, ship Skills + Hooks + Subagents as a stable Unix-shaped agent runtime [brief: 04_cli_coders].
- **Codex CLI** — open-source Rust binary with OS-level sandboxing (Seatbelt/Landlock) bundled into every $8–$200 ChatGPT plan [brief: 04_cli_coders].
- **Replit Agent** — own the whole stack vertically: container, DB, auth, hosting, custom domain, $0.25/checkpoint [brief: 05_vibe_coding].
- **Lovable** — the cleanest non-developer chat-to-deployed-app UX in the category; $200M ARR within twelve months [brief: 05_vibe_coding].
- **v0** — generative UI via streamed RSC inside the Vercel walled garden; cleanest output code in the category [brief: 05_vibe_coding].
- **Bolt.new** — WebContainer transparency + Netlify deploy + bolt.diy as the OSS flank [brief: 05_vibe_coding].
- **Zed** — GPU-rendered editor, open-weight Zeta2, Mercury Coder pluggable, list-price+10% transparency [brief: 06_ide_makers].
- **JetBrains AI+Junie** — one subscription across the whole IDE family, refactor-as-tool, Mellum open-weight focus model [brief: 06_ide_makers].
- **JetBrains Air** — orchestrate Codex/Claude/Gemini/Junie in parallel worktrees; agent-pluralist [brief: 06_ide_makers].
- **Tabnine / Amazon Q / Augment** — turn deployment topology and procurement contracts into the product; air-gap is the SKU [brief: 07_enterprise].
- **Sourcegraph (Cody Enterprise + Amp)** — concede IC, monetize the code graph at $59/seat in the regulated enterprise [brief: 07_enterprise].
- **eri** — voice as primary input, gaze as ambient context, deterministic Fast Apply, local-first everything except a paid wrap on the planning/edit inference; the developer's keyboard is no longer the bottleneck.

---

## 3. Convergent Patterns — Features in 4+ Tools (Table Stakes)

| Pattern | Where it ships | What eri has | Gap-close priority |
|---|---|---|---|
| **Multi-file edit format** (search-replace, diff, or whole-file rewrite) | Cursor, Windsurf, Copilot, Cline, Continue, Aider, Claude Code, Codex, Zed, Junie [brief: 04_cli_coders, cursor: 01] | ✓ deterministic SEARCH/REPLACE with fuzzy cascade — already best-in-class | DONE |
| **@-mentions for context** (`@file`, `@codebase`, `@docs`, `@web`, `@git`) | Cursor 14+ types, Windsurf, Copilot, Cline, Continue [cursor: 02 §7] | ◐ partial | **High** — voice + `@` reads aloud is a unique win |
| **Repo-versioned rules file** (`.cursor/rules/*.mdc`, `.clinerules/`, `.windsurf/`, `.continue/`, `AGENTS.md`, `CLAUDE.md`) | All open-source tools + Cursor + Windsurf [brief: 03_open_source §5.3] | ✓ rules engine live | DONE; add `.eri/skills/` in flight |
| **MCP client** (stdio + Streamable HTTP) | Cursor 5000+, Windsurf 100-cap, Copilot+1st-party server, Cline marketplace, Continue SSE+HTTP, Zed, JetBrains [brief: 02 §10, 03 §5.4] | ✓ async stdio + Streamable HTTP | DONE |
| **Semantic codebase index** | Cursor Turbopuffer, Windsurf Fast Context, Augment 500k files, Continue, Sourcegraph, Cline | ✓ Ollama nomic-embed-text local | **High** — beat Cursor on privacy by being local |
| **Tier-gated free + paid** | Every commercial tool | TBD | **High** — gate by feature, not by token quota |
| **BYOK at least for chat** | All 4 OSS tools, Windsurf Pro, Zed, JetBrains, Tabnine | ✓ OS Keychain | DONE — promote agent-respecting BYOK as anti-Cursor pitch |
| **Auto router** between models | Cursor Auto, Copilot Auto, Windsurf, Continue | ✗ | **Medium** — defer; opacity is a known Cursor complaint [cursor: 03 §3] |
| **Cloud / background agents** | Cursor up to 8 parallel, Windsurf Devin, Copilot Coding Agent, Cline CLI Kanban, JetBrains Air, Augment | ✗ | **Low this quarter** — local-first thesis says no; revisit Q3 via worktree iterator |
| **Checkpoint / shadow git** | Cursor, Windsurf, Cline (best-in-class shadow git), Replit, Aider auto-commits | ✓ live | DONE |
| **Per-block diff Accept/Reject** | Cursor, Windsurf, Copilot Edits, v0, Continue | ✓ live | DONE |
| **Onboarding walkthrough** | Cursor 3, Lovable chat-only, Replit, v0, JetBrains | ✓ 6-step live | DONE |
| **Settings hub** | Every tool | ✓ 12 sections live | DONE |
| **Open VSX extension marketplace** | Cursor (forced June 2025 by Microsoft), Zed [cursor: 03 §11] | ✓ inherent in VSCodium fork | DONE |
| **Refactor-as-tool** (deterministic rename/extract calls) | JetBrains Junie [brief: 06_ide_makers §2.3] | ✗ | **Medium** — wire LSP refactoring commands into the agent toolset |
| **Skills system** (markdown procedures) | Claude Code, Copilot CLI Agent Skills, Cursor Skills [brief: 04_cli_coders §1] | ◐ in flight `.eri/skills/` | **High** — finish this quarter |

The convergent set is table stakes. eri ships ~75% of it already; the remaining 25% (skills, expanded `@-mentions`, refactor-as-tool, semantic index quality) is mostly polish on capabilities we already have.

---

## 4. Single-Tool Moats — Features in Only ONE Competitor

| Feature | Owner | Genuine moat or vanity? | Should eri copy? |
|---|---|---|---|
| **Codemaps** (shareable visual artifact bridging human + agent) | Windsurf [brief: 01_windsurf §2] | **Genuine** — the most distinctive "context engineering" surface in the market | YES — already on the roadmap; voice+gaze makes it 10× better (look at a node, ask about it) |
| **Devin in IDE handoff** + Agent Command Center Kanban | Windsurf (Cognition) [brief: 01_windsurf §5] | Genuine but architecturally heavy | NO — adopt the Kanban *pattern* (iterator panel exists), skip the cloud-engineer SKU |
| **Codex CLI kernel sandbox** (Seatbelt + Landlock + seccomp) | Codex CLI [brief: 04_cli_coders §2] | Genuine — only safe full-auto agent | YES, but Q3+ — kernel sandbox for `eri exec` once we ship CLI |
| **Fast Apply** speculative-decode model (~1000 tok/s) | Cursor [cursor: 01 §6] | Was a moat in 2024; now eri's deterministic SEARCH/REPLACE cascade matches latency at zero ML | NO — we already win the apply step deterministically |
| **Cerebras-served frontier inference** (~950 tok/s) | Windsurf SWE-1.5 [brief: 01_windsurf §4] | Vendor lock-in, opaque pricing | NO |
| **Visual Editor / Design Mode** (click element, drag style, agent applies) | Cursor 2.2+ [cursor: 02 §22] | **Genuine** — pairs perfectly with gaze | YES — gaze + voice on an element is a category-defining demo |
| **Browser tool** (agent navigates dev server, takes screenshots) | Cursor, Cline | Genuine for self-test loops | YES — Q2-Q3, reuses sidecar |
| **Worktrees panel** for parallel agents | Cursor 3 [cursor: 02 §22] | Useful UX pattern | YES — extend the iterator panel |
| **Codebase shadow Git** (every tool call commits) | Cline [brief: 03_open_source §2.3] | Genuine safety wedge | YES — extend our checkpoint timeline |
| **Multiplayer voice in editor** (CRDT cursors + audio) | Zed [brief: 06_ide_makers §1.5] | Niche but a real moat | NO this quarter; our voice infra could power it later |
| **NES — Next Edit Suggestions in JetBrains/Xcode/Eclipse** | Copilot [brief: 02_github_copilot §3] | Reach moat, not feature moat | NO — JetBrains plugin is 12–24 month plan |
| **Spark — natural-language full-stack app builder** | Copilot Pro+ | Vanity; collides with v0/Lovable | NO |
| **Cody / Augment cross-repo context engine (10+ repos)** | Sourcegraph, Augment [brief: 07_enterprise §3] | Genuine moat for enterprise monorepos | NO this quarter; revisit when we sell teams |
| **Air parallel-worktree agent orchestration** with multiple agent drivers | JetBrains Air [brief: 06_ide_makers §3] | Genuine differentiator on power-user UX | Partial — already directionally aligned via iterator panel |
| **`.continue/checks/` PR check as markdown file** | Continue.dev [brief: 03_open_source §1.2] | Genuine — assistant behavior reviewable in PR | YES — `.eri/checks/` is a one-week feature, big enterprise read |

---

## 5. eri's Unique Position — Features NO Competitor Has

These are listed in descending order of defensibility:

1. **Voice-driven editing as a primary input modality** — Cascade has a voice prompt checkbox [brief: 01_windsurf §2]; no other tool has voice in the loop. eri uses local Whisper in the Rust sidecar, paired with a code-aware vocabulary. The CLI tier explicitly cannot ship this — keyboard is their thesis [brief: 04_cli_coders].
2. **Gaze-driven ambient context** — Windsurf "Flow" reads terminal, clipboard, navigation [brief: 01_windsurf §3]. Cursor reads cursor + selection [cursor: 02 §7]. None reads *where the user is looking*. MediaPipe runs in the sidecar; gaze becomes a strictly stronger signal than mouse hover for "what code to change."
3. **Diffusion-class edit semantics** — Composer 2.5, SWE-1.5, GPT-5.x, Claude Sonnet 4.6 all emit tokens left-to-right [cursor: 01 §2]. Zed lists Mercury Coder as a pluggable provider [brief: 06_ide_makers §1.2] — a *signal* that the diffusion paradigm is recognized, but the surrounding UX is still autoregressive. eri builds the edit-review UX *around* parallel multi-region candidate generation.
4. **True local-first stack** — Continue/Cline/Aider/Zed/JetBrains all support local models, but their *index*, *Apply*, *voice*, *gaze*, and *agent state* are not simultaneously local. eri runs (a) embeddings local via Ollama, (b) Tab local via llama.cpp FFI, (c) Apply local and deterministic (no ML), (d) voice local, (e) gaze local — only the planning/edit inference is the paid wrap. No competitor has this profile.
5. **Deterministic Fast Apply** with the Aider-style fuzzy cascade [brief: 04_cli_coders §3] — eri's apply step has **zero ML**, faster and more precise than Cursor's trained Llama-3-70B Fast Apply [cursor: 01 §6] on the apply step itself. Cursor's whole apply infrastructure is a hidden moat eri matches with ~200 lines of matching logic.
6. **VSCodium fork + OpenVSX** — Microsoft restricted the VS Code Marketplace to its own products in 2025; Cursor scrambled to OpenVSX in June 2025 and now maintains forks of popular extensions [cursor: 03 §11]. eri lives natively on OpenVSX; Microsoft cannot lock us out of our own extension store.
7. **Sidecar BYOK key bridge respecting the agent** — Windsurf permits BYOK to run Cascade [brief: 01_windsurf §6]; Cursor refuses [cursor: 03 §4]. eri ships OS Keychain BYOK that runs every surface including the planning/edit pipeline, with key never leaving the user's machine.

---

## 6. The 10 Most Strategic Features to Ship Next (RANKED)

Ranking criteria: (a) closes a convergent gap that's table stakes, (b) leverages the voice/gaze/diffusion/local-first edge, (c) effort-to-impact ratio.

| # | Feature | What it is | Closest competitor | What eri's version differs on | Effort | Priority |
|---|---|---|---|---|---|---|
| 1 | **Skills system** (`.eri/skills/`) | Markdown-defined procedures auto-loaded by description match; lazy context; voice-callable | Claude Code Skills [brief: 04_cli_coders §1], Cursor `/create-rule`, Copilot Agent Skills | Voice-callable by skill name; gaze can scope which skill activates | 1–2 weeks (in flight) | **SHIP NOW** |
| 2 | **Codemaps-style visual artifact** | Generated diagram of how the codebase *executes* (not imports); shareable; `@codemap` injectable | Windsurf Codemaps [brief: 01_windsurf §2] | Gaze on a node = inject that subgraph; voice "explain this" with eye on node | 1–3 months | **HIGH** |
| 3 | **Local Tab via llama.cpp FFI** | Replace Ollama for Tab with embedded llama.cpp; sub-100ms cold-start | Zed Zeta2 local, JetBrains Mellum local [brief: 06_ide_makers] | Tab is *truly* local and zero-network; works offline | 1–2 weeks (in flight) | **SHIP NOW** |
| 4 | **Visual Editor / Design Mode** | Click an element in running app, get gaze coordinates, dictate change, diffusion engine paints multi-region edit back into source | Cursor 2.2+ Visual Editor [cursor: 02 §22], Lovable Visual Edits [brief: 05_vibe_coding §2] | Gaze + voice on an element; parallel candidate edits; local apply | 1–3 months | **HIGH** |
| 5 | **Expanded `@-mention` vocabulary** | `@file`, `@folder`, `@code`, `@docs`, `@web`, `@codebase`, `@git`, `@past_chats`, `@recent_changes`, `@linter_errors`, `@definitions`, `@mcp_tools` | Cursor 14+ types [cursor: 02 §7] | Voice reads them aloud: "at codebase"; gaze auto-fills `@code` from looked-at symbol | 1–2 weeks per type, ~1 month total | **HIGH** |
| 6 | **Preview-as-canvas + one-button share-link** | Embedded preview pane as the largest surface; one button to publish ephemeral preview URL | Lovable subdomain, Vercel preview, Bolt+Netlify [brief: 05_vibe_coding §0] | Local IDE that also ships a "share this state" deploy button — closes the deploy-ability moat Cursor structurally cannot [brief: 05_vibe_coding §"deploy-ability moat"] | 1–3 months | **HIGH** |
| 7 | **eri CLI (`eri` command)** | Thin frontend on same agent runtime; `eri plan`, `eri ask`, `eri run`, `--mcp list` | Cursor `cursor-agent` Jan 2026 [brief: 04_cli_coders §"convergence"], Cline CLI, Copilot CLI, Claude Code | Same runtime as voice/gaze IDE; sessions started in voice resume in CLI | 1–3 months | **MEDIUM** |
| 8 | **`.eri/checks/` AI check files** | Markdown checks committed to repo, run as PR status via local CLI or CI | Continue `.continue/checks/` [brief: 03_open_source §1.2] | Local-first by default; runs on developer laptop, optionally CI; voice can describe a check to scaffold it | 1–2 weeks | **MEDIUM** |
| 9 | **Sidecar BYOK key bridge** | OS Keychain bridge that lets the Rust sidecar pull keys for paid-API requests without electron seeing them | Windsurf Hub Proxy [brief: 01_windsurf §6], Continue Hub Proxy [brief: 03_open_source §1.4] | Keychain stays sealed at the OS boundary; sidecar is the only process that touches it | 1–2 weeks (in flight) | **MEDIUM** |
| 10 | **Refactor-as-tool wiring** | Expose LSP refactor commands (Rename, Extract Method, Move) as agent tools rather than diffs | JetBrains Junie [brief: 06_ide_makers §2.3] | Cross-file rename via LSP is *deterministic*; voice "rename this everywhere" routes to LSP, not the model | 1–2 weeks | **MEDIUM** |

Anti-roadmap deliberately not on the list: cloud background agents, JetBrains plugin, BugBot/PR-bot, autonomous test loop (Replit Agent 3 style), Claude-Code-style hooks (CRA-grade complexity for marginal win), multi-tenant team SSO/SCIM. See §7.

---

## 7. The 5 Features to Deliberately NOT Ship (Anti-Roadmap)

| Feature | Who has it | Why it's a trap for eri |
|---|---|---|
| **Cloud / Background Agents w/ separately-billed VMs** | Cursor 8-way parallel, Windsurf Devin, Copilot Coding Agent, Cline CLI Kanban, Augment | Forces a second billing rail (Windsurf is the cautionary tale: seats + ACUs confuses users [brief: 01_windsurf §6]). Local-first thesis says: *the laptop is the runtime.* Iterator panel + worktrees on local machine cover 80% of the value at 0% of the gross-margin pain. |
| **PR-Bot / BugBot as a separate SKU** | Cursor BugBot ($1.00–$1.50/run usage-based [cursor: 02 §14]), Copilot Code Review, Sweep | Sweep proved the standalone PR-bot category got absorbed into the larger agents [brief: 07_enterprise §5]. Ship `.eri/checks/` instead — same outcome, owned by the developer, free. |
| **JetBrains plugin in 2026** | Cursor (ACP, Mar 2026), Copilot, Windsurf, Continue, Tabnine, Augment, JetBrains-native | Voice/gaze/diffusion-edit UX needs the editor surface; spreading thin across hosts dilutes the differentiator [brief: 06_ide_makers §8]. Revisit Q3 2027 via ACP once the editor is stable. |
| **Auto router that hides which model ran** | Cursor Auto, Copilot Auto, Continue, Windsurf | Cursor's #1 BYOK churn driver after the credit-pool migration is *Auto-mode opacity* [cursor: 03 §3, §18]. eri's anti-Cursor pitch is *no surprises* — keep model selection explicit and visible. |
| **Spark-class "natural-language full-stack app from prompt"** | Copilot Spark, Lovable, v0, Bolt, Replit Agent | Greenfield-only is a different product [brief: 05_vibe_coding §"where these tools cap out"]. eri's wedge is *existing codebases with voice/gaze*. Greenfield generators are a $200M ARR market we don't need to enter. |

Bonus anti-features worth saying out loud: no credit pool, no overage billing, no per-token markup on BYOK, no "premium request" tier, no cloud-only enterprise SKU.

---

## 8. Pricing Analysis

| Tool | Free | Individual | Team | Enterprise | Notable structure |
|---|---|---|---|---|---|
| **Copilot** | 50 chat / 2k completions | $10 | $19/seat | $39/seat | Cheapest; June 1 AI Credits + Actions minutes [brief: 02 §6] |
| **Claude Code** | n/a | $17–20 (Pro) | $100 (Max 5x) | $200 (Max 20x) | Bundled, no per-token visible [brief: 04 §1] |
| **Codex CLI** | n/a | $8 Go / $20 Plus | $100 Pro | $200 Pro | Bundled w/ ChatGPT [brief: 04 §2] |
| **Zed** | $0 unlim editor + 2k preds | $10 Pro (list+10%) | $30/seat | custom | List+10% — most transparent in category [brief: 06 §1.4] |
| **Cursor** | capped | $20 / $60 / $200 | $40/seat | ~$500–$1000/yr/user | Credit pool + overage; effective ~$40 [cursor: 03 §1] |
| **Windsurf** | tight quota | $20 Pro | $40 Teams | ~$60/user | Quota + ACUs (two rails) [brief: 01 §6] |
| **Continue Solo** | $0 BYOK forever | $0 | $20 Team | custom | Solo is truly free [brief: 03 §1.6] |
| **Cline** | $0 OSS | $0 | $0 | custom | No paid individual tier [brief: 03 §2.6] |
| **JetBrains AI** | unlim local Mellum | $8–10 Pro | n/a | $30 Ultimate | Credits burn fast on Junie [brief: 06 §2.2] |
| **Tabnine** | n/a | $39 | $39 | $59 + license | Air-gap bundled [brief: 07 §1] |
| **Amazon Q Dev** | 50/mo | $19/seat | $19/seat | $19/seat | Inherits AWS contract [brief: 07 §2] |
| **Augment** | Community | $20 Indie / $50 Dev | $60–$200 Team | custom | Credit-based [brief: 07 §3] |
| **Replit Agent** | daily caps | $20 Core | $100 Pro | custom | + $0.25/checkpoint [brief: 05 §1] |
| **Lovable** | 5/day | $25 Pro | $50 Business | custom | Heavy credit burn [brief: 05 §2] |
| **v0** | $5/mo | $20 Premium | $30/seat | custom | Token tiers Feb 2026 [brief: 05 §3] |
| **Sourcegraph** | n/a (Cody Free killed) | n/a (Amp free defensive) | n/a | $59/seat list | IC abandoned [brief: 07 §4] |

**Where eri's $20 with hard cap, no overage, Tab bundled, edit-engine bundled, BYOK respected fits:**

- **Above** the OSS floor of Cline ($0) and Continue Solo ($0). Defensible because voice/gaze/diffusion are *not* on those tools and structurally cannot be.
- **At parity** with Cursor Pro, Windsurf Pro, v0 Premium, Replit Core, Bolt Pro, Zed Pro is $10 — slight premium over Zed.
- **Below** Tabnine ($39), JetBrains Ultimate ($30), Cursor Pro+ ($60), Augment Dev ($50), Sourcegraph Cody ($59).
- **Defensible because:**
  - No credit-pool surprise — the #1 Cursor churn driver since June 2025 [cursor: 03 §18].
  - Tab is local (llama.cpp), so Tab is genuinely unmetered (Zed only promises this with edit-prediction caps).
  - Apply is deterministic — zero inference cost per apply.
  - Voice + gaze inference are local — zero metered cost.
  - The only paid wrap is the planning/edit API call, which BYOK respects.
- **Risk: too cheap if** the diffusion-class edit-engine cost is structurally higher than text inference and we don't have a hard cap mechanism. We must hard-cap and degrade to a fallback (local model or smaller engine) on cap-hit, not surprise-bill.
- **Risk: too expensive if** the segment we win is solo developers who would otherwise use Cline OSS + their own OpenRouter key for ~$5/month token spend [brief: 03_open_source §8]. Counter: that segment doesn't get voice/gaze ergonomics.

**Recommended structure:**

- **Free** — local Tab, local Apply, local embeddings, voice transcription only, gaze disabled, no paid-API access. Mirrors Continue Solo / Cline OSS in spirit. Real product, not a teaser.
- **Pro $20/mo, hard cap, no overage** — full voice + gaze + diffusion-class edit/plan engine, all `@-mentions`, MCP, checkpoints, skills. On cap-hit, degrade gracefully to BYOK or a smaller local model; never surprise-bill.
- **Pro BYOK $20/mo** — Pro features against user's own Anthropic/OpenAI key. We charge for the seat, not the tokens. Anti-Cursor positioning.
- **Team** (post Q3) — shared `.eri/skills/`, `.eri/checks/`, audit log, SSO. $40/seat.
- **Enterprise** (post 2027) — VPC option, customer-controlled gateway for the paid-API call, SCIM, SIEM export. Architecture already permits this per `07_enterprise_plays.md` §"don't paint into a corner."

---

## 9. Brand Positioning — One Sentence

> **eri is the local-first IDE where your voice and eyes drive a diffusion-class engine that rewrites your existing code in parallel — your laptop is the runtime, not a billing endpoint.**

No competitor can credibly match this:
- Cursor cannot be local-first without rebuilding their infrastructure [cursor: 03 §8].
- Copilot cannot be local-first; their entire stack is cloud-routed [brief: 02 §12].
- Windsurf has voice as a checkbox, not a primary input [brief: 01 §11].
- Claude Code / Codex CLI are keyboard-first by ideology [brief: 04 §"CLI thesis"].
- Zed has multiplayer voice between humans, not voice-to-agent [brief: 06 §1.5].
- Cline / Continue / Aider have no voice, no gaze, no diffusion edit semantics [brief: 03 §7.5].
- v0 / Lovable / Bolt / Replit are greenfield generators, not existing-codebase tools [brief: 05 §"where these tools cap out"].

---

## 10. If We Only Ship Three Things This Quarter

### Deliverable 1 — **Skills + Local Tab + Codemaps-lite** as one shipped feature suite

**The why.** Skills (`.eri/skills/`) and local Tab via llama.cpp are both in flight; finishing them this quarter closes the convergent table-stakes gap with Claude Code [brief: 04 §1.3] and Zed [brief: 06 §1.2] simultaneously. Codemaps-lite — a generated execution-graph artifact addressable via `@codemap` and gaze-pointable — converts Windsurf's most differentiated feature [brief: 01 §2] into a voice/gaze-first surface no competitor can match. These three are technically separate but ship together as "the context surface": the user dictates a question with their eye on a node of the codemap, the relevant skill auto-activates, the local Tab predicts the next edit, and the diffusion engine paints the change. One narrative, three components.

### Deliverable 2 — **Visual Editor with gaze + voice on running preview**

**The why.** This is the single feature where eri's voice + gaze stack produces a category-defining demo that Cursor, Windsurf, and the entire CLI tier cannot reproduce. Cursor's Visual Editor [cursor: 02 §22] needs a mouse; Lovable Visual Edits [brief: 05 §2] need a click; eri lets the user *look at the element, say what to change, watch the diffusion engine paint multiple candidates*. This is also the wedge into the deploy-ability moat [brief: 05 §"deploy-ability moat"] — preview-as-canvas with a share-link button makes eri a credible competitor to Lovable for greenfield *and* a credible competitor to Cursor for existing-codebase work, on a UX no competitor has the inputs for.

### Deliverable 3 — **Pro pricing launch with hard cap, no overage, BYOK respect, and "$20 flat" positioning**

**The why.** Cursor's June 2025 credit-pool migration is still the canonical bad memory of the category [cursor: 03 §18]; Copilot's June 1 2026 AI Credits switch is the next one [brief: 02 §6]; Windsurf has two billing rails [brief: 01 §6]; JetBrains Junie burns credits unpredictably [brief: 06 §2.2]; Lovable / Replit / v0 / Bolt all generate credit-anxiety stories [brief: 05]. Shipping a *flat $20 with hard cap, no overage, BYOK respected* — and saying it in every piece of copy — turns the loudest single complaint in the category into eri's marketing. Continue and Cline don't compete here because they don't ship voice/gaze. Cursor and Copilot can't match without restructuring their unit economics. The price floor itself becomes a strategic asset.

---

## Appendix — Bibliography of Briefs Cited

- `[brief: 01_windsurf]` Windsurf / Cognition / Devin / SWE-1.5 / Codemaps
- `[brief: 02_github_copilot]` GitHub Copilot / Agent HQ / Coding Agent / NES / June 1 pricing
- `[brief: 03_open_source]` Continue.dev / Cline / Roo Code → Zoo Code / PearAI
- `[brief: 04_cli_coders]` Claude Code / Codex CLI / Aider
- `[brief: 05_vibe_coding]` Replit Agent / Lovable / v0 / Bolt.new / Same.dev
- `[brief: 06_ide_makers]` Zed / JetBrains AI+Junie+Mellum+Air / VS+Copilot / Sublime
- `[brief: 07_enterprise]` Tabnine / Amazon Q Dev / Augment / Sourcegraph / Sweep / Codeium→Windsurf arc
- `[cursor: 01]` Composer 2.5 Deep Dive
- `[cursor: 02]` Cursor Full Feature Catalog
- `[cursor: 03]` Cursor Pricing, Business Model, Customer Ecosystem
