# Competitive Brief — CLI Coding Tools

**Subject:** Claude Code (Anthropic), Codex CLI (OpenAI), and Aider (open source)
**Date:** 2026-05-23
**Author:** eri research
**Status:** Internal — companion to `/research/cursor/` series

---

## Why this brief exists

The Cursor pricing brief flagged Claude Code as the "most serious threat for technical-IC users who don't need IDE polish." That framing turns out to be too narrow. There is now a coherent **CLI tier** of AI coding tools whose users have deliberately rejected the IDE form factor. Cursor and its imitators compete on extension polish, tab-completion latency, and "ambient" inline UX. The CLI tier competes on **delegation, composability, and agent loop depth**. They share almost no surface area, and their users overlap less than vendors pretend.

If eri is positioned as a voice/gaze-native IDE, the question is not "do we beat Cursor on tab" — it is "what claim do we make against the engineer who has already deleted their IDE and lives in tmux?" That engineer has a clear ideology, a working toolchain, and considerable scorn for visual surfaces. This brief catalogs their tools, their thesis, and the parts of it eri must engage with directly.

---

## 1. Claude Code (Anthropic)

### Architecture

Claude Code is a terminal application distributed as a Node binary, compiled with Bun and built on top of React Ink — a library that lets React components render as ANSI escape codes inside a terminal session [source: https://medium.com/@dingzhanjun/inside-claude-code-a-deep-dive-into-anthropics-agentic-cli-assistant-a4bedf3e6f08]. The CLI structure is wired through CommanderJS. The whole thing weighs in at a few megabytes after install.

Underneath the CLI sits the **Claude Agent SDK**, originally shipped as the "Claude Code SDK" and renamed in March 2026 [source: https://www.augmentcode.com/tools/claude-code-vs-claude-agent-sdk]. The relationship is important: Claude Code is the finished product you launch interactively, while the Agent SDK is the extracted engine that other developers embed in Python or TypeScript applications. Both share the same harness — the same tool registry, the same conversation loop, the same prefix-caching behavior. Anthropic claims a ~92% prefix reuse rate on the Claude Code harness, which significantly compresses cost on long agentic sessions where most of the system prompt and tool descriptions repeat across turns [source: https://medium.com/@dingzhanjun/inside-claude-code-a-deep-dive-into-anthropics-agentic-cli-assistant-a4bedf3e6f08].

Claude Code orchestrates **subagents** — sub-conversations forked from the main session with their own context window, often Haiku-class models for cheap parallel work. This is the architectural lever behind the "Agent Teams" marketing language. Multiple specialized subagents can be dispatched against independent slices of a task and their results reconciled in the parent session.

### Tool vocabulary

The six core tools are **Read, Write, Edit, Bash, Glob, Grep** [source: https://www.vtrivedy.com/posts/claudecode-tools-reference]. They are deliberately small and orthogonal:

- **Read** handles text, images (PNG/JPG), PDFs, and Jupyter notebooks
- **Write** creates or fully overwrites a file — no append, no merge
- **Edit** performs exact string replacement, taking `old_string` and `new_string`
- **Bash** runs shell commands in a persistent session
- **Glob** finds files by pattern with wildcard support
- **Grep** wraps ripgrep under the hood for fast regex search

Around those, the harness exposes **Task** (dispatch a subagent), **WebFetch**, **WebSearch**, **TodoWrite**, **Skill**, and **NotebookEdit** [source: https://www.vtrivedy.com/posts/claudecode-tools-reference]. The vocabulary has converged on what looks like a stable "Unix-for-agents" — small composable verbs that the model assembles into multi-step procedures.

The deliberate restraint matters. Anthropic could have shipped a `Refactor` tool, a `Test` tool, a `Lint` tool. Instead they ship `Bash` and let the model invoke whatever local toolchain exists. This is the **shell as agent runtime** thesis — and it inherits the entire portability story of POSIX.

### Skills, Hooks, MCP

Three extension surfaces work together [source: https://alexop.dev/posts/understanding-claude-code-full-stack/]:

**Skills** are Markdown files (`SKILL.md`) that teach Claude repeatable workflows. They are invoked as slash commands but can also auto-activate when the description field matches the current task. The key design property is **lazy loading** — heavy instructions stay out of the conversation until needed. A skill might say "when the user asks to write a Django REST API, follow this checklist," and only get pulled into context when triggered.

**Hooks** are shell commands fired on lifecycle events: PreToolUse, PostToolUse, Stop, etc. They are how teams enforce formatters, linters, type checks, and security scans that *must* run regardless of what the model decided. Hooks guarantee execution; prompts do not [source: https://code.claude.com/docs/en/hooks-guide]. There is even an `mcp_tool` hook type that lets a hook fire an MCP server call automatically.

**MCP** (Model Context Protocol) is the universal adapter for outside-world tools — GitHub, PostgreSQL, Slack, internal company services. By mid-2026 there are 3,000+ MCP integrations available [source: https://www.nxcode.io/resources/news/claude-code-vs-codex-cli-terminal-coding-comparison-2026].

The layering is the point: Skills define *what to do*, MCP provides *data and capabilities*, subagents *delegate work*, hooks *enforce rules*, and plugins *package it all*. None of this exists in a sidebar — it all lives in dotfiles, markdown, and `.mcp.json`.

### Pricing

Claude Code is **not a separately priced product**. It ships included with every paid Claude plan (Pro ~$17–20/month, Max 5x at $100/month, Max 20x at $200/month) and draws from the same usage budget as the chat product [source: https://www.ssdnodes.com/blog/claude-code-pricing-in-2026-every-plan-explained-pro-max-api-teams/]. Heavy individual users on Max 20x can run agent sessions for most of a working day before hitting a rolling-window limit. There is no per-token billing visible to users on subscription plans — the bill is fixed.

This is the pricing model Cursor cannot match without restructuring its business. Anthropic owns the model, so they can give the harness away. Cursor must mark up tokens to survive.

### Why technical engineers love it

- **Deeper agent loops.** Sessions can run for tens of minutes of autonomous work without supervision. The model can plan, execute, verify, and self-correct without round-tripping through a human-mediated chat box [source: https://www.firecrawl.dev/blog/why-clis-are-better-for-agents].
- **No extension restart.** When the IDE process dies, the agent dies. Claude Code runs in whatever terminal you already had open, survives across SSH sessions, and can be tmux-detached.
- **Runs anywhere.** Local laptop, dev VM, CI runner, a colleague's screen-share — same binary, same behavior.
- **Composes with Unix.** Pipes, file redirection, cron, watch loops, shell aliases — all the standard Unix composition primitives apply to Claude Code sessions because everything is just stdin/stdout.
- **Editor-agnostic.** Anthropic deliberately chose the terminal because their own engineers use VSCode, Zed, vim, and emacs — the shell is the common denominator [source: https://shekhargulati.com/2025/05/24/why-claude-code-is-not-an-ide-but-a-cli-tool/].
- **Progressive disclosure.** Context is treated as a scarce resource — `grep` retrieves snippets rather than the whole file tree being loaded eagerly [source: https://www.firecrawl.dev/blog/why-clis-are-better-for-agents].
- **Hygiene through fresh sessions.** CLI users start a new session per task; IDE sidebar conversations bloat across days and degrade quality.

### Weaknesses

- **No inline tab completion.** The single biggest UX claim of IDE-based tools — sub-100ms ghost text — is structurally impossible in a terminal agent. Some users keep an IDE open beside Claude Code for tab.
- **No diff viewer.** Claude Code prints diffs as text; reviewing a 400-line change is harder than in a graphical diff pane.
- **No visual surfaces.** Drag-and-drop images into the chat works (Read tool handles them) but there is no rendered Markdown preview, no inline image embedding mid-stream, no graphical file tree.
- **Terminal-only fluency tax.** Users who don't already live in the shell pay a learning cost for tmux, dotfiles, and shell idioms.
- **Single-conversation focus.** Parallel agent runs require terminal multiplexing — fine for the target audience, friction for newcomers.

[source: https://github.com/anthropics/claude-code] [source: https://code.claude.com/docs/en/overview]

---

## 2. Codex CLI (OpenAI)

### Architecture and current state

Codex CLI was originally a Node/TypeScript project shipped in mid-2025. OpenAI rewrote the core in Rust through late 2025 — the `codex-rs` workspace, which by early 2026 accounts for ~95% of the codebase [source: https://www.infoq.com/news/2025/06/codex-cli-rust-native-rewrite/]. The motivation was packaging: the TS version required Node v22+, which created install friction for every user and made enterprise/air-gapped deployment awkward. The Rust binary is single-file, no runtime, easier to distribute.

The `codex-rs` crate organization is roughly 70 Cargo crates arranged in layers, with user-facing entry points sitting on top of a shared core engine [source: https://codex.danielvaughan.com/2026/03/28/codex-rs-rust-rewrite-architecture/]. The mental model parallels Claude Code's harness/SDK split — a reusable engine with multiple frontends.

The differentiating piece is **OS-level sandboxing**. Codex CLI uses **Apple Seatbelt on macOS** and **Landlock + seccomp on Linux** to confine the agent at the kernel level [source: https://developers.openai.com/codex/cli]. Claude Code and Aider rely on application-layer permission prompts ("can I run `rm`?"); Codex enforces filesystem and network policy below the process boundary. For full-auto modes where the agent is allowed to execute without confirmation, this is materially safer.

### Models

Codex CLI defaults to **GPT-5.5** as its agentic backbone, with **GPT-5.2-Codex** as the heavyweight model for complex multi-step tasks and **GPT-5.3-Codex-Spark** as a fast lightweight option for day-to-day coding [source: https://www.codegateway.dev/en/blog/openai-codex-cli-complete-guide-2026]. GPT-5.5 carries a 272K default context window, configurable up to 1M tokens.

OpenAI claims **Terminal-Bench 2.0** leadership: GPT-5.5 at 82.7% vs Claude at 69.4% [source: https://www.nxcode.io/resources/news/claude-code-vs-codex-cli-terminal-coding-comparison-2026]. On **SWE-bench Verified**, GPT-5.5 reportedly hits 88.7% vs Opus 4.7 at 87.6%. The two are close enough that benchmark choice determines the winner — Codex is measurably faster and more token-efficient, while Claude is reported stronger on multi-file architectural reasoning.

### Differentiation from Claude Code

- **Open source.** The `codex-rs` repo is on GitHub under a permissive license. Claude Code is closed source. For users who care about auditability, this is decisive.
- **Rust-native.** Faster startup, easier distribution, no Node runtime, easier embedding in CI.
- **Kernel-level sandbox.** Unique among major AI coding agents.
- **Token efficiency.** Internal reports indicate ~4x fewer tokens per task on average vs Claude Code [source: https://www.nxcode.io/resources/news/claude-code-vs-codex-cli-terminal-coding-comparison-2026]. The model is tuned for terse tool calls.
- **Codex Cloud handoff.** A long-running task can be punted to OpenAI's cloud sandbox for hours-long autonomous execution.
- **Computer use.** Native browser/desktop automation through GPT-5.4-tier models, shipped early March 2026.

### Pricing

ChatGPT Plus ($20/month), Pro ($200/month), and the new **Go tier at $8/month** all include Codex CLI access [source: https://developers.openai.com/codex/pricing]. As of April 2026, OpenAI moved Codex pricing toward API-token-based rates with credits as the unit. The Pro $100 tier was given 2x Codex usage as a temporary promotion through May 31, 2026, putting it at 10x Plus instead of the standard 5x. Pro $200 remains at 20x Plus.

The structural difference vs Anthropic: OpenAI has more price points (Go $8 / Plus $20 / Pro $100 / Pro $200) and a slightly more generous Plus tier for session count, but the underlying economics are similar — subscription buys you a soft token budget shared with ChatGPT.

### Adoption

Codex CLI is the second-most-installed terminal AI coding agent after Aider, by GitHub-stars proxy. It benefits from ChatGPT's vastly larger consumer subscriber base — most ChatGPT Plus users discover Codex through the developer surface of the product they already pay for. Adoption among engineers who came up through Codex's earlier (2021) incarnation has been strong.

---

## 3. Aider

### Origin

Aider is open source, written in Python, originally created by **Paul Gauthier** and first released in 2023 [source: https://grokipedia.com/page/Aider]. Gauthier had previously co-founded Inktomi in 1996 — one of the early search-engine companies that powered HotBot and Yahoo before being acquired — and served as CTO there until 2010. Aider grew out of his own use of GPT-4 as a coding partner, and predates the entire "AI IDE" category.

The project has accumulated **~41,600 GitHub stars** and **5.3M+ PyPI installs** by May 2026, with 169 contributors and ~15B tokens/week of measured traffic [source: https://toolbrain.net/aider-review-2026/]. It is the most popular CLI coding agent by every metric except revenue (it has none — it's free).

### The search/replace edit format

This is the part eri owes the most to. Aider invented (or at least popularized) the **SEARCH/REPLACE block** as the dominant edit format for LLM-driven code modification [source: https://aider.chat/docs/more/edit-formats.html]. The format looks like a git merge conflict:

```
path/to/file.py
<<<<<<< SEARCH
def old_function():
    return "old"
=======
def new_function():
    return "new"
>>>>>>> REPLACE
```

The LLM emits these blocks; Aider parses them and applies them locally. The clever part is the **matching cascade** in `replace_most_similar_chunk()` [source: https://deepwiki.com/Aider-AI/aider/3.2-prompt-engineering-and-templates]:

1. **`perfect_replace()`** — exact tuple comparison of line sequences. The fastest path.
2. **Whitespace-insensitive match** — strips leading/trailing whitespace from each line before comparing.
3. **`replace_part_with_missing_leading_whitespace()`** — handles the very common LLM failure mode of producing SEARCH blocks with truncated indentation.
4. **`replace_closest_edit_distance()`** — fuzzy match using Python's `difflib.SequenceMatcher`, scanning chunks of varying lengths and ranking by similarity ratio.

When a SEARCH block fails against the target file, Aider falls back to scanning **all other files in the chat context** [source: https://deepwiki.com/Aider-AI/aider/3.2-prompt-engineering-and-templates]. That's a real-world UX win — models confuse filenames constantly, and silently trying neighboring files turns a hard failure into a soft recovery.

Other edit formats Aider supports: **whole** (model returns the entire modified file — simple but inefficient for large files), **diff-fenced** (variation of the SEARCH/REPLACE block with code fences around the path), **udiff** (unified diff format, used to make GPT-4 Turbo "3x less lazy"), and **OpenAI Patch format** (Codex's native format) [source: https://aider.chat/docs/more/edit-formats.html]. The format chosen per-model is hard-coded based on what each model is known to perform best with.

This matters for eri because **eri_apply uses the same cascade**. The whitespace-tolerance and fuzzy fallback are not optional niceties — they are what makes LLM-generated edits robust at scale. Models *will* drop a leading space, *will* paraphrase a comment, *will* skip a blank line. A naive exact-match parser fails on 20–30% of LLM edits; Aider's cascade fails on under 5%.

### Git integration

Git is a first-class citizen in Aider [source: https://aider.chat/docs/git.html]. Every edit becomes an atomic git commit. The chain works like this: the LLM produces a SEARCH/REPLACE block, Aider applies it to the file, stages the change, and then asks the configured **`--weak-model`** (typically a cheap model like Haiku or `gpt-5-nano`) to summarize the diff into a conventional-commit-style message. The result is a repo whose history is a transcript of the conversation.

Users can disable auto-commits with `--no-auto-commits`, but the default is on. Combined with `git stash` workflows and the ability to `/undo` any commit from inside Aider, this gives users a kind of "atomic rollback" experience that no other CLI tool matches.

### BYOK / local models

Aider is the most model-flexible AI coding tool on the market [source: https://aider.chat/docs/usage.html]. It works with Claude, GPT, Gemini, DeepSeek, Qwen, and any OpenAI-compatible local endpoint via Ollama, vLLM, llama.cpp's server mode, or LM Studio. `aider --model ollama/qwen3.5:27b` is a one-line command to run fully locally with zero outbound traffic.

This is structurally different from Claude Code (Anthropic-only) and Codex CLI (OpenAI-only). For privacy-sensitive teams, air-gapped environments, or developers who want to A/B test models without switching tools, Aider is the only mainstream option.

### Community

The 41.6k GitHub stars number understates the cultural reach — Aider is the reference point CLI coding tools are measured against. Aider's own benchmark leaderboards (Aider Polyglot, Aider Benchmark) are widely cited as model-quality references [source: https://aider.chat/docs/leaderboards/]. The polyglot benchmark tests 22 models across C++, Go, Java, JavaScript, Python, and Rust on 225 Exercism exercises. GPT-5 currently leads at 0.880.

---

## Cross-cutting analysis

### The CLI thesis — why some engineers reject IDEs entirely

The CLI tier shares an ideological commitment that is rarely stated explicitly. The argument runs roughly:

1. **IDEs optimize for suggestion. Agents need delegation.** A sidebar chat with inline diff approvals is fundamentally interactive — the human stays in the loop for every change. CLI agents are designed to be handed a task and left alone for minutes or hours [source: https://www.firecrawl.dev/blog/why-clis-are-better-for-agents].
2. **Context windows are scarce; IDEs waste them.** An IDE knows about open tabs, recent edits, the file tree, the cursor position — and tends to dump all of that into context. A CLI agent retrieves narrowly via `grep` and `glob`, treating context as a budget [source: https://www.firecrawl.dev/blog/why-clis-are-better-for-agents].
3. **The shell is the common denominator.** Every dev environment has a shell. Not every dev environment has VSCode, Cursor, or JetBrains. The CLI agent runs identically on a laptop, a remote VM, a CI runner, an SSH session into a colleague's box, and a tmux session inside a Docker container.
4. **Composition beats integration.** A CLI tool can be piped, scripted, cron'd, watched, and embedded in `Makefile` targets. An IDE extension can be invoked from the IDE. The first is a primitive; the second is a feature.
5. **The IDE process model is fragile.** When VSCode crashes, the conversation, the open files, and the agent state all die together. A tmux-detached Claude Code session survives logout, reboot, and network changes.

This thesis is held with conviction by a measurable cohort of engineers — primarily senior ICs, infrastructure engineers, and developers who came up through Unix culture. They are not Cursor's target customer. They are not eri's natural early adopter either.

### What CLI tools can do that IDE tools can't

- **Run unattended on remote machines.** A Claude Code session on a build server can be triggered by a webhook and produce a PR with zero local involvement.
- **Pipe into and out of other Unix tools.** `git log --since=yesterday | claude "summarize what changed"` is a valid workflow.
- **Multi-machine orchestration.** Pair an SSH multiplexer with `tmux` and one engineer can drive parallel Claude Code agents on three machines.
- **Screen-sharing transparency.** Reviewers see exactly what the agent did because the entire session is text. IDE sidebars hide state.
- **Headless CI integration.** Codex CLI in particular is built for this — its sandbox subcommand and structured output formats make it trivial to embed in GitHub Actions or GitLab CI.
- **Survive editor switches.** The tool doesn't care if you also use vim, Helix, Zed, or Neovide — they all coexist.

### What eri's voice/gaze loop adds that CLI can't

CLI tools have one bottleneck the thesis above refuses to acknowledge: **the keyboard**. Every interaction goes through typed text — prompts, slash commands, edit confirmations, file paths. For the engineer at peak flow this is fine. For the engineer with RSI, the engineer pair-programming with a non-coder, the engineer driving, the engineer cooking dinner while a long agent loop runs, or the engineer who wants to glance at a diff without breaking eye contact with a teammate — the CLI is a wall.

eri's voice/gaze loop adds capabilities that CLI tools structurally cannot match:

- **Keyboard-free dispatch.** "Run the test suite, fix any failures, and open a PR" spoken aloud, no terminal focus, no slash command typed.
- **Glance-based confirmation.** Look at a diff for 200ms; the gaze tracker registers acceptance; the change applies. No `y/n` prompt.
- **Multimodal grounding.** "What's that error in the bottom-right pane?" — voice + gaze coordinates name the object without the user having to describe it textually.
- **Continuous ambient context.** The IDE knows what the user is looking at, what they have selected, what they last hovered. A CLI knows what they typed.
- **Lower entry barrier for non-CLI-native developers.** Voice + visual surfaces re-open the audience the CLI tier excluded — designers, technical PMs, mobile devs who never internalized tmux.

The honest reading: the CLI thesis is correct for the audience it serves. eri is not arguing with that thesis; eri is arguing for a *different* audience and a *different* mode of work. The two can coexist in the same engineer's day.

### The convergence — does eri need a CLI mode?

Yes, eventually. Three signals point that way:

1. **Cursor shipped `cursor-agent` in January 2026** — Cursor, the most IDE-pure of all the IDE players, conceded that some workflows demand a terminal frontend. The CLI now supports Plan and Ask modes, cloud handoff for background tasks, and one-click MCP authentication [source: https://cursor.com/changelog/cli-jan-16-2026]. The signal value is high: if Cursor needs a CLI, every IDE-oriented vendor needs one.
2. **CI/headless workflows demand it.** No team can put eri's voice loop into a GitHub Actions runner. They can put a CLI binary there.
3. **Power users want to script eri.** The same engineer who uses voice for normal flow wants `eri run --task="..."` for batch jobs.

The strategic call: eri should ship a CLI **as a frontend to the same agent runtime** — analogous to how Claude Code and the Agent SDK share a harness. The CLI is not the product, but its absence becomes a gap as enterprise customers ask "can this run in CI?"

The CLI mode does not need parity with Claude Code on day one. It needs to expose the same edit primitives (eri_apply), the same MCP integrations, and the same project memory — enough that a session started in voice and finished in CLI feels continuous.

### Comparative analysis — edit format

The four major approaches:

| Approach | Vendor | Mechanism | Robustness | Cost |
|----------|--------|-----------|------------|------|
| **SEARCH/REPLACE blocks** | Aider, eri_apply | Model emits text blocks with markers; tool applies with fuzzy matching cascade | High (5%+ fallback chain handles whitespace/indent drift) | Cheap — only changed regions transmitted |
| **Unified diff (udiff)** | Aider option, some agentic tools | Model emits standard `diff -u` patches; tool applies via `patch` or in-process | Moderate — patch context lines must match exactly; whitespace bugs common | Cheap |
| **OpenAI structured outputs / function calling** | Codex CLI, GPT-5.x | Model emits JSON conforming to a constrained schema; tool dispatches typed operations (e.g., `apply_patch` tool) | High when schema is well-formed; constrained decoding guarantees JSON validity | Moderate — JSON overhead per call |
| **Anthropic tool use / text editor tool** | Claude Code (Edit tool) | Model calls a named `Edit` tool with `old_string`/`new_string` arguments; harness applies exact match | Moderate — exact match only by default; LLM must avoid paraphrase | Cheap — single tool call per edit |

The trade-offs:

- **Aider's SEARCH/REPLACE wins on robustness** because of its multi-strategy fallback. Models drift, and Aider tolerates drift.
- **Anthropic's `Edit` tool is conceptually clean** — a single named tool with strong typing — but the exact-match requirement means Claude Code's harness has to be very careful about preserving original file content in context. The strict match also surfaces an interesting failure mode: when the file has shifted since the model last read it, the Edit fails and the model retries.
- **OpenAI's structured patch format** scales well to multi-file edits and CI workflows but is harder to debug when something goes wrong — the patch is opaque text, not human-readable markers.
- **Whole-file rewrites** (Aider's `whole` mode, some early agents) are simplest but token-expensive — a 600-line change costs 600 lines of output even if only 20 lines actually change.

For eri's `eri_apply`, the right call is what Aider already proved: **start with SEARCH/REPLACE blocks, fall back through whitespace-insensitive, indent-recovery, and fuzzy matching, then try sibling files**. The cost is a couple hundred lines of matching logic; the benefit is models that "just work" across the long tail of edit failures.

There is a higher-order point worth naming: the **edit format is a model–tool contract**. Each provider has implicitly trained their model on a preferred format — OpenAI on structured JSON patches, Anthropic on `Edit` tool calls, open-weight models on SEARCH/REPLACE because Aider has been their primary harness for two years. A multi-provider tool (eri, Aider) has to support multiple formats per-model. A single-provider tool (Claude Code, Codex CLI) can collapse to one. eri's diffusion-native code generation needs a format that the diffusion process produces naturally — and SEARCH/REPLACE happens to be a strong match because diffusion can generate the block boundaries and the content in parallel.

---

## Strategic implications for eri

1. **The CLI tier is not our competition for the seat we're targeting.** Voice-first / gaze-first / multimodal-first users are not the same humans as the tmux-and-Aider users. The two markets overlap at the edges (senior ICs who try both) but the centers are far apart.
2. **The CLI tier *is* our competition for ambient mindshare.** When the senior engineer at a 50-person startup picks the team's standard AI tool, they pick the one *they* prefer. If that engineer is a Claude Code loyalist, eri does not get evaluated.
3. **eri needs a credible CLI frontend within 6–12 months.** Not because CLI users will adopt it, but because (a) CI integration requires it, (b) parity with cursor-agent is now table stakes, and (c) the CLI is the simplest path to letting Claude Code loyalists prototype with eri without abandoning their workflow.
4. **eri_apply's edit format is correctly chosen.** SEARCH/REPLACE with the Aider-style cascade is the proven format. The diffusion advantage is not in the format itself — it's in *generating the blocks faster than autoregressive models* and in *regenerating multiple candidate blocks in parallel*.
5. **The pricing comparison is brutal and unavoidable.** Claude Code is included free with a $20/month Anthropic subscription. Codex CLI is included free with a $20/month OpenAI subscription. Aider is free. eri must justify any subscription pricing against three competitors at $0 marginal cost to the user. The justification is the voice/gaze loop and the local-first inference posture — *not* the agent loop itself, which is now commodity.
6. **The MCP standard is now load-bearing.** Both Anthropic and (de facto) OpenAI accept MCP servers. eri needs first-class MCP support to inherit the 3,000+ existing integrations rather than build them from scratch.

---

## Headline questions left open

- Does the voice/gaze audience exist at scale, or are we serving a niche the CLI tier already wrote off as "non-engineers"?
- What is the smallest CLI surface eri can ship that satisfies CI integration without becoming a second product to maintain?
- Can eri's diffusion edit generation match Aider's edit-format robustness on day one, or will the first six months be spent rebuilding the SEARCH/REPLACE cascade?
- Is there a credible path to embedding eri's agent runtime inside an existing CLI harness (Aider's plugin system, Claude Agent SDK) for early reach without building a frontend from scratch?

---

## Sources

- [Claude Code product page — Anthropic](https://www.anthropic.com/product/claude-code)
- [Claude Code GitHub repo](https://github.com/anthropics/claude-code)
- [Claude Code overview docs](https://code.claude.com/docs/en/overview)
- [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code tools reference (vtrivedy)](https://www.vtrivedy.com/posts/claudecode-tools-reference)
- [Inside Claude Code — Medium (John Ding)](https://medium.com/@dingzhanjun/inside-claude-code-a-deep-dive-into-anthropics-agentic-cli-assistant-a4bedf3e6f08)
- [Claude Code full stack — alexop.dev](https://alexop.dev/posts/understanding-claude-code-full-stack/)
- [Why Claude Code is a CLI — Shekhar Gulati](https://shekhargulati.com/2025/05/24/why-claude-code-is-not-an-ide-but-a-cli-tool/)
- [Claude Code vs Agent SDK — Augment Code](https://www.augmentcode.com/tools/claude-code-vs-claude-agent-sdk)
- [Claude Code pricing — SSD Nodes](https://www.ssdnodes.com/blog/claude-code-pricing-in-2026-every-plan-explained-pro-max-api-teams/)
- [Codex CLI docs — OpenAI Developers](https://developers.openai.com/codex/cli)
- [Codex CLI pricing](https://developers.openai.com/codex/pricing)
- [Codex CLI Rust rewrite — InfoQ](https://www.infoq.com/news/2025/06/codex-cli-rust-native-rewrite/)
- [codex-rs architecture](https://codex.danielvaughan.com/2026/03/28/codex-rs-rust-rewrite-architecture/)
- [Codex CLI 2026 guide — Code Gateway](https://www.codegateway.dev/en/blog/openai-codex-cli-complete-guide-2026)
- [Claude Code vs Codex CLI — NxCode](https://www.nxcode.io/resources/news/claude-code-vs-codex-cli-terminal-coding-comparison-2026)
- [Aider home](https://aider.chat/)
- [Aider edit formats](https://aider.chat/docs/more/edit-formats.html)
- [Aider git integration](https://aider.chat/docs/git.html)
- [Aider leaderboards](https://aider.chat/docs/leaderboards/)
- [Aider GitHub repo](https://github.com/Aider-AI/aider)
- [Aider search/replace internals — DeepWiki](https://deepwiki.com/Aider-AI/aider/3.2-prompt-engineering-and-templates)
- [Aider — Grokipedia](https://grokipedia.com/page/Aider)
- [Aider 2026 review — Toolbrain](https://toolbrain.net/aider-review-2026/)
- [Cursor CLI announcement](https://cursor.com/changelog/cli-jan-16-2026)
- [Cursor Agent CLI blog](https://cursor.com/blog/cli)
- [Why CLIs beat IDEs for agents — Firecrawl](https://www.firecrawl.dev/blog/why-clis-are-better-for-agents)
- [Code surgery: AI edits — Fabian Hertwig](https://fabianhertwig.com/blog/coding-assistants-file-edits/)
