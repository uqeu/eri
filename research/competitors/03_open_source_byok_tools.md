# Open-Source / BYOK Escape Hatches: Continue.dev, Cline, Roo Code, PearAI (May 2026)

When Cursor users get frustrated — by Composer-only Agent mode, locked-out BYOK keys, surprise overage bills, no on-prem path — they don't typically go back to Copilot. They leave for one of four open-source projects: **Continue.dev**, **Cline**, **Roo Code** (now its community fork **Zoo Code**), and **PearAI**. All four are Apache 2.0 or MIT, all four respect BYOK, and all four support local models out of the box. This brief is a deep look at each, followed by the cross-cutting patterns and the implications for eri's positioning.

---

## 1. Continue.dev

### 1.1 What it is, who makes it, license

Continue is an open-source AI coding platform that began life as a single VS Code extension in 2023 and has since expanded into a multi-IDE platform plus a CLI and a managed "Continue Hub." It is maintained by **Continue Dev, Inc.**, a US-incorporated company that raised seed and Series A funding through 2024–2025 and has roughly 25 named contributors plus a long tail of community PRs. The entire core codebase ships under the **Apache 2.0** license [source: https://github.com/continuedev/continue].

As of May 2026 the GitHub repo carries **33.3k stars**, ~6k forks, ~822 tagged releases, and 21,498 commits on main — making it one of the highest-velocity open-source dev-tools projects of its generation [source: https://github.com/continuedev/continue].

### 1.2 Architecture

Continue is built as a **thin universal frontend** (VS Code extension, JetBrains plugin, a Neovim plugin, and the `cn` CLI) on top of a **shared TypeScript core** that owns provider routing, retrieval, indexing, MCP, tool execution, and agent state. The architecture deliberately keeps the editor surface pluggable so the same agent logic runs identically across IDEs and headless CI environments. The codebase is ~84% TypeScript with smaller Kotlin (IntelliJ), Python (CLI tooling), and Rust (indexing primitives) layers [source: https://github.com/continuedev/continue].

In **mid-2025 Continue executed a major pivot**: it stopped marketing itself primarily as a "Copilot alternative" and re-framed itself as a "Continuous AI" platform — a CI system that runs source-controlled AI checks on every pull request. Each check is a markdown file in `.continue/checks/` that becomes a full GitHub status check, executed by a Continue agent with file-read, file-write, bash, and browser tool access [source: https://github.com/continuedev/continue] [source: https://weavai.app/blog/en/2026/04/24/continue-dev-2026-review-open-source-ai-coding-ci/]. The IDE extensions still exist and ship weekly, but the company's commercial story now centers on the CI/Hub stack.

### 1.3 Feature set

Inside the IDE, Continue offers four interaction modes:

- **Chat** — sidebar conversation with retrieval over the open repo
- **Edit** — inline diff applied to the current selection
- **Autocomplete** — Tab/ghost-text completions
- **Agent** — multi-step task execution with tool use (file I/O, bash, browser, MCP)

Continue added **MCP support** in mid-2025 and was one of the first non-Anthropic tools to ship it. Two new MCP transports — **Server-Sent Events** and **Streamable HTTP** — landed in early 2026, enabling remote MCP server hosting [source: https://docs.continue.dev/customize/deep-dives/mcp]. Configuration moved to a directory-based model (`.continue/mcpServers/`, `.continue/rules/`, `.continue/checks/`, `.continue/agents/`) so every aspect of the assistant is version-controlled alongside the code.

**Continue Hub** is the managed layer: a web UI ("Mission Control") where teams share agents, rules, MCPs, and prompts; a TUI; and a headless mode for CI. Agents created in the Hub can be invoked from the IDE, from the CLI, or as PR checks [source: https://docs.continue.dev/hub/agents/overview].

### 1.4 BYOK story

BYOK is Continue's **default and recommended** configuration. The `config.yaml` (or new model blocks) accepts API keys for Anthropic, OpenAI, Azure OpenAI, Google Gemini, AWS Bedrock, GCP Vertex, xAI, Mistral, DeepSeek, Groq, Fireworks, Together, OpenRouter, and any OpenAI-compatible endpoint. Keys are stored in the local OS keychain and never leave the user's machine when using the free Solo tier [source: https://docs.continue.dev/].

For teams, the **Continue Hub Proxy** acts as a server-side key vault: admins paste keys once, developers reference them by name, and individual developers never see the secret. Allow/deny lists govern which models each developer or team can call [source: https://www.continue.dev/pricing].

### 1.5 Local model support

Continue ships first-class adapters for **Ollama** (auto-discovers `localhost:11434`), **LM Studio** (OpenAI-compatible endpoint on `localhost:1234`), **vLLM**, **llama.cpp server**, and **Text Generation WebUI**. There is a recommended "local-only" config that wires Ollama for chat (e.g., Qwen 3 Coder, DeepSeek V3.x distill, Granite 4 Code) and a smaller in-tree completion model for autocomplete; this stack runs fully offline [source: https://docs.continue.dev/guides/ollama-guide] [source: https://localaimaster.com/blog/continue-dev-ollama-setup].

### 1.6 Pricing

Three tiers as of May 2026 [source: https://www.continue.dev/pricing]:

- **Solo — $0**: full IDE features, BYOK, local models, MCP, no team features
- **Starter — pay-as-you-go at $3/M tokens**: hosted frontier-model inference, agent creation, Slack/Sentry/Snyk integrations
- **Team — $20/seat/month** with **$10 credits/seat**: shared private agents, usage controls, Google/GitHub SSO, key proxy
- **Company — custom**: SAML/OIDC SSO, BYOK at the proxy layer, SLA, invoiced billing

The Solo tier is **genuinely free forever** for individual developers — no usage cap, no feature gate — provided the user brings their own keys or local models.

### 1.7 Adoption

33.3k GitHub stars; the VS Code Marketplace listing shows ~3.5M installs across IDE plugins; the JetBrains Marketplace shows roughly 500k downloads. Continue is the **most-installed open-source coding assistant on the VS Code Marketplace** outside Copilot itself, and the most-cited alternative in Cursor-departure threads on Hacker News and r/cursor [source: https://marketplace.visualstudio.com/items?itemName=Continue.continue].

### 1.8 Strengths

- Cleanest BYOK story of the four; every provider works without ceremony
- Strongest enterprise key-vault story (Hub proxy + allow/deny lists)
- MCP-native; one of the earliest non-Anthropic implementations and the only one with SSE + Streamable HTTP transports as of May 2026
- True multi-IDE support — VS Code, JetBrains, Neovim — with a single config
- The "AI checks as markdown files in the repo" model is genuinely novel and a real wedge into the CI market
- Apache 2.0 with no CLA gotchas

### 1.9 Weaknesses

- Agent mode is **less aggressive and less polished** than Cline or Roo's; long autonomous loops feel under-baked
- The mid-2025 CI pivot has made the in-IDE roadmap feel deprioritized — some 2026 user reports describe the IDE plugin as "stable but stagnant"
- No proprietary completion or edit model — autocomplete relies on whatever the user brings, which is often noticeably worse than Cursor's Tab or Copilot's GPT-5.x completion
- The configuration surface is wide (Hub, rules, checks, agents, MCP, models) and onboarding documentation has not kept pace
- No native voice or multi-modal interface

---

## 2. Cline

### 2.1 What it is, who makes it, license

Cline is an **autonomous coding agent** that runs as a VS Code sidebar (and now JetBrains, plus a standalone CLI/SDK). It started in mid-2024 as "Claude Dev," a side project by Saoud Rizwan; was rebranded to Cline in late 2024; and is now developed by **Cline Bot, Inc.** with a seed round and ~30 contributors. License is **Apache 2.0** [source: https://github.com/cline/cline].

As of May 23, 2026 the repo shows **62.2k GitHub stars**, ~6.5k forks, and a marketplace install count north of **5 million** — making Cline the most-installed pure-agent extension on VS Code, ahead of every Cursor-refugee competitor [source: https://github.com/cline/cline] [source: https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev].

### 2.2 Architecture

Cline started as a sidebar webview inside VS Code that called Anthropic's API directly. In early 2026 the team **rebuilt the entire agent runtime as `@cline/sdk`** — a modular TypeScript stack (`@cline/shared` for types, `@cline/llms` for provider routing, `@cline/agents` for the stateless agent loop, `@cline/core` for stateful orchestration). The IDE extension, the new CLI, and any third-party integration now compose on top of the same SDK [source: https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime].

The CLI (`npm i -g cline`, currently v3.0.13) runs the same agent loop in a terminal, supports headless CI/CD execution, and ships a **Kanban-style UI for tracking multiple parallel agents running on the same machine** [source: https://cline.bot/cli] [source: https://www.npmjs.com/package/cline]. This makes Cline the first of the four to credibly target the "Claude Code / Codex CLI" surface area as well as the IDE.

### 2.3 Feature set

- **Plan / Act modes** — Plan is a read-only exploration phase where the agent surveys the codebase and proposes a step-by-step approach; Act executes against approval gates. Model preferences are stored per-mode and persist across sessions [source: https://docs.cline.bot/core-workflows/plan-and-act]
- **Checkpoints** — Cline maintains a **shadow Git repository** and commits after every tool call. Three restore modes (Files Only, Task Only, Files + Task) let users rewind individual edits without polluting the user's main Git history [source: https://cline.bot/blog/how-i-learned-to-stop-course-correcting-and-start-using-message-checkpoints]
- **Computer Use** — a controlled browser instance (Puppeteer-driven) that lets the agent verify its own UI work, fill forms, scrape docs, and run E2E flows
- **Terminal execution** — bash/zsh/pwsh with real-time stdout streaming and approval gates per command
- **MCP** — full MCP client plus a curated **MCP Marketplace** with one-click install for databases, Slack, Linear, GitHub, Sentry, and ~150 community servers
- **.clinerules/** — per-project rule files (markdown) with conditional activation, similar to Cursor Rules but version-controlled by default
- **Multi-agent teams** — coordinate specialist subagents with shared state and handoff notes
- **Scheduled agents** — cron-style recurring tasks (dependency upgrades, daily PR summaries)

### 2.4 BYOK story

Cline is **BYOK-first by ideology**. The provider list crossed **30 in 2026**: Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure OpenAI, GCP Vertex, OpenRouter (which itself fronts ~200 models), Cerebras, DeepSeek, Moonshot, Alibaba Qwen, xAI Grok, Mistral, Groq, Fireworks, Together, Baseten, SambaNova, Nebius, Hugging Face, and several OpenAI-compatible endpoints [source: https://docs.cline.bot/api/models]. Keys live in the local secret store; nothing routes through Cline's servers in BYOK mode.

A managed **Cline Provider** (accessed via `app.cline.bot`) offers pay-as-you-go inference for users who don't want to manage keys themselves — but it's optional, not the default.

### 2.5 Local model support

Cline supports **Ollama, LM Studio, llama.cpp server**, and any OpenAI-compatible endpoint out of the box. Crucially, the agent loop's tool-use schema is **provider-aware**: when Cline detects a local model that doesn't reliably emit Anthropic-style tool calls, it falls back to a structured XML format that smaller open-weight models can produce more reliably. This is the difference between "local model works in chat" and "local model works in agent mode," and Cline does the latter better than any of the other three [source: https://www.deployhq.com/guides/cline].

### 2.6 Pricing

Two SKUs [source: https://cline.bot/pricing]:

- **Open Source — $0**: VS Code + JetBrains + CLI, full feature set, BYOK or Cline Provider pay-as-you-go
- **Enterprise — custom**: SSO/OIDC, SLA, dedicated support, centralized billing, RBAC, authentication logging, inference-provider allow lists

There is **no $20/month "Pro" tier**. Cline's bet is that the extension itself remains permanently free and the company monetizes through Enterprise + the optional managed Cline Provider inference markup.

### 2.7 Adoption

- **62.2k GitHub stars** (highest of the four; second-highest of any open-source coding assistant after VS Code itself)
- **5M+ installs** on the VS Code Marketplace
- **3.81+** current extension version, with weekly releases
- Heavy mindshare on Hacker News, r/LocalLLaMA, r/cursor, and Addy Osmani's newsletter cited it as his daily driver in late 2025

### 2.8 Strengths

- Best-in-class **autonomous agent mode** — most "Cursor refugee" threads call out Cline specifically as the place where agents actually finish tasks
- Plan/Act split is genuinely useful and copied by Roo, Zoo, and several proprietary tools
- Checkpoints + shadow Git are the safest "let it run" UX in the category
- Computer Use makes UI-verification loops viable
- The SDK + CLI + Kanban combination credibly extends Cline into the headless / parallel-agent space (vs. Claude Code's CLI)
- Aggressive transparency: every tool call is shown, every file diff approved, no "magic" steps

### 2.9 Weaknesses

- **Token consumption is brutal** without diff-based editing — Cline rewrites entire files instead of emitting diffs, which costs 3–10× more tokens than Roo/Zoo on the same task. This is the single most-cited complaint in 2026 reviews [source: https://www.morphllm.com/comparisons/roo-code-vs-cline]
- No inline edit / Tab completion — Cline is **agent-only**; users who want Copilot-style inline completion still need a second extension (often Continue)
- Heavy approval-gate friction on long tasks; "Auto-approve" exists but is criticized as unsafe
- Multi-agent / teams feature is newer and less battle-tested than the single-agent loop
- No proprietary model — performance is whatever the user's BYOK provider gives

---

## 3. Roo Code → Zoo Code

### 3.1 What it is, who makes it, license

Roo Code began in late 2024 as **Roo Cline**, a community fork of Cline by developer Matt Rubens and collaborators. It rebranded to **Roo Code** in early 2025, raised a small seed round, and built a managed cloud layer (Roo Code Cloud, Roo Code Router) on top of the open-source extension. License: **Apache 2.0** [source: https://github.com/RooCodeInc/Roo-Code].

**On April 21, 2026, Matt Rubens announced Roo Code's shutdown.** The VS Code extension, cloud, and router all went offline **May 15, 2026** (eight days before this brief was written). The repo is now archived and read-only. Roo Code peaked at **~24.1k GitHub stars and 3M+ installs** [source: https://github.com/RooCodeInc/Roo-Code] [source: https://www.bodegaone.ai/blog/roo-code-shutdown-alternatives].

The reason cited by Rubens: he and his team had concluded that **IDEs are not the future of coding**. The company is going all-in on **Roomote**, a cloud-based agent that takes Slack/Linear/GitHub tasks and produces PRs end-to-end with no IDE in the loop [source: https://thenewstack.io/roo-code-cloud-ides-ai-coding/] [source: https://roomote.dev/] [source: https://en.theblockbeats.news/flash/342460].

The community responded immediately with **Zoo Code**, a friendly fork by ex-Roo contributors that promises to keep the IDE extension alive. Same Apache 2.0 license, same `.roo/` config compatibility, same five-mode system. Zoo Code is live at `zoocode.dev` and `github.com/Zoo-Code-Org/Zoo-Code` [source: https://www.zoocode.dev/] [source: https://github.com/Zoo-Code-Org/Zoo-Code/]. Kilo Code is another fork that picked up some former Roo users via a published migration guide [source: https://kilo.ai/articles/roo-to-kilo-migration-guide].

### 3.2 Architecture

Same broad shape as Cline (VS Code sidebar webview, TypeScript core) but with **diff-based editing** as the primary edit primitive — when the agent wants to change a file it emits a unified diff, not a rewrite. This single change is the source of Roo's headline efficiency gains (~30% token savings on routine tasks, up to 75% combined with plan-mode caching) [source: https://www.morphllm.com/comparisons/roo-code-vs-cline].

### 3.3 Feature set

The defining feature was the **multi-mode system** [source: https://github.com/RooCodeInc/Roo-Code]:

- **Code** — routine implementation work
- **Architect** — planning, specs, migrations, system design
- **Ask** — knowledge retrieval and Q&A without file edits
- **Debug** — issue investigation with logging and instrumentation
- **Custom Modes** — user-defined personas with scoped tool permissions and custom prompts

Each mode could whitelist or blacklist specific tools (e.g., Architect mode could read files but not write them), which prevented accidental edits during planning. A community **Mode Gallery** shared specialized modes for security review, doc generation, refactoring, etc.

Other features inherited from Cline and extended: MCP, checkpoints, `.roo/rules/`, terminal, browser use. Roo added **cloud agents** (run the same agent remotely from a web UI), **Roo Code Router** (managed model proxy with caching and fallback), and team settings sync.

### 3.4 BYOK story

Identical providers list to Cline (because Roo forked the provider layer), plus the optional Roo Code Router. BYOK was the default; the Router was opt-in.

### 3.5 Local model support

Same as Cline — Ollama / LM Studio / OpenAI-compatible. Diff-based editing materially helped local models, because small open-weight coders are dramatically better at emitting a 10-line diff than rewriting a 500-line file.

### 3.6 Pricing (historical)

Open-source extension was free. Roo Code Cloud + Router were tiered with a free entry tier and paid plans starting around $20/month. All of this is **now defunct** as of May 15, 2026. Zoo Code is donation-funded and fully free.

### 3.7 Adoption (peak)

24.1k stars, 3M+ installs, 281 releases. Significant overlap with Cline's user base — many users had both installed. Post-shutdown, the migration paths most commonly cited are **Cline (back to the parent), Zoo Code (community fork), and Kilo Code (alternative fork)** [source: https://cursor-alternatives.com/blog/roo-code-rules/].

### 3.8 Strengths (Roo at peak)

- **Diff-based editing** — concrete 30–75% cost reduction vs. Cline on identical tasks
- **Multi-mode system with scoped tool permissions** — the cleanest planning/execution separation in the open-source category
- Lower friction than Cline (fewer approval gates, faster routine loops)
- Custom Modes + Mode Gallery built a real community ecosystem

### 3.9 Weaknesses

- **The most important weakness is now existential**: the original project is gone. Anyone choosing Roo Code in May 2026 is actually choosing Zoo Code (community-maintained, smaller team) or Kilo Code (separate fork)
- Even at peak, Roo lagged Cline on Computer Use polish and on the breadth of MCP marketplace integrations
- The cloud product never reached scale before the pivot, suggesting it was undermonetized

### 3.10 What the shutdown signals

Rubens's public reasoning — that IDEs are not the future of coding — is **the most aggressive statement of the "asynchronous agent" thesis to date from a maintainer of a successful IDE extension**. Whether or not he's right, the fact that a 3M-install IDE extension was abandoned for a Slack-bot agent is a data point any IDE-builder should take seriously.

---

## 4. PearAI

### 4.1 What it is, who makes it, license

PearAI is a **VS Code fork** (i.e., a full editor, not an extension) that bundles a forked Continue extension plus integrations with Aider, Perplexity, and other AI tools. It was created by **Duke Pan and Nang Ang**, went through Y Combinator (S24), and became infamous in late 2024 for the **forking controversy** that followed [source: https://github.com/trypear/pearai-app].

The original launch shipped under a homemade "Pear Enterprise License" (drafted by an LLM, in Pan's own admission), which violated Continue's Apache 2.0 terms because Continue contributors had not been attributed and the derivative work was not relicensed compatibly. After public criticism on Hacker News and Twitter — including a viral TechCrunch piece — the license was changed back to **Apache 2.0** for the editor and the relevant submodules [source: https://techcrunch.com/2024/09/30/y-combinator-is-being-criticized-after-it-backed-an-ai-startup-that-admits-it-basically-cloned-another-ai-startup/] [source: https://opensauced.pizza/blog/-pearai-transparency] [source: https://news.ycombinator.com/item?id=41701709].

License today: **Apache 2.0** for the editor (`trypear/pearai-app`) and **Apache 2.0** for the Continue-derived extension (`trypear/pearai-submodule`) [source: https://github.com/trypear/pearai-app].

### 4.2 Architecture

PearAI is a fork of **VS Code** (the OSS Code-OSS distribution) with two main customizations:

1. The bundled **PearAI Submodule**, which is a fork of the Continue extension with PearAI branding and tighter UI integration
2. Out-of-the-box integrations with **Aider** (terminal-based AI pair programming), **Perplexity** (search), and a few other tools, wired through the same sidebar

The supporting stack is **Next.js + Supabase** for the landing and auth, a **Python Flask backend**, and Axiom for observability. The codebase is 95% TypeScript [source: https://github.com/trypear/pearai-app].

GitHub stars on the main editor repo are surprisingly modest — **691 stars, 206 forks** on `trypear/pearai-app` as of May 2026 — far below the other three. The last tagged release on the editor repo is v1.8.9 from May 2025, indicating slower release cadence than its competitors [source: https://github.com/trypear/pearai-app].

### 4.3 Feature set

PearAI positions itself as **"Cursor but free and open-source"** [source: https://trypear.ai/]. Feature surface includes:

- Inline chat and inline prompts (forked from Continue)
- AI chat sidebar (Continue UI)
- AI-enhanced debugging
- The bundled Aider integration for terminal-based pair programming
- A managed router ("PearAI Router") that picks the right model per task

Functionally, this is largely a re-skin of Continue plus glue code to Aider; novel features specific to PearAI are limited.

### 4.4 BYOK story

BYOK is supported via the underlying Continue config (so any provider Continue supports works). The **Intern (Free) tier** is explicitly positioned as BYOK / local-model. The **Maker tier** ($15/mo) shifts you to PearAI's managed router with bundled credits, but BYOK keys can still be configured to spill over once credits run out [source: https://trypear.ai/pricing].

### 4.5 Local model support

Inherited from Continue: Ollama, LM Studio, llama.cpp server, OpenAI-compatible endpoints all work. No PearAI-specific local-model enhancements.

### 4.6 Pricing

- **Intern — $0**: BYOK keys or local models only; full editor; basic features
- **Maker — $15/month**: $15 in monthly credits through PearAI Router for hosted frontier models; pay-as-you-go top-up; BYOK fallback
- **Enterprise — custom**: bulk discounts, centralized billing, dedicated support [source: https://trypear.ai/pricing]

### 4.7 Adoption

- 691 stars on the editor; ~few thousand stars on the submodule
- Direct download distribution (not a Marketplace install); concrete user counts aren't published, but community signal places PearAI well behind the other three
- Heavy YC-affiliated marketing presence; lighter organic developer mindshare

### 4.8 Strengths

- For developers who specifically want a **standalone editor** rather than a VS Code extension, PearAI is the only open-source option in this group that ships as a full app
- The bundled Aider + Continue + Perplexity combo lowers setup friction for newcomers
- Apache 2.0 is now clean and the licensing controversy has been resolved

### 4.9 Weaknesses

- **The forking controversy permanently damaged the brand** with the audience most likely to evaluate it (open-source-aware developers on HN, Reddit, X). It is the single thing every comparison piece mentions [source: https://www.wearefounders.uk/the-pearai-forking-controversy-open-source-or-misleading-clone/]
- The product is materially a re-skin of Continue + Aider; differentiated engineering is hard to point to
- Release cadence is slow (last editor tag from May 2025) compared to Cline (weekly) and Continue (weekly+)
- The "we're an editor not an extension" pitch is also the Cursor pitch, but Cursor has the model fine-tuning, the brand, and the venture funding to actually execute it — PearAI cannot match any of those
- The $15/mo router play is a thin margin: users with Continue + their own OpenRouter key get the same thing for free

---

## 5. Common Patterns Across the Four

Looking across Continue, Cline, Zoo Code (formerly Roo), and PearAI, a clear set of shared principles emerges — these define the "open-source / BYOK escape hatch" category as a whole.

### 5.1 BYOK is non-negotiable

All four respect BYOK at the **feature level**, not just at the chat level. There is no "Agent mode requires our model" gotcha (Cursor's biggest BYOK complaint). Whatever the tool can do with a managed key, it can also do with the user's own Anthropic, OpenAI, OpenRouter, or local-Ollama key [source: https://apidog.com/blog/cursor-byok-ban-alternative/].

### 5.2 Local models are a first-class citizen

Ollama and LM Studio support is **table stakes**, not a checkbox. All four ship pre-baked configs for popular local coders (DeepSeek V3.x, Qwen 3 Coder, Granite 4 Code, Devstral). Cline goes furthest with provider-aware tool-call fallbacks, but all four work in fully air-gapped mode.

### 5.3 Markdown + version control as the configuration substrate

`.continue/`, `.clinerules/`, `.roo/`, `.zoo/` — every one of these projects has converged on the same pattern: assistant behavior lives in markdown files **inside the repo**, version-controlled by Git, reviewable in PRs. This is a sharp contrast to Cursor (which has Rules but defaults to UI-managed) and to Copilot (which has no equivalent at all).

### 5.4 MCP everywhere

All four support Model Context Protocol as the standard extension surface. Continue ships SSE + Streamable HTTP transports; Cline ships a curated marketplace; Roo/Zoo ships custom-mode-scoped MCP permissions. MCP is **the convergence point** for the entire category — every Cursor refugee who builds custom tooling does it via MCP rather than a vendor-specific plugin API.

### 5.5 Transparent, approval-gated UX

The agent loop is **never invisible**. Every tool call is shown, every file diff is reviewable, every bash command can be denied. Auto-approve modes exist but are explicitly opt-in. This is a deliberate counter-position to Cursor's "background agent" UX and to Copilot's "just trust the suggestion" model.

### 5.6 Free for individuals, paid for teams

The monetization shape is identical across all four:

- **Individual developers: $0**
- **Teams: $10–$20/seat/month** for shared configs, SSO, key vaulting
- **Enterprise: custom** for SCIM, audit logs, on-prem options

Nobody in this category charges $20/month per individual developer.

### 5.7 No proprietary model

None of these tools ships a Cursor-style fine-tuned in-house model. They route to commodity providers and let the user pick. This is the **structural advantage** (no model-cost exposure) and the **structural weakness** (no completion-quality moat) of the entire category.

---

## 6. Why Cursor Refugees Pick Which One

Cursor-departure threads on Reddit, Hacker News, and the cursor.community forum show clear sorting behavior — different frustrations lead to different destinations:

### 6.1 Continue.dev — picked by

- **Breadth-seeking enterprise users** — Continue's key-vault, allow-lists, and PR-check story is the most enterprise-coherent of the four
- **Multi-IDE shops** — Continue is the only one that runs identically in VS Code, JetBrains, and Neovim
- **CI/CD-oriented teams** — the "AI checks as markdown files" model is genuinely useful for code review automation
- **Privacy-strict organizations** — Hub Proxy + local-model defaults make the on-prem story believable

### 6.2 Cline — picked by

- **Agent-autonomy seekers** — users who want the agent to actually finish multi-step tasks, not just suggest edits
- **Local-model power users** — the provider-aware tool-call schema makes local agents viable
- **CLI / headless / parallel-agent users** — the SDK + Kanban CLI is uniquely positioned against Claude Code
- **"I'll pay tokens, just give me capability" users** — Cline's defaults skew toward capability over thrift

### 6.3 Roo Code → Zoo Code / Kilo Code — picked by

- **Token-budget-conscious users** — diff-based editing concretely saves money
- **Plan-mode-first users** — the multi-mode system enforces a planning discipline Cline's single mode doesn't
- **Custom-workflow tinkerers** — Custom Modes + Mode Gallery enabled niche workflows
- **Now (post-shutdown)**: this cohort is fragmenting between Zoo Code (continuity), Kilo Code (slightly different fork), and Cline (back to the parent)

### 6.4 PearAI — picked by

- **"I want Cursor but free" users** who specifically value the **standalone editor** form factor
- **Newcomers** who don't want to assemble Continue + Aider + a provider key themselves
- A small audience that is unaware of the forking controversy or doesn't care
- Generally **the smallest cohort of the four**

---

## 7. What eri Can Learn

eri's posture differs from all four of these tools — but there are concrete lessons each contributes.

### 7.1 From Continue: configuration as code

`.continue/checks/`, `.continue/rules/`, `.continue/agents/` as markdown files in the repo is the right pattern for any team-shareable assistant configuration. eri's gaze profiles, voice-command vocabularies, and diffusion-edit prompts should live in `.eri/` directories that get committed alongside the code. The lesson: **users want their assistant's behavior reviewable in PRs**.

### 7.2 From Cline: checkpoints + shadow Git

Cline's shadow-Git checkpoint system is **the best "let it run safely" UX** in the category. For any future eri agent mode — and especially for diffusion-driven multi-file edits where a single bad pass could rewrite large surface area — a shadow-Git layer with per-tool-call rollback is non-negotiable. The lesson: **transparency and reversibility are the price of admission for autonomous edits**.

### 7.3 From Roo: diff-based edits and scoped modes

Diff-based editing isn't just a cost optimization — it's a **correctness optimization** that makes small-model edits viable. For eri's diffusion stack, where edit candidates are generated and re-ranked rapidly, diffs are the right unit of change. Multi-mode scoping (Plan can read but not write, etc.) is also a clean abstraction worth adopting.

### 7.4 From PearAI: the forking warning

The PearAI controversy is a clean case study in **how to lose developer trust quickly**. If eri ever forks an open-source IDE (VS Code, Codium, Zed, etc.), the attribution and licensing story has to be airtight on day one. The lesson: **open-source developers will forgive almost anything except misrepresented attribution**.

### 7.5 From all four: voice/gaze/diffusion is uncontested territory

None of Continue, Cline, Zoo Code, or PearAI ship voice-driven input, gaze-based context awareness, or diffusion-style parallel edit generation. They all operate on the **chat + edit + agent + autocomplete** quadrant inherited from Copilot and Cursor. eri's stack — voice as a primary input channel, gaze as a context signal, diffusion as the edit-generation primitive — sits **in a different design space entirely**. The lesson: **don't compete with Continue/Cline on agent autonomy; compete on the modalities they haven't touched**.

---

## 8. Where eri's Commercial Play Fits

The structural reality of the four tools above: **they are mostly free for individual developers, with Team tiers in the $10–$20/seat/month range and Enterprise tiers gated on SSO/audit features**. None of them charges an individual developer for capability — the moat is convenience for teams, not power for individuals.

This creates two pricing problems and one opportunity for eri.

### 8.1 The two problems

**Problem 1: free-tier expectations.** Any developer who has touched Continue or Cline knows that "BYOK + Ollama + a $20 OpenRouter top-up" gives them most of a working AI coding setup for the cost of tokens alone. eri cannot pretend that floor doesn't exist.

**Problem 2: the IDE refugees are sophisticated.** They've already left one tool over pricing (Cursor); they're not a captive audience. Charging $20/month for a chat + agent product without a hard differentiator gets compared directly to Cline (free) and Continue Team ($20 with team features).

### 8.2 The opportunity

**eri is not in the chat + agent quadrant.** The value proposition isn't "we have a better agent than Cline" — Cline already wins that fight. The value proposition is the **modality bundle**: voice input that survives in noisy environments, gaze-based context that lets the assistant know what you're looking at without scrolling, diffusion-driven parallel candidate generation that produces multiple edit options at once.

That value proposition justifies a **price floor above $20/month** for two reasons:

1. The voice and gaze pipelines run on hardware (microphones, cameras, eye-trackers) that the tool integrates with directly. There is no free Ollama-equivalent for "production-quality voice command stack with code-aware vocabularies" — eri owns that integration.
2. The diffusion edit generation is wrapped via a paid inference API (Mercury 2). There is no BYOK substitution path because no developer has API access to that class of diffusion-code model independently.

Concretely:

- **The free tier** should be limited but real — voice transcription only, no diffusion edits, gaze disabled. This matches Continue Solo / Cline OSS in spirit.
- **The paid tier** ($30–$50/month range, above Cursor Pro) sells the modality bundle: full voice, gaze context, diffusion edit candidates, the predictive/adaptive UX layer. This is **not** competing with Cline; it's competing with Cursor on what Cursor doesn't have.
- **Enterprise** sells the modality bundle plus on-prem voice/gaze (which Continue and Cursor both lack), SCIM, audit, and team-shared `.eri/` configurations.

The strategic point: **don't try to be a better free tool than Cline.** Try to be a tool that does things Cline structurally cannot do, and price for that.

### 8.3 The Roo Code warning

Matt Rubens's stated rationale for shutting down a 3M-install IDE extension — "IDEs are not the future of coding" — should not be dismissed. If the bet pays off, the asynchronous-agent surface (Roomote, OpenAI Codex Cloud, Devin, the next generation of Slack/Linear-native task bots) will eat the IDE category. eri's modality bundle is a strong wedge **for the IDE category specifically** — voice and gaze are inherently synchronous, embodied, in-front-of-the-screen experiences. The lesson: **eri's positioning should explicitly embrace the synchronous-IDE thesis** rather than try to also play in the async-agent space where Cline's SDK + Kanban CLI and Roomote already have momentum.

---

## Sources

- Continue: https://github.com/continuedev/continue · https://www.continue.dev/pricing · https://docs.continue.dev/ · https://weavai.app/blog/en/2026/04/24/continue-dev-2026-review-open-source-ai-coding-ci/ · https://marketplace.visualstudio.com/items?itemName=Continue.continue · https://localaimaster.com/blog/continue-dev-ollama-setup · https://news.ycombinator.com/item?id=47049848
- Cline: https://github.com/cline/cline · https://cline.bot/pricing · https://cline.bot/cli · https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime · https://docs.cline.bot/core-workflows/plan-and-act · https://docs.cline.bot/api/models · https://www.deployhq.com/guides/cline · https://www.npmjs.com/package/cline · https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev · https://addyo.substack.com/p/why-i-use-cline-for-ai-engineering
- Roo Code / Zoo Code: https://github.com/RooCodeInc/Roo-Code · https://github.com/Zoo-Code-Org/Zoo-Code · https://www.zoocode.dev/ · https://thenewstack.io/roo-code-cloud-ides-ai-coding/ · https://roomote.dev/ · https://en.theblockbeats.news/flash/342460 · https://www.bodegaone.ai/blog/roo-code-shutdown-alternatives · https://kilo.ai/articles/roo-to-kilo-migration-guide · https://cursor-alternatives.com/blog/roo-code-rules/ · https://www.morphllm.com/comparisons/roo-code-vs-cline
- PearAI: https://github.com/trypear/pearai-app · https://trypear.ai/pricing · https://news.ycombinator.com/item?id=41701709 · https://opensauced.pizza/blog/-pearai-transparency · https://techcrunch.com/2024/09/30/y-combinator-is-being-criticized-after-it-backed-an-ai-startup-that-admits-it-basically-cloned-another-ai-startup/ · https://www.wearefounders.uk/the-pearai-forking-controversy-open-source-or-misleading-clone/
- Cross-cutting: https://apidog.com/blog/cursor-byok-ban-alternative/ · https://forum.cursor.com/t/byok-bring-your-own-key/25578
