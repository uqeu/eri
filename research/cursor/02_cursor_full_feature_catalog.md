# Cursor Full Feature Catalog (May 2026)

> Research brief for eri competitive analysis. Compiled May 21, 2026.
> Covers Cursor 3.x (released April 2, 2026) through 3.5 (released May 20, 2026).
> All sections summarize publicly-documented behavior; nothing here is reverse-engineered from the binary.

---

## 1. Tab Completion

**What it does.** Tab is Cursor's predictive next-action engine. It generates ghost-text suggestions as you type — full lines, multi-line blocks, and cross-file edits — based on recent edits, surrounding code, the open editor state, and active linter errors [source: https://cursor.com/docs/tab]. Unlike traditional autocomplete that completes the current token, Tab predicts the *next thing you would type or do*, including jumping the cursor to another location after an accept.

**Triggered by.** Typing. Suggestions appear as grayed-out ghost text ahead of the cursor. Accept full suggestion with `Tab`; reject with `Esc`; accept word-by-word with `Cmd→` (macOS) / `Ctrl→` (Win/Linux). After accepting, pressing `Tab` again invokes "jump-in-file" — Tab predicts the next likely edit location and moves the cursor there [source: https://cursor.com/docs/tab].

**The model.** Tab is powered by a Cursor-trained custom sparse language model called **Fusion** (introduced 2025, refined through 2026). It is *not* a general LLM — it is described as "a custom sparse language model trained to predict edits on billions of tokens" using reinforcement learning on real-world Cursor traces [source: https://cursor.com/blog/tab-update]. The original Tab model originated from Anysphere's acquisition of Supermaven. Cursor reports it produces ~1B edited characters/day across users, and that the Fusion variant achieved p50 server latency of 260ms (down from 475ms in the March 2024 generation) with a 13,000-token context window (up from 5,500) [source: https://cursor.com/blog/tab-update]. Recent product page states Tab "makes 21% fewer suggestions while having 28% higher accept rate" — Cursor's stated tradeoff is precision over volume [source: https://cursor.com/product/tab].

**Cross-file / import handling.** Tab can suggest "coordinated edits across related code" — e.g., if you rename a symbol in one file, Tab will surface the corresponding edit in callers. It also adds missing imports automatically as part of multi-line completions [source: https://cursor.com/docs/tab].

**Differences from GitHub Copilot's tab.** (1) Cursor-trained, dedicated model rather than a routed call to OpenAI Codex/GPT. (2) Multi-line edits and *deletions* (not just insertions). (3) Jump-in-file navigation. (4) Edits informed by linter errors and project state, not just the cursor prefix. (5) Lower stated latency (260ms p50 server-side vs. typical Copilot streams).

**Tier-gating.** Hobby gets limited Tab completions/month; Pro and above get unlimited Tab on the Pro tier (Cursor markets Tab as unmetered on paid plans) [source: https://cursor.com/pricing].

**Known issues.** Tab is reportedly broken or inconsistent in non-code files — markdown, Jupyter markdown cells, and some plain-text contexts have shipped without working Tab completions in several releases [source: https://forum.cursor.com/t/version-0-46-tab-does-not-work-with-markdown-files/57340]. Some users complain about "Tab fatigue" — the high accept rate is partly because Tab learns to suggest what you'd accept rather than what you need [source: https://checkthat.ai/brands/cursor/reviews].

---

## 2. Cmd-K Inline Edit

**What it does.** Cmd-K is the in-place, single-buffer edit prompt. Select code (or place the cursor), press `Cmd+K` (macOS) / `Ctrl+K` (Win/Linux), type a natural-language instruction, and the model rewrites the selection in place, showing an inline green/red diff that you accept or reject [source: https://cursor.com/docs/inline-edit/overview].

**UI.** A zone-style widget renders directly above/below the selection within the editor — *not* a popover, *not* a side panel. The prompt input is anchored to the editor gutter. Follow-up instructions can be added by typing in the same widget and pressing `Return` again to refine, before final accept [source: https://cursor.com/docs/inline-edit/overview].

**Ask vs. Edit modes.** Default is Edit (rewrites in place). Press `Opt+Return` (macOS) / `Alt+Return` (Win/Linux) to switch to "Ask" mode — the model answers a question about the selection without modifying it. If the answer is good, type "do it" to commit the change [source: https://cursor.com/docs/inline-edit/overview].

**Cmd-K vs. Composer / Agent.** Cmd-K is scoped to one file and the active selection. For multi-file edits, complex refactors, or anything that needs the agent to read additional files, Cursor explicitly directs users to press `Cmd+I` and use Composer/Agent instead [source: https://cursor.com/docs/inline-edit/overview]. Cmd-K is also faster — it's optimized for sub-second iteration on tight selections.

**Models.** Cmd-K uses the active chat model setting; it's not a separate model from Composer/Chat. The Apply step that materializes the diff uses the dedicated Fast Apply model (see §6).

**Tier-gating.** Available on all tiers; Hobby is rate-limited.

**Known issues.** A long-running thread reports Cmd-K not always picking up project rules or custom modes [source: https://forum.cursor.com/t/inline-ai-editor-cmd-k-not-using-cursor-commands/137197].

---

## 3. Chat (Cmd-L)

**What it does.** Chat is the conversational side-panel pane on the right of the editor, used for project-aware Q&A, exploration, and code generation. It is aware of the active file by default and can pull in additional context via @-mentions [source: https://cursor101.com/tutorial/learn-cursor-chat].

**Triggered by.** `Cmd+L` (macOS) / `Ctrl+L` (Win/Linux) toggles the panel. New chat: `Cmd+N` inside the panel. Submit: `Return`; insert newline: `Shift+Return`.

**Chat vs. Composer.** In the pre-Cursor-3 era, Chat was strictly conversational — it could *suggest* code blocks but didn't apply them automatically; you'd click "Apply" to push a change into the file [source: https://forum.cursor.com/t/whats-the-difference-between-chat-and-composer/21879]. Composer added autonomous multi-file edits, terminal use, and an agentic loop. In Cursor 3 (April 2026), the line blurred: the redesigned interface consolidates Chat, Composer, and Agent into modes within a single workspace — they share the same panel surface but pick different toolsets [source: https://cursor.com/blog/cursor-3]. The historical "Chat doesn't edit, Composer does" distinction has effectively gone away in the new UI; what differs now is *mode* (Ask, Edit, Agent) rather than panel identity.

**@-mention support in Chat.** Supports the full @-mention vocabulary listed in §7: @File, @Folder, @Code, @Docs, @Web, @Codebase, @Git, @Past Chats, @Recent Changes, @Linter Errors, @Definitions, plus MCP-tool-defined @-handles.

**Tier-gating.** All tiers; usage-credit-billed beyond Hobby caps.

---

## 4. Composer (Cmd-I)

**What it does.** Composer is the multi-file editing interface. You describe a change in natural language, Composer picks the files it needs (or you @-mention them), runs the model, generates coordinated diffs across multiple files, and presents a multi-file diff view to accept/reject as one transaction [source: https://blog.vibecoder.me/cursor-composer-multi-file-editing-mastery].

**Triggered by.** `Cmd+I` (macOS) / `Ctrl+I` (Win/Linux). In Cursor 3, this opens the unified Agents Window where Composer is one mode among several [source: https://cursor.com/changelog/3-0].

**UX.** Side panel by default, expandable to full-screen workspace. Shows a running list of files touched, diff previews per file, and a single "Accept All" / per-file accept flow. Composer keeps a persistent transcript so you can iterate: "now also update the tests".

**Model details.** Composer can run on Cursor's own Composer 2 / Composer 2.5 models or any frontier model picked from the model selector. (Composer 2.5 deep-dive is a separate document — here we just note the entry point.)

**Tier-gating.** Available Pro and above; Hobby gets limited Composer requests per month.

---

## 5. Agent Mode

**What it does.** Agent mode is the autonomous loop layered on top of Composer. The agent picks files, reads them, edits them, runs terminal commands, observes output (test failures, lint errors, runtime errors), and iterates until the task is done or it asks for clarification. Cursor documentation states there is "no limit on the number of tool calls Agent can make during a task" [source: https://cursor.com/docs/agent/overview].

**Capabilities beyond Composer.**
- Full terminal access — installs packages, runs builds, executes tests, starts dev servers, diagnoses runtime errors [source: https://cursor.com/docs/agent/tools/terminal].
- Browser control — opens pages, navigates, takes screenshots, performs visual checks against a running dev server [source: https://cursor.com/docs/agent/tools/browser].
- Image generation — UI mockups, architecture diagrams.
- Codebase semantic search, file read/write, directory listing.
- Web search and fetch.
- Clarification queries — can pause mid-task to ask the user.
- Checkpoints — Cursor snapshots the codebase before significant changes; users can roll back to any prior checkpoint from the chat timeline [source: https://cursor.com/docs/agent/overview].

**Error iteration.** Agent observes terminal/test output and re-iterates without user prompting. This is the primary differentiator from Composer's single-pass multi-file edit.

**Triggered by.** `Cmd+I`, then select "Agent" mode in the mode dropdown. Alternatively, kicked off from the Agents Window directly.

**Tier-gating.** Pro and above; Hobby has tight caps.

---

## 6. Apply (the Fast Apply model)

**What it does.** When a chat-side model produces a code suggestion, "Apply" is the action that materializes that suggestion into the actual file. Cursor split this into two stages: a planning stage (the frontier model decides *what* to change) and an applying stage (a dedicated, much smaller, much faster Cursor model rewrites the file to match the suggested diff) [source: https://blog.getbind.co/2024/10/02/how-cursor-ai-implemented-instant-apply-file-editing-at-1000-tokens-per-second/].

**Why a separate model.** Frontier models are slow and expensive for whole-file rewrites. Applying a suggested change to a real file is a relatively constrained task — you have the original file, you have the proposed diff/snippet, you produce the merged file. Cursor trained a smaller model just for that task. Reported speed: ~1000 tokens/sec (~3500 chars/sec) using a technique they call "speculative edits" — a code-edit-tailored variant of speculative decoding [source: https://blog.getbind.co/2024/10/02/how-cursor-ai-implemented-instant-apply-file-editing-at-1000-tokens-per-second/].

**UX.** When you click "Apply" on a chat code suggestion or accept a Cmd-K edit, you see a streaming green/red inline diff with the new file content appearing line-by-line. Accept the diff with another keypress.

**Tier-gating.** Used implicitly by all paid Cursor surfaces; no separate dial.

**Known issues.** A long-standing forum thread asks for a way to disable the Apply model and use raw model output, because in rare cases Fast Apply mangles the merge [source: https://forum.cursor.com/t/diff-mode-tools-disable-apply-model/70957].

---

## 7. @-mentions Ecosystem

Cursor's @-syntax is the unified mechanism for adding context to any prompt (Cmd-K, Chat, Composer, Agent). Typing `@` opens a fuzzy picker. The full vocabulary as of May 2026:

- **@File / @Files** — Picks an arbitrary file from the workspace. A preview is shown in the picker; the full file (or a chunked subset for large files) is added to context.
- **@Folder** — Adds a whole folder. Cursor expands recursively but is conservative about token usage.
- **@Code** — Picks a specific symbol/function/class. More targeted than @File when you only need a definition.
- **@Symbol** — Alias-like surface for picking named symbols; overlaps with @Code [source: https://docs.cursor.com/en/context/@-symbols/@-linter-errors].
- **@Docs** — References pre-indexed third-party library docs. Cursor ships pre-indexed docs for React, Node.js, NumPy, Python stdlib, and many other popular frameworks. You can add custom doc sources via `Settings > Features > Docs > Add new doc` by providing a URL; Cursor will crawl and index it [source: https://datalakehousehub.com/blog/2026-03-context-management-cursor/]. Note: forum reports the @Docs dropdown is harder to find in the Cursor 3 UI redesign [source: https://forum.cursor.com/t/where-is-docs-on-cursor-3/156807].
- **@Web** — Cursor constructs a search query from your prompt + selected context, executes a live web search, and pulls the top results in as context. Used for "what's the latest API" style queries.
- **@Codebase** — Triggers semantic search over the full project using Cursor's custom embeddings (see §8). Returns the top-N most relevant chunks. The "most powerful" @-mention per most user guides [source: https://datalakehousehub.com/blog/2026-03-context-management-cursor/].
- **@Git** — References commits, branches, diffs, and PR context. Useful for "explain what changed in the last commit" or "what diverged from main".
- **@Past Chats** — References prior chat sessions in the same workspace, so the agent can pick up where a previous conversation left off [source: https://medium.com/@xitvali/a-practical-guide-to-cursor-part-2-13aadecf1f49].
- **@Recent Changes** — References uncommitted edits and recently-touched files. Helps continuity in a long task.
- **@Linter Errors** — Pulls in the current ESLint/TS/clippy/etc. errors as context. Common pattern: "Fix all issues listed in @Linter Errors" [source: https://docs.cursor.com/en/context/@-symbols/@-linter-errors].
- **@Definitions** — Injects nearby symbol definitions for the current cursor position — types, constants, related functions [source: https://medium.com/@xitvali/a-practical-guide-to-cursor-part-2-13aadecf1f49].
- **MCP tool @-handles** — Any MCP server you've installed can expose tools that show up under @. E.g., installing a Linear MCP server adds `@Linear` for fetching ticket context.
- **@Notepad** (legacy, deprecated October 2025) — Used to reference persistent notepad documents; replaced by Memories.

The @-vocabulary is one of Cursor's strongest moats — it gives users surgical, predictable control over context, instead of relying on the model to guess.

---

## 8. Codebase Indexing

**What it does.** When you open a project, Cursor builds a semantic index of the entire codebase so that @Codebase and the agent's internal retrieval can pull relevant chunks on demand [source: https://cursor.com/docs/context/codebase-indexing].

**Process.**
1. **Local chunking.** Cursor walks the workspace, respects `.gitignore` and `.cursorignore`, and chunks files into semantically meaningful pieces — AST-aware where possible (recursive splitter falls back when the language isn't supported) [source: https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/].
2. **Embedding.** Each chunk is sent to Cursor's embedding service. The embedding model is *custom* — Cursor trained it using agent-session traces as supervision: the model learns to score chunks by how useful they were to past agent runs, calibrated against LLM rankings of helpfulness [source: https://cursor.com/blog/semsearch].
3. **Storage.** Embeddings live in Turbopuffer, a serverless vector database, with full-text search alongside vector similarity [source: https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/].
4. **Retrieval.** On `@Codebase` or agent tool calls, the query is embedded, top-N chunks are returned ranked by similarity, and the local client fetches the actual file content to inject into the prompt. Source code never lives long-term server-side in plaintext — only embeddings do.

**Update cadence.** Index updates incrementally as files change in the workspace; a manual reindex is available from settings.

**Scale.** Cursor's blog cites the system handling "very large codebases" without specific size cap; users report indexing monorepos in the millions of LOC. Cursor reports a 12.5% accuracy improvement over keyword-only retrieval [source: https://www.digitalapplied.com/blog/cursor-semantic-search-coding-ai-guide].

**User-visible UX.** A status indicator in the bottom bar shows indexing progress when a project is first opened or when many files change. `.cursorignore` controls what gets indexed.

**Security.** Cursor's "Securely indexing large codebases" post outlines how the indexing pipeline is set up to support enterprise zero-retention guarantees [source: https://cursor.com/blog/secure-codebase-indexing].

---

## 9. MCP (Model Context Protocol) Support

**What it does.** Cursor was an early adopter of Anthropic's Model Context Protocol — the open standard for AI clients to call external tools via a uniform schema. MCP servers extend the agent with new capabilities: query Postgres, search internal docs, call Linear, control a browser, etc. [source: https://cursor.com/docs/mcp].

**When added.** Cursor added MCP support in early 2025 (around v0.45). By March 2026 the MCP ecosystem grew to 5,000+ community servers per Cursor's documentation [source: https://www.truefoundry.com/blog/mcp-servers-in-cursor-setup-configuration-and-security-guide].

**Pre-configured servers.** Cursor doesn't ship a fixed bundle of MCP servers preinstalled — they pre-list popular options in the in-app marketplace (Cursor Marketplace, introduced Cursor 3). The marketplace surfaces curated MCPs by category (databases, ticketing, observability, browsers, etc.). Notable first-party integrations include Cursor's Jira integration (May 2026) which lets you assign work to Cursor from a Jira ticket [source: https://cursor.com/changelog].

**Adding custom MCPs.** Three ways:
1. One-click deep-link install from an MCP server's docs page.
2. UI flow: `Settings > Tools & MCP > New MCP Server`.
3. JSON: edit `.cursor/mcp.json` (project-scoped) or `~/.cursor/mcp.json` (global). Format mirrors Claude Desktop's `claude_desktop_config.json` [source: https://www.truefoundry.com/blog/mcp-servers-in-cursor-setup-configuration-and-security-guide].

**Server transports.** Supports local stdio servers and Streamable HTTP (introduced as MCP transport spec matured). SSE was the original transport.

**Requires restart.** Adding a new MCP server requires fully quitting and reopening Cursor — they only load on startup [source: https://www.truefoundry.com/blog/mcp-servers-in-cursor-setup-configuration-and-security-guide].

**Tier-gating.** MCP available Pro and above; Hobby tier doesn't get MCPs.

---

## 10. .cursorrules / Project Rules

**What it does.** Per-repo customization that injects instructions into every prompt run in that workspace [source: https://cursor.com/docs/rules].

**Format evolution.** Originally a single `.cursorrules` file in the repo root. In 2026 the recommended format is `.cursor/rules/*.mdc` — multiple Markdown-with-frontmatter files, each scoped to specific situations [source: https://medium.com/@vibecodingdirectory/how-to-structure-cursor-rules-in-2026-the-5-level-system-cursor-rules-eaf0df16e8e7]. The legacy single-file format is still honored but Cursor encourages migration.

**Activation modes.** Each `.mdc` file declares one of four modes in YAML frontmatter:
- **Always Apply** — included in every prompt.
- **Auto Attached** — included when files matching a glob pattern are in context.
- **Agent Requested** — the agent decides whether to pull it in based on a description.
- **Manual** — only included when explicitly referenced via `@rule-name`.

This is more sophisticated than competitors' single-file approach (e.g., Copilot's `copilot-instructions.md`).

**Creation.** Type `/create-rule` in chat and describe what you want; Cursor scaffolds the `.mdc` file.

**Affect on behavior.** Rules are injected as system instructions for every relevant prompt. They affect Cmd-K, Chat, Composer, and Agent equally. Cursor's documentation notes rules can also include "skills" — described code-action templates the agent can invoke.

**Tier-gating.** All tiers, including Hobby.

---

## 11. Custom Modes / Custom Instructions

**What it does.** Custom Modes (beta, Cursor 0.48+) let users define a named workflow with a specific tool palette, model, and system prompt. Examples: a "Review" mode with edit tools disabled, only Ask; a "Test-writing" mode that always pulls in `@Linter Errors` and the test directory [source: https://cursor.com/changelog/0-48-x].

**Configuration.** `.cursor/modes.json` — checked into the repo so the whole team gets the same modes. Each mode has a name, model, allowed tools, optional keybinding, and a system prompt.

**Enablement.** `Settings > Features > Chat > Custom modes`. Set the default mode via `Settings > Features > Chat > Default chat mode`.

**Global vs. project.** `.cursor/modes.json` lives per project. For user-level rules that apply across all projects, place `.mdc` files in the global Cursor rules directory.

**Custom instructions.** Beyond modes, Cursor exposes a "Custom Instructions" field in user settings — global system-prompt text appended to every conversation. Common pattern: "Always prefer immutable patterns; never use `any` in TypeScript."

**Tier-gating.** All tiers.

---

## 12. Multi-Model Routing

**What it does.** Cursor lets the user pick which LLM powers Chat / Composer / Agent / Cmd-K. The model picker is in the chat input bar.

**Models offered (May 2026).** Cursor's frontier roster typically includes:
- Anthropic — Claude Sonnet, Claude Opus (Claude 4.x family) (Note: Claude 4.7 1M context refers to the Anthropic API; Cursor's offering tracks Anthropic releases.)
- OpenAI — GPT family (GPT-5, GPT-5.5)
- Google — Gemini family
- Cursor's own — `composer-2`, `composer-2.5`, `cursor-small-v3` (low-latency distilled), the Tab Fusion model (not user-selectable)
- xAI Grok models (varies)
- DeepSeek models (varies)

**Auto mode.** "Auto" lets Cursor pick the best model based on query complexity, current model performance, and provider reliability. Auto bills at flat blended rates ($1.25/M input, $6/M output, $0.25/M cache reads — pricing as of pricing page snapshot) [source: https://cursor.com/pricing].

**MAX mode.** Higher-priced "max" variant of each model that gives the model a larger context window and more tool-call budget. Required for Cloud Agents; adds a ~20% surcharge per run [source: https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips].

**BYOK.** Cursor's "Custom Models" feature lets you plug in any OpenAI-compatible endpoint with your own API key. When BYOK is active, Cursor bypasses its proxy and routes directly to the provider — meaning Cursor doesn't charge you for those tokens, but you lose Cursor's caching/proxy optimizations and the included monthly credits. BYOK billing is between you and the upstream provider [source: https://markaicode.com/cursor-custom-ai-models-claude-gemini-deepseek/].

**Tier-gating.** All paid tiers; Hobby has limited models.

---

## 13. Cloud Agents / Background Agents

**What it does.** Long-running agents that clone your repo into a Cursor-managed cloud VM, work on a task asynchronously, and open a PR or report results when done [source: https://cursor.com/blog/cursor-3]. Useful for big refactors, dependency upgrades, or tasks you want running while your laptop is closed.

**Triggered by.** (1) Inside Cursor, prefix a message with `&` in CLI or click "Run in cloud" in the Agents Window. (2) From the Cursor mobile/web app at cursor.com/agents. (3) Via Jira ticket assignment (May 19, 2026 integration — assign a ticket to a Cursor user with Rovo enabled, agent picks it up) [source: https://cursor.com/changelog]. (4) Via Automations (no-repo automations introduced May 20, 2026 — agents triggered by external signals).

**Environments.** Configured via Dockerfile or via Cursor's UI. May 13, 2026 update added multi-repo environment configuration, build secrets support, version history with rollback, and audit logging. Cached builds 70% faster [source: https://cursor.com/changelog].

**Parallel agents.** Cursor 3's Agents Window runs up to 8 agents in parallel across isolated Git worktrees. Cursor 3.2 added `/multitask` to spawn async sub-agents in parallel rather than serializing tool calls [source: https://futurumgroup.com/insights/cursor-3-2-reframes-the-ide-as-an-agent-execution-runtime/].

**Pricing.** Cloud Agents bill separately from base subscription credits. Requires MAX mode (20% surcharge). One run on a 50k-line codebase ≈ 22.5% of a $20/month credit pool, per third-party analysis [source: https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips].

**Tier-gating.** Pro and above. Cursor 3.5 (May 20, 2026) shipped a 50% discount on agent runs for newly-created automations for a 7-day promo period.

---

## 14. Bug Finder / Bugbot

**What it does.** Bugbot is Cursor's automated PR reviewer. It scans new pull requests on GitHub, comments on potential issues, and can autofix them by spawning a Cloud Agent [source: https://cursor.com/bugbot].

**When it runs.** On every new PR (configurable). Bugbot does *not* scan on save or on commit — only on PR creation/update. Currently GitHub-only as of April 2026.

**Effort levels.** Introduced May 11, 2026: **Default** (finds ~0.7 bugs per review), **High** (~0.95 bugs per review), **Custom** (plain-English rules for when each mode triggers) [source: https://startdebugging.net/2026/05/cursor-bugbot-effort-levels-pr-review/].

**Reported accuracy.** Cursor claims a 70%+ resolution rate and 0.5 resolved bugs per PR on average (up from 0.2 at launch). They use an 8-pass majority voting system to suppress false positives. >79% of flagged issues in Default mode are resolved before merge [source: https://cursor.com/blog/may-2026-bugbot-changes].

**Bugbot Rules + Learned Rules.** Bugbot supports custom rule files that define coding standards and project-specific guidelines. "Learned Rules" automatically derive new rules from developer reactions (downvotes, replies, human reviewer comments); candidates become active once they accumulate enough signal.

**Bugbot Autofix.** A flagged issue can be one-click-fixed by spinning up a Cloud Agent that opens a PR with the fix.

**Pricing.** Recently moved from $40/seat/month subscription to usage-based billing. Average run costs $1.00–$1.50 depending on PR size [source: https://cursor.com/blog/may-2026-bugbot-changes].

**Tier-gating.** Available Pro and above with usage-based billing; Teams/Enterprise can also surface a separate Security Review agent.

**Known complaints.** "Only on GitHub" — no GitLab/Bitbucket support yet. Costs can stack up on monorepos with many small PRs.

---

## 15. Terminal AI / Composer Terminal

**What it does.** Cursor's integrated terminal supports natural-language → shell-command translation. Inside the terminal, press `Cmd+K` / `Ctrl+K`, type a description ("kill the process on port 3000"), and Cursor generates the shell command [source: https://cursor.com/docs/cmdk/terminal-cmdk].

**Confirmation flow.** Generated command appears editable; press `Cmd+Return` to execute, `Esc` to dismiss, or just `Return` to accept the command into the shell without executing.

**Shells supported.** Bash, zsh, fish, PowerShell, cmd.exe — Cursor respects your shell config.

**Agent terminal use.** Agent mode uses the terminal autonomously: package installs, builds, tests, dev servers, runtime diagnostics. The agent reads terminal output and reacts. The Cursor docs page on the terminal tool details how the agent decides to run commands, ask for confirmation, or auto-execute based on safety.

**Tier-gating.** Cmd-K in terminal is available all tiers. Agent's autonomous terminal use is Pro and above.

---

## 16. Notepad / Scratchpad / Memories

**What it does (legacy).** Notepads were persistent text documents stored in the workspace sidebar, referenced via `@notepad/name` in any chat. Used for storing prompt templates, architectural decisions, API contracts, and planning artifacts.

**Deprecation.** Cursor deprecated Notepads at the end of October 2025 [source: https://forum.cursor.com/t/deprecating-notepads-in-cursor/138305].

**Replacement: Memories.** A persistent knowledge base the AI maintains automatically across sessions. It learns your conventions and project preferences. Two ways to use it: (1) seed manually via `Settings > Features > Memories` and add entries; (2) tell the AI in chat to remember something, and it self-records [source: https://forum.cursor.com/t/deprecating-notepads-in-cursor/138305].

**Memories vs. Rules.** Memories are agent-learned and editable; Rules are user-authored and authoritative. Recommended practice: rules for hard standards, memories for soft preferences.

**Community pushback.** Many users dislike the deprecation because Memories is auto-managed and less explicit than Notepads. A third-party extension reimplements Notepads-style behavior [source: https://github.com/LCH-1/cursor-notepads].

**Tier-gating.** Memories available all paid tiers.

---

## 17. Inline Code Completion vs. Tab

These are *the same thing* in Cursor's vocabulary. "Tab" is the brand name for Cursor's inline code completion — the Fusion-powered, multi-line, jump-capable predictive engine. Cursor doesn't expose a separate "inline completion" toggle that runs a different model. The legacy VS Code inline completion API surface is still available for extensions, but Cursor's first-party completion provider replaces the default.

---

## 18. Privacy Mode / Local Mode / Ghost Mode

**Privacy Mode.** A toggle in `Settings > General > Privacy Mode`. When on, Cursor enforces Zero Data Retention (ZDR) with model providers via contractual + technical controls. Code data is not stored long-term by upstream providers (OpenAI, Anthropic, etc.) and is not used for training [source: https://cursor.com/data-use]. Cursor itself may still cache some code temporarily to power features.

**How does this work if the LLM must see the code?** ZDR doesn't prevent transmission — it prevents *retention*. Code is sent to the provider for inference, processed in memory, response returned, no logging on the provider side. Anthropic and OpenAI both honor these ZDR contracts for Cursor [source: https://cursor.com/security].

**Ghost Mode.** The strictest setting. Per Cursor's docs, Ghost Mode is positioned as a "Local / No-Storage Mode" with zero data leaving the machine for indexing/caching beyond the inference call itself. Embeddings and indices stay local. (Practically this trades off some features — features that depend on Cursor's server-side index do not work, and inference still requires sending code to the upstream LLM unless a local model is configured.) [source: https://stevekinney.com/courses/ai-development/cursor-ghost-mode]

**Local model support.** Cursor doesn't ship a first-party local-LLM mode, but BYOK supports any OpenAI-compatible endpoint, so users can route to local servers like LM Studio, Ollama (via compat layers), or vLLM.

**Tier-gating.** Privacy Mode available all tiers. Enterprise gets org-wide enforced privacy controls + audit logs.

---

## 19. Tab in Non-Code Contexts

Cursor's Tab is primarily trained on code. It works in supported language contexts (JS/TS, Python, Rust, Go, Java, etc.) and SQL, YAML, TOML, JSON to varying degrees.

**Markdown / plain text.** Forum reports state Tab is unreliable or broken in Markdown across multiple recent versions — suggestions show as ghost text but Tab doesn't accept them, or accepts them as cursor moves instead of insertions [source: https://forum.cursor.com/t/tab-key-autocompletion-unavailable-in-markdown/91666]. Jupyter Markdown cells: similar issue.

**JSON.** Works for code-shaped JSON (e.g., editing `package.json`, MCP configs). Less reliable for arbitrary data files.

**Plain text.** Mostly non-functional. Cursor's Tab is "predict the next *edit*" rather than "predict the next *word*" — without code structure to anchor on, it falls back to nothing.

This is a known weakness vs. GitHub Copilot, which is happier in mixed contexts because it runs a more general LM.

---

## 20. Image Input / Vision

**What it does.** You can paste a screenshot into Chat or Composer; the model receives the image alongside the text prompt and (with a vision-capable model selected) reasons over it [source: https://forum.cursor.com/t/attach-screenshots-images-in-composer/13656]. Common workflow: paste a UI bug screenshot, ask Composer to diagnose and fix it; paste a Figma export, ask Composer to implement it.

**Models that support it.** Vision works when the selected model is multimodal — Claude Sonnet/Opus, GPT-4o/GPT-5, Gemini variants. Composer 2 / 2.5 base (Kimi K2.5) handles images per Cursor's blog notes; the Tab and Apply models are text-only.

**Visual Editor integration.** As of Cursor 2.2 (December 2025), screenshots tie into the Visual Editor (see §22) — you can paste a design, and the agent locates the relevant components to update [source: https://cursor.com/blog/browser-visual-editor].

**Known issues.** Forum reports of being limited to one image per Composer message in 0.46 (still occasionally cited in 2026) [source: https://forum.cursor.com/t/0-46-cant-paste-multiple-screenshots-in-composer/53095].

**Tier-gating.** Available wherever vision models are; counts toward usage credits like text tokens.

---

## 21. Account Features

**Sign-in.** Google OAuth, GitHub OAuth, email + password, and SSO (SAML/OIDC) for Teams/Enterprise.

**Settings sync.** Cursor syncs user settings (theme, keybindings, extensions, custom instructions) across machines via the Cursor account. Powered by the underlying VS Code settings-sync mechanism, but routed through Cursor's backend.

**Team workspaces (Teams plan, $40/user/mo).** Shared chat templates, shared rules, shared custom modes, shared MCP configurations, team-wide automations, security review agent, team plugin/MCP marketplace, usage analytics, centralized billing, org-wide privacy mode controls, role-based access control [source: https://cursor.com/pricing].

**SSO.** SAML 2.0 + OIDC. Supports Okta, Microsoft Entra ID, Google Workspace, others [source: https://cursor.com/docs/account/teams/sso].

**SCIM.** SCIM 2.0 for user provisioning/deprovisioning [source: https://cursor.com/docs/account/teams/scim].

**Enterprise extras.** Pooled usage across the org, invoice billing, AI code tracking API, granular admin and model controls (block specific models per role), audit logs, MDM policies, priority support [source: https://cursor.com/pricing].

**Machine-to-machine config (MDM).** Enterprise admins can push configuration via MDM policies — locking model selection, privacy mode, MCP allowlists.

**Dashboard.** Per-user and per-team usage dashboards, billing, member management — accessible at cursor.com.

---

## 22. The IDE Shell Itself

**Foundation.** Cursor is a fork of VS Code's OSS codebase. Most VS Code extensions install via the Open VSX marketplace work in Cursor. Keybindings, terminal integration, debugger UI, source-control UI, settings JSON — all identical at the base level [source: https://www.morphllm.com/comparisons/cursor-vs-vscode].

**Default theme.** Cursor ships "Anysphere Dark" as the default — a slightly warmer, lower-contrast take on Dark+. Users can switch to standard VS Code themes any time.

**Default sidebar layout.** Cursor 3 reorients the activity bar *horizontally at the top of the sidebar* rather than VS Code's traditional vertical strip on the far left. Settable via `Workbench > Activity Bar: Orientation` back to vertical [source: https://medium.com/@ssuuribaatar/replicating-the-vs-code-experience-in-cursor-a-guide-to-customizing-your-ui-f0071c55953a].

**Cursor-specific panels and surfaces:**
- **Agents Window** (Cursor 3, April 2026) — full-screen workspace for running multiple agents in parallel across worktrees, cloud environments, and remote SSH targets [source: https://cursor.com/changelog/3-0].
- **Visual Editor / Design Mode** (Cursor 2.2 Dec 2025 → expanded Cursor 3) — embedded browser pane that renders your dev server, lets you drag/drop UI, inspect components, tweak styles with sliders/color pickers, then asks the agent to apply changes back to the source [source: https://cursor.com/blog/browser-visual-editor].
- **Browser tool** — integrated headless/headful browser the agent uses for navigation, screenshots, and visual checks [source: https://cursor.com/docs/agent/tools/browser].
- **Worktrees panel** — manage Git worktrees for isolated agent runs [source: https://cursor.com/docs/configuration/worktrees].
- **Marketplace** (Cursor 3) — discover and install MCPs, automation templates, and skills [source: https://cursor.com/blog/cursor-3].
- **Automations panel** (Cursor 3.5, May 20, 2026) — recurring/event-triggered agent jobs, including no-repo automations triggered by external signals (Slack messages, webhooks, schedules) [source: https://cursor.com/changelog].
- **PR tabs / full-screen tabs** (Cursor 3.4, May 13, 2026) — focused workspace tabs for individual review items [source: https://cursor.com/changelog].
- **Compact chat responses** (Cursor 3.4) — adjustable tool-call density in chat output for less clutter.

**CLI (`cursor-agent`).** Separate from the GUI: a terminal-driven agent at `cursor` command, with `/plan`, `/ask`, `/multitask`, `/mcp list` commands, web/fetch/search tools, and Cloud Agent handoff via the `&` prefix [source: https://cursor.com/docs/cli/overview].

**What's not from VS Code.** The Tab engine, the multi-agent Agents Window, Composer, the Apply model, Cursor's own Composer 2.5 model, the Visual Editor, the Cursor browser, the MCP installer UI, the Bugbot dashboards, the cloud-VM environments. The chrome around all of this is Cursor's, not Microsoft's.

---

## Cross-cutting: Known Complaints (Recurring Themes)

Compiled from forum + reviews [sources: https://checkthat.ai/brands/cursor/reviews, https://www.aitooldiscovery.com/guides/cursor-reddit]:

1. **Costs creep.** The advertised $20/mo Pro tier commonly costs users $40–50 once Cloud Agents, Bugbot, and overages factor in.
2. **Breaking updates.** Cursor 2.1 (Nov 2025) reportedly corrupted chat histories and worktrees; multiple releases have shipped with Tab regressions on Markdown.
3. **Aggressive autonomous edits.** Agent occasionally edits unrelated files or fabricates summaries of what it changed.
4. **Frequent update nags.** Cursor prompts updates almost daily, requiring restart and breaking in-editor dev servers.
5. **Context selection misses.** On very large codebases, retrieval sometimes pulls irrelevant chunks and the agent misses the right file.
6. **UI churn.** Cursor 3 reorganized the workspace significantly; long-time users object to lost familiarity.
7. **GitHub-only Bugbot.** No GitLab/Bitbucket support yet.
8. **Notepad deprecation.** Memories is auto-managed and less predictable than Notepads.

---

## Cross-cutting: Tier Summary

| Feature | Hobby ($0) | Pro ($20) | Pro+ ($60) | Ultra ($200) | Teams ($40/user) | Enterprise (custom) |
|---|---|---|---|---|---|---|
| Tab | Limited | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |
| Agent / Composer | Limited | Extended | 3x Pro | 20x Pro | Pro + shared | Pooled |
| Frontier models | Limited | Yes | Yes | Yes | Yes | Yes + admin controls |
| MCP | No | Yes | Yes | Yes | Yes + team marketplace | Yes + allowlist |
| Cloud Agents | No | Usage-based | Usage-based | Usage-based | Usage-based | Usage-based |
| Bugbot | No | Usage-based | Usage-based | Usage-based | Usage-based + Security Review | Custom |
| BYOK | No | Yes | Yes | Yes | Yes | Yes |
| Privacy Mode | Yes | Yes | Yes | Yes | Yes + org enforcement | Yes + audit |
| SSO / SCIM | No | No | No | No | Yes (SAML/OIDC) | Yes + SCIM + MDM |
| Custom modes | Yes | Yes | Yes | Yes | Shared | Shared + admin |
| Memories | Yes | Yes | Yes | Yes | Yes | Yes |

Annual billing saves 20% across paid tiers.

---

## Sources

- [Cursor Docs](https://cursor.com/docs)
- [Cursor Changelog](https://cursor.com/changelog)
- [Cursor Pricing](https://cursor.com/pricing)
- [Cursor Tab Product](https://cursor.com/product/tab)
- [Tab Update — Fusion model](https://cursor.com/blog/tab-update)
- [Composer 2 Technical Report](https://cursor.com/blog/composer-2-technical-report)
- [Improving Agent with Semantic Search](https://cursor.com/blog/semsearch)
- [Securely Indexing Large Codebases](https://cursor.com/blog/secure-codebase-indexing)
- [Inline Edit Overview](https://cursor.com/docs/inline-edit/overview)
- [Codebase Indexing Docs](https://cursor.com/docs/context/codebase-indexing)
- [MCP Docs](https://cursor.com/docs/mcp)
- [Rules Docs](https://cursor.com/docs/rules)
- [Agent Overview](https://cursor.com/docs/agent/overview)
- [Terminal Tool](https://cursor.com/docs/agent/tools/terminal)
- [Browser Tool](https://cursor.com/docs/agent/tools/browser)
- [Data Use & Privacy](https://cursor.com/data-use)
- [Security](https://cursor.com/security)
- [Bugbot](https://cursor.com/bugbot)
- [Bugbot Changes May 2026](https://cursor.com/blog/may-2026-bugbot-changes)
- [Cursor 3 launch post](https://cursor.com/blog/cursor-3)
- [CLI overview](https://cursor.com/docs/cli/overview)
- [Visual Editor blog](https://cursor.com/blog/browser-visual-editor)
- [SSO docs](https://cursor.com/docs/account/teams/sso)
- [SCIM docs](https://cursor.com/docs/account/teams/scim)
- [Notepads deprecation thread](https://forum.cursor.com/t/deprecating-notepads-in-cursor/138305)
- [Inline edit not using rules](https://forum.cursor.com/t/inline-ai-editor-cmd-k-not-using-cursor-commands/137197)
- [Tab broken in markdown](https://forum.cursor.com/t/version-0-46-tab-does-not-work-with-markdown-files/57340)
- [Disable Apply model thread](https://forum.cursor.com/t/diff-mode-tools-disable-apply-model/70957)
- [Cursor Reviews — CheckThat.ai](https://checkthat.ai/brands/cursor/reviews)
- [Cursor 3.2 — Futurum](https://futurumgroup.com/insights/cursor-3-2-reframes-the-ide-as-an-agent-execution-runtime/)
- [How Cursor Indexes Codebases — TDS](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [How Cursor Implemented Instant Apply — Bind AI](https://blog.getbind.co/2024/10/02/how-cursor-ai-implemented-instant-apply-file-editing-at-1000-tokens-per-second/)
- [MCP Setup in Cursor — TrueFoundry](https://www.truefoundry.com/blog/mcp-servers-in-cursor-setup-configuration-and-security-guide)
- [Context Management — Datalakehousehub](https://datalakehousehub.com/blog/2026-03-context-management-cursor/)
- [Cursor Rules Guide — Medium](https://medium.com/@vibecodingdirectory/how-to-structure-cursor-rules-in-2026-the-5-level-system-cursor-rules-eaf0df16e8e7)
- [Cursor pricing breakdown — Finout](https://www.finout.io/blog/what-happened-to-cursor-pricing-2026-guide-5-cost-cutting-tips)
- [Composer 2.5 review — BuildFastWithAI](https://www.buildfastwithai.com/blogs/cursor-composer-2-5-review-2026)
- [Practical Guide to Cursor Pt 2 — Medium](https://medium.com/@xitvali/a-practical-guide-to-cursor-part-2-13aadecf1f49)
