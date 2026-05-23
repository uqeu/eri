# Mature IDE-Makers' AI Plays

A competitive brief on how established IDE vendors — **Zed**, **JetBrains** (AI Assistant, Junie, Mellum, the discontinued Fleet, and the new Air preview), **Microsoft Visual Studio + IntelliCode + Copilot**, and **Sublime Text** — have positioned themselves against the new wave of AI-native editors (Cursor, Windsurf, and others). Written for the eri team. eri began as a Zed fork and pivoted to a VSCodium fork in May 2026; references to Zed are written from a neutral, public-facing standpoint.

---

## 1. Zed

### 1.1 The product

Zed is a Rust-built, GPU-rendered code editor (GPUI is the in-house rendering stack) that began life as a collaboration-first successor to Atom — same lineage as the original team. By 2026 the marketing has shifted: zed.dev now leads with "**The AI Code Editor Built for Speed**" rather than the multiplayer pitch [source: https://zed.dev/ai]. The 1.0 release in early 2026 cemented the new identity [source: https://thecodersblog.com/zed-1-0-a-new-era-for-collaborative-code-editing-2026/].

The two AI surfaces are the **Agent Panel** (a conversational pane with tool calls, file reads, terminal access, and multi-file edits) and **Edit Prediction** (an inline-suggestion engine analogous to Cursor's Tab). Both share Zed's defining performance characteristic — sub-frame keystroke response and GPU compositing — which lets edit suggestions appear without the perceptible lag developers tolerate in Electron editors [source: https://zed.dev/docs/ai/overview; https://zed.dev/docs/ai/agent-panel].

### 1.2 Zeta and Zeta2

Zed builds its own edit-prediction models under the **Zeta** name. Zeta was Zed's first in-house model; **Zeta2** is the current open-weight successor, "faster, more accurate, and trained on better data" according to the docs [source: https://zed.dev/docs/ai/edit-prediction]. Crucially, Zed designed Zeta to predict the **next edit** (a multi-line diff) rather than the next token, so a single Tab press can land a multi-character change. The model is open weights and can run **locally via Ollama** for users who want zero round-trip latency [source: https://zed.dev/blog/edit-prediction-providers].

The May 2026 release notes show a meaningful operational detail: Zed had to ship a fix for "local zeta2 edit predictions using the wrong prompt format," confirming that local inference is a first-class production path, not a demo [source: https://releasebot.io/updates/zed].

Edit Prediction is provider-pluggable. The supported list on the docs page includes Zeta, Mercury Coder (a diffusion-based code model from an external vendor), Sweep, Ollama, Codestral, and GitHub Copilot's Next Edit Suggestions [source: https://zed.dev/docs/ai/edit-prediction]. The breadth signals two things: (a) Zed is not betting the company on its own model and (b) Zed is more open to non-autoregressive prediction paradigms than most competitors.

### 1.3 The Agent Panel

The Agent Panel takes the now-standard agentic pattern — chat turn → tool plan → file edits → terminal commands → review diff → accept — and runs it natively against Zed's filesystem and language-server state, rather than over an external IDE protocol [source: https://zed.dev/docs/ai/agent-panel]. The differentiator is again latency: the diff renderer is the same GPU pipeline as ordinary editing, so a 30-file agent change applies and scrolls without lag. Reviewers in mid-2025 noted that "agentic development in Zed feels closer to direct manipulation than in VS Code" because the round trips never cross a webview boundary [source: https://blog.herlein.com/common/vscode-vs-zed/].

### 1.4 Pricing

Pricing was published in mid-2025 and remains the structure as of May 2026 [source: https://zed.dev/pricing; https://zed.dev/docs/ai/plans-and-usage]:

- **Personal — free forever.** Full editor, multiplayer, remote development, the Agent Panel with any external agent, and 2,000 accepted edit predictions per month.
- **Pro — $10/mo.** Unlimited edit predictions, $5 of included tokens for Zed-hosted models, then usage-based at "API list price + 10%."
- **Business — $30/seat/mo.** Org-wide model policies, data governance, RBAC, unified spend visibility, no minimum seats.
- **Student — free for one year** to verified students, with Pro features minus Claude Opus.

The pricing is structurally cheaper than Cursor ($20 Pro, $40 Ultra) and the "API list price + 10%" margin is more transparent than Cursor's opaque token economics. The "$5 of included tokens" is a small allowance, which signals that Zed expects most paying users to provide their own keys.

### 1.5 Multiplayer and voice

Zed's collaboration stack is differentiated from anything in the Cursor/Copilot lane. **Channels** are persistent rooms containing shared projects, voice chat, screen sharing, and collaborative notes; joining a channel auto-shares the microphone (subject to OS permission). CRDT-backed cursors and sub-second latency let pairs work without screen sharing [source: https://zed.dev/docs/collaboration/overview; https://zed.dev/docs/collaboration/channels]. None of this is AI; it predates the AI features by years.

For eri, the relevant takeaway is that **a native editor can ship voice as a peer-to-peer feature**, not just as an AI input modality. The pieces aren't competitors — Zed's voice is multiplayer chat; eri's voice is human-to-agent — but the infrastructure choice (microphone capture in the editor process, low-latency audio in the core) is the same engineering problem.

### 1.6 Adoption and market position

Zed's adoption remains a fraction of VS Code's. In the 2025 Stack Overflow Developer Survey, VS Code and Visual Studio retained the top two slots for the fourth consecutive year, with subscription AI editors (Cursor at 17.9% in its first full year, fastest-ever IDE adoption) not toppling them; Zed appears further down the list and does not register among the most-used tools at the headline level [source: https://medium.com/@sumit_m/5-takeaways-from-the-2025-stack-overflow-developer-survey-332afe1d8af3; https://www.trytami.com/p/most-popular-technologies-in-2025]. Zed's audience skews toward Rust developers, performance-conscious engineers, and macOS-first shops.

### 1.7 Strengths

- **Performance ceiling no Electron editor can match.** GPU compositing, native input, no DOM overhead.
- **In-house, open-weight models.** Zeta/Zeta2 give Zed a story about local inference, data sovereignty, and "predict the edit, not the token" that VS Code forks cannot tell.
- **Real-time multiplayer with voice already shipped.** No competitor in the AI-editor wave has anything close.
- **Pluggable prediction providers.** Mercury Coder, Codestral, Ollama, and Copilot all sit alongside Zeta — Zed wins on flexibility, not lock-in.
- **Honest pricing.** "API list + 10%" is auditable in a way Cursor's quota model is not.

### 1.8 Weaknesses

- **Ecosystem.** VS Code's marketplace has hundreds of thousands of extensions; Zed's is small. Many enterprise plugins (proprietary linters, internal SDKs, vendor-specific debug adapters) have no Zed equivalent.
- **Windows and Linux are second-class.** macOS shipped first and remains the polished surface.
- **No JetBrains language depth.** Refactorings, structural search, type-aware navigation in Java/Kotlin/C++ are deeper in JetBrains; Zed leans on LSP, which has known ceilings.
- **AI surface is still chat + tab + agent.** The product has no voice-to-code, no gaze tracking, no diffusion-paradigm UX — just faster versions of the standard pattern.

---

## 2. JetBrains: AI Assistant, Junie, Mellum

### 2.1 The portfolio

JetBrains' AI play is now spread across four product lines:

1. **AI Assistant** — chat, completion, inline edits — bundled into every IDE (IntelliJ, PyCharm, Rider, GoLand, WebStorm, PhpStorm, RustRover, CLion, RubyMine, DataGrip, Android Studio via plugin).
2. **Junie** — the autonomous agent, launched January 2026.
3. **Mellum** — JetBrains' own 4B-parameter focus model for code completion, open-sourced April 2025.
4. **Air** — the new agentic IDE preview (built on the abandoned Fleet codebase, see §3).

### 2.2 AI Assistant

AI Assistant is sold under JetBrains' "AI Plans," tiered as **AI Free**, **AI Pro ($8–$10/mo)**, **AI Ultimate ($30/mo)**, and **Enterprise** [source: https://www.jetbrains.com/ai-ides/buy/; https://aiproductivity.ai/blog/jetbrains-ai-assistant/]. The free tier includes unlimited local code completion (Mellum-backed) plus a small monthly credit allowance for cloud features. The credit economy is the friction point: each credit equals $1 USD, Junie tasks and complex chat consume credits, and an active forum thread documents user frustration over how quickly credits drain on agent workloads [source: https://intellij-support.jetbrains.com/hc/en-us/community/posts/31142845556370-Serious-Concerns-Regarding-JetBrains-AI-Pricing-Credit-Consumption-with-Junie-and-AI-Assistant].

Functionally, AI Assistant covers the table-stakes set: chat with project context, inline completions, "explain code," "generate test," commit-message generation, structured "edit this" actions, and a rules/prompt-templates system. It supports BYO keys for OpenAI/Anthropic alongside the bundled credits.

### 2.3 Junie

Junie is JetBrains' autonomous agent — its answer to Cursor's Composer/Agent and Windsurf's Cascade. Launched January 2026 and rolled across all IDEs through 2026, it runs the standard plan-then-execute loop: gather context, propose a plan, write code, run tests, iterate [source: https://www.jetbrains.com/junie/; https://junie.jetbrains.com/]. In September 2026 JetBrains integrated Anthropic's official Claude Agent SDK as one of the engines that can drive Junie tasks [source: https://aiproductivity.ai/blog/jetbrains-ai-assistant/].

The strategic position is "agent that knows your refactorings." Junie can call into IntelliJ's refactor engine — Rename, Extract Method, Move, Change Signature, Inline — as deterministic tools rather than asking an LLM to produce a diff. For a codebase where structural correctness matters more than speed (large Java/Kotlin monoliths, enterprise C#), this is a real differentiator. The cost is latency: Junie is slower than Cursor's Composer on typical web tasks because the IDE is doing more work per step.

### 2.4 Mellum

Mellum is JetBrains' purpose-built code completion model: 4B parameters, Llama-style architecture, pretrained on 4T tokens of permissively licensed multi-language code. Open-sourced on Hugging Face on **30 April 2025** [source: https://blog.jetbrains.com/ai/2025/04/mellum-goes-open-source-a-purpose-built-llm-for-developers-now-on-hugging-face/; https://www.jetbrains.com/mellum/]. A July 2025 follow-up post documented expanded language coverage (Java, Kotlin, Python, Go, PHP, C, C++, C#, JavaScript, TypeScript, CSS, HTML, Rust, Ruby) and new ways to run it locally [source: https://blog.jetbrains.com/ai/2025/07/whats-new-with-mellum-expanded-language-support-and-new-ways-to-use-it-locally/]. An October 2025 arXiv paper, "Mellum: Production-Grade in-IDE Contextual Code Completion with Multi-File Project Understanding," documents the model architecture and the multi-file context construction [source: https://arxiv.org/pdf/2510.05788].

JetBrains positions Mellum as a "focus model" — narrow, fast, in-IDE — and contrasts it with general-purpose chat models. Strategically Mellum gives JetBrains the same story Zed has with Zeta: "we own the inference path for the typing-loop hot path; everything else can be BYO." The roadmap mentions a family of focal models for related tasks (diff prediction, refactor suggestions).

### 2.5 Multi-IDE coverage

The strategic moat: a single AI subscription works across the **entire JetBrains IDE family**. A polyglot shop running PhpStorm for the legacy app, PyCharm for the data team, GoLand for services, and Rider for the Unity client gets the same Junie + AI Assistant + Mellum stack everywhere. Cursor cannot replicate this without rebuilding each IDE's refactor engine; VS Code can approximate it only by collapsing every language to LSP.

### 2.6 Adoption

JetBrains is the consistent #3 IDE bloc behind VS Code and Visual Studio in the Stack Overflow surveys, but its own ecosystem report shows higher numbers (with the caveat that JetBrains users are oversampled in JetBrains-run surveys) [source: https://devecosystem-2025.jetbrains.com/; https://medium.com/@sumit_m/5-takeaways-from-the-2025-stack-overflow-developer-survey-332afe1d8af3]. Where JetBrains dominates is **enterprise Java, Kotlin/Android, .NET (Rider), and Python data science (PyCharm Professional)**. These are exactly the verticals Cursor has struggled to land — large companies with established JetBrains licensing relationships and refactoring-heavy workflows.

### 2.7 Strengths

- **Language smartness.** Two decades of refactoring, indexing, and structural-search work that LSP cannot match.
- **Multi-IDE bundle.** One subscription, many languages, identical agent UX.
- **Own model story (Mellum).** Open weights, in-IDE, runs locally for the typing-loop hot path.
- **Enterprise foothold.** Existing licensing relationships make AI add-ons a low-friction upsell.
- **Refactor-as-tool.** Junie can call deterministic refactorings, which LLM-only agents must approximate.

### 2.8 Weaknesses

- **Slower to ship cutting-edge agent UX.** Junie shipped a year after Cursor's first agent; Air is still preview and macOS-only.
- **Credit economy.** Users complain loudly about how fast Junie burns credits; the pricing is opaque relative to flat-rate competitors.
- **No diffusion, no voice, no gaze.** The roadmap is "agent that respects refactorings," not new interaction paradigms.
- **IDE perf.** IntelliJ-family editors carry a JVM and a large project index; on a laptop they feel heavier than Zed or VS Code regardless of how fast the agent is.

---

## 3. JetBrains Fleet — and what replaced it

Fleet was JetBrains' "lightweight, distributed, modern" editor — announced 2021, in preview for four years, designed to live alongside (or eventually under) the existing IDE family. The bet was that a Kotlin-built thin client with a remote backend would beat both VS Code and IntelliJ on first-launch speed and remote-dev ergonomics.

In **December 2025 JetBrains discontinued Fleet**. The official "Future of Fleet" post and external coverage tell a consistent story: Fleet never reached the adoption needed to justify continued investment, users could not articulate a strong reason to switch, and when AI matured, JetBrains' research showed "another AI editor would not stand out in a market filled with AI-first VS Code forks" [source: https://blog.jetbrains.com/fleet/2025/12/the-future-of-fleet/; https://www.infoworld.com/article/4104991/jetbrains-discontinues-fleet-ide.html; https://www.devclass.com/ai-ml/2025/12/09/jetbrains-abandons-fleet-ide-pins-hopes-on-forthcoming-air-agentic-development-tool/1728894]. Fleet downloads went offline 22 December 2025.

The Fleet codebase did not die — it became **Air**. Announced March 2026, Air is JetBrains' new agentic IDE: built on Fleet's distributed architecture but reframed around running **multiple agents in parallel** in isolated workspaces (Docker containers or Git worktrees). Air supports OpenAI Codex, Anthropic Claude Agent, Google Gemini CLI, and Junie as drivable agents — a "we don't pick a winner, we let you orchestrate them" pitch [source: https://blog.jetbrains.com/air/2026/03/air-launches-as-public-preview-a-new-wave-of-dev-tooling-built-on-26-years-of-experience/; https://www.theregister.com/2026/03/10/jetbrains_previews_air_proclaims_new/; https://adtmag.com/articles/2026/03/19/jetbrains-launches-air-preview-for-developers-managing-multiple-ai-agents.aspx].

Reviews from May 2026 are cautiously positive but flag obvious limitations: macOS-only preview, less mature editor than VS Code or Cursor for direct coding, performance issues on very large repos, and incomplete language support [source: https://makerstack.co/reviews/jetbrains-air-review/; https://recca0120.github.io/en/2026/05/06/jetbrains-air-agentic-ide/].

The Fleet → Air pivot is **the single most relevant case study for eri**. JetBrains tried to ship a fresh-codebase modern IDE, failed to grow it, and reused the chassis to chase a more differentiated AI thesis (orchestrate, don't compete). The lesson: a great editor without a differentiated AI thesis is no longer a viable product in 2026. eri's voice/gaze/diffusion thesis must remain the lead, not the editor itself.

---

## 4. Microsoft Visual Studio + IntelliCode + Copilot

### 4.1 The product

Visual Studio (the IDE, not VS Code) shipped its **2026 GA release in November 2025** — Microsoft branded it the "First Intelligent Developer Environment" — and has shipped monthly Copilot updates ever since [source: https://visualstudiomagazine.com/articles/2025/11/12/visual-studio-2026-ga-first-intelligent-developer-environment-ide.aspx]. The product is the entrenched IDE for .NET, C++, Unreal Engine on Windows, SQL Server tooling, and large Microsoft-stack enterprises.

### 4.2 IntelliCode's quiet death

IntelliCode — Microsoft's pre-LLM "AI-assisted IntelliSense" introduced in 2018 — has been progressively de-emphasised. A December 2025 Visual Studio Magazine piece headlined "**Microsoft Quietly Kills IntelliCode as AI Strategy Shifts to Subscription Copilot**" documents the migration: the IntelliCode brand is being retired, the team's work folded into Copilot, and the standalone feature retained only as an optional component [source: https://visualstudiomagazine.com/articles/2025/12/17/microsoft-quietly-kills-intellicode-as-ai-strategy-shifts-to-copilot.aspx].

The April 2026 update added an interesting wrinkle: IntelliSense (the deterministic, type-aware completion) was given **priority over Copilot** when its completion list is active — Copilot still runs in parallel, but the editor surfaces IntelliSense first [source: https://visualstudiomagazine.com/articles/2026/04/28/visual-studio-2026-gives-intellisense-priority-over-copilot.aspx]. This is the inverse of what most AI editors do (Cursor pushes its model first, falls back to LSP) and it is telling: Microsoft is hedging against LLM hallucination in enterprise code by keeping the deterministic completion as the default UI affordance.

### 4.3 Copilot in VS vs Copilot in VS Code

Copilot integrates into both editors but the surface differs:

- **VS Code Copilot** lives in a chat side-panel with the full Cursor-style "Edits" multi-file mode and a more aggressive agent (`@workspace`, Chat Agent, Coding Agent). Copilot in VS Code is the lab where Microsoft tries new patterns.
- **Visual Studio Copilot** is more conservative: chat, completions, generate-test, debugger agent, "validate fix against runtime behaviour" tools. The April 2026 update added cloud agent sessions launched from the IDE and a Debugger Agent that validates fixes against live runtime behaviour [source: https://devblogs.microsoft.com/visualstudio/visual-studio-april-update-cloud-agent-integration/].

Enterprise differentiators in Visual Studio:
- **Bring-Your-Own-Model (BYOM) routing** through Azure AI Foundry — pick OpenAI/Anthropic/Google variants while keeping data inside the Azure tenant for residency control.
- **MCP server allowlists** governed at the GitHub organisation level, so admins can restrict which MCP servers Copilot is permitted to call.
- **Agent skills** discovered automatically from repo or user profile — reusable instruction sets for "run the build pipeline" or "follow our team's coding standards" [source: https://github.blog/changelog/2026-04-30-github-copilot-in-visual-studio-april-update/; https://github.blog/changelog/2026-04-02-github-copilot-in-visual-studio-march-update/].

### 4.4 Strengths

- **The .NET enterprise stronghold.** No competitor is going to displace Visual Studio for large Windows-stack shops in this decade.
- **Azure AI Foundry integration.** BYOM is enterprise-grade — data residency, latency control, policy compliance baked in.
- **Deterministic-first defaults.** IntelliSense-priority and the Debugger Agent's "validate against runtime" hedge against hallucination in code that has to ship.
- **GitHub plumbing.** MCP allowlists and the org-level Copilot policies inherit GitHub Enterprise's existing admin surface.

### 4.5 Weaknesses

- **Windows-centric.** Visual Studio doesn't run on macOS or Linux (Visual Studio for Mac was retired in 2024); the AI features are accessible on those platforms only via VS Code.
- **Slow release cadence relative to AI-native competitors.** Monthly updates vs Cursor's weekly cycle.
- **Heavy.** Visual Studio remains a multi-gigabyte install with a multi-second cold start.
- **No interaction-paradigm innovation.** Voice, gaze, diffusion UX are not on the roadmap. Microsoft's bet is "deeper enterprise hooks," not "new way to code."

---

## 5. Sublime Text

Sublime is included for completeness. There is **no first-party Sublime AI product**. The editor is still actively developed, still loved for raw speed and the famous `Cmd+P` Goto-Anything, but Sublime HQ has shipped no in-house AI integration.

The community has filled the gap with plugins:

- **OpenAI-Sublime-Text** (yaroslavyaroslav) — works with OpenAI Responses, Anthropic Claude, Google Gemini, llama.cpp, Ollama, and arbitrary OpenAI-compatible APIs [source: https://github.com/yaroslavyaroslav/OpenAI-sublime-text].
- **Pieces for Sublime** — local-first conversational copilot with 20+ models, cloud and on-device [source: https://pieces.app/blog/introducing-pieces-for-sublime-the-first-conversational-copilot-in-sublime-text].
- **Yollama** — Sublime + Ollama for local completion.

The relevant takeaway: a fast native editor without an AI product, by 2026, becomes a third-party plugin platform rather than a competitor. Sublime is no longer in the conversation as an AI-IDE; it survives as a workhorse editor for users who explicitly opt out of bundled AI.

---

## 6. Cross-cutting: what "mature IDE" means in 2026

Across the five products above, a baseline feature set has consolidated. Any IDE shipping in 2026 is expected to have, at minimum:

1. **Inline edit prediction** — multi-line, model-backed, accept-with-Tab. The bar is no longer "next token"; it's "next edit."
2. **A chat-and-tool agent panel** — read files, run terminal commands, propose multi-file diffs, review-and-accept UX.
3. **Pluggable model providers** — at least OpenAI, Anthropic, and a local Ollama path. Single-provider lock-in is now a competitive liability.
4. **MCP support** — agents can call out to user-supplied tool servers.
5. **Org-level policy controls** — model allowlists, data residency settings, audit logs.
6. **A "rules" or "skills" system** — repo-level prompt customisation that flows into every agent invocation.
7. **Refactoring-aware edits** — at least surface-level integration with rename/extract/move beyond raw text manipulation.
8. **Cloud / remote agent execution** — long-running tasks that survive the editor closing.

This is the table-stakes set. Cursor invented half of it; Zed, JetBrains, and Microsoft have caught up. An editor that ships only these features is a commodity by 2026.

### Where the mature IDEs lose

None of these five products is **voice-first** — Zed's voice is multiplayer chat between humans, not a model-input modality. None is **gaze-aware** in any sense, even ergonomically. None of them has shipped a **diffusion-paradigm UX** — though Zed allows Mercury Coder as a plug-in provider for the prediction surface, the surrounding UX is still autoregressive-shaped: a single suggestion, Tab to accept, regenerate to retry. None of them has rethought the **edit-review-accept loop** for parallel agents in the way an "agents as cards on a Kanban" surface would (Air gestures at this but the editor underneath is still single-buffer).

This is the seam eri is built into.

---

## 7. What eri can borrow

- **From Zed: performance discipline.** GPU compositing, native input handling, sub-frame latency on the typing path. eri inherits some of this culturally from its origin, but a VSCodium fork doesn't get it for free — Electron's overhead is the price of ecosystem. The compromise is to keep the hot paths (voice transcription, gaze tracking, diffusion suggestion rendering) in the native Rust sidecar (`eri_coreutils`) and accept Electron for the surrounding chrome.
- **From Zed: pluggable providers.** Mercury Coder appearing as a first-class option in Zed's edit-prediction dropdown validates the diffusion-paradigm play. eri's model-routing UI should be at least as flexible — users should be able to swap inference paths without leaving the editor.
- **From Zed: honest pricing.** "API list + 10%" is a competitive weapon against Cursor's opaque credit model. eri should match or beat this transparency.
- **From JetBrains: refactoring as a deterministic tool.** Agents that can call rename/extract/move as functions, rather than emitting diffs and hoping, produce more reliable cross-cutting changes. eri inherits VS Code's LSP — useful but shallower than IntelliJ — and should aggressively wire the LSP refactoring commands into the agent toolset.
- **From JetBrains: a focus model.** Mellum and Zeta both demonstrate that a small, narrow model on the typing-loop hot path is a defensible position. eri's local voice/gaze pipeline already implies a similar architecture (small, fast, local for ambient input; larger and external for generation), which lines up with this pattern.
- **From Microsoft: enterprise plumbing.** BYOM via Azure AI Foundry, MCP allowlists, GitHub org-level policy inheritance — eri will need an equivalent story before it can enter regulated industries. Not for v1, but on the roadmap.
- **From Air: parallel agent workspaces.** Docker- or worktree-isolated agent runs are the right answer for "multiple agents working in parallel without stepping on each other." eri's iterator panel (the project's existing UI primitive for parallel candidate generations) is conceptually aligned; the operational details (sandboxing, worktree management) are worth lifting from Air's preview.

---

## 8. Should eri ever support JetBrains?

This is the load-bearing strategic question, because it has cost Cursor real deals.

### 8.1 The Cursor precedent

Cursor lived inside its own VS Code fork through 2024 and 2025. Large enterprises with JetBrains-standardised teams could not adopt it. In **March 2026 Cursor shipped a JetBrains plugin** built on the Agent Client Protocol (ACP), making Composer and the Cursor agent available inside IntelliJ-family IDEs [source: https://cursor.com/blog/jetbrains-acp; https://cursor.com/docs/integrations/jetbrains; https://docs.cursor.com/guides/migration/jetbrains]. The forum had been begging for this since 2024 [source: https://forum.cursor.com/t/please-consider-a-jetbrains-plugin/17042]. The plugin is free to paid Cursor users.

The lesson is unambiguous: **even a vertically-integrated editor company eventually had to ship a JetBrains plugin to access the polyglot enterprise market.**

### 8.2 What this means for eri

eri's VSCodium fork has the same problem Cursor's VS Code fork had. The JetBrains-standardised enterprise (Java monoliths, Kotlin/Android shops, .NET via Rider, Python data science via PyCharm Professional) cannot adopt a separate editor — switching costs in muscle memory and licensing make it a non-starter.

Two paths:

1. **Short-term (next 12 months): no JetBrains plugin.** Focus on shipping the editor and the voice/gaze/diffusion product loop. The interaction-paradigm bet is the differentiator; spreading thin across IDE hosts dilutes it.

2. **Medium-term (12–24 months): JetBrains plugin via ACP.** When the core eri experience is stable, the Agent Client Protocol gives a relatively low-effort path to host eri's agent inside JetBrains IDEs. This won't reproduce the editor — voice, gaze, and the diffusion-suggestion UX rely on having the editor surface — but it can reproduce the **agent and code-generation** part of the product, which is enough to land enterprise pilots that would otherwise reject a VSCodium-only product.

The hybrid play: **the editor is for users who choose eri; the plugin is for users whose employer chose JetBrains.** Both ship the same agent and the same model-routing layer. The voice/gaze/diffusion edge stays in the editor; the agent piece becomes a portable surface.

### 8.3 What this argues against

Building a JetBrains plugin **first** (before the editor) would replicate JetBrains AI Assistant rather than differentiate from it. The interaction-paradigm bet only pays off in an editor eri controls end-to-end. ACP is a fallback for enterprise reach, not the primary surface.

---

## 9. Net competitive position vs eri

| Vendor | Their edge | Their gap eri can exploit |
|---|---|---|
| Zed | Performance, multiplayer voice, open-weight Zeta, pluggable providers (Mercury Coder included) | Same chat-+-tab-+-agent product surface as everyone else; not voice-first, not gaze-aware |
| JetBrains AI Assistant + Junie | Multi-IDE bundle, refactoring depth, Mellum focus model | Heavier IDEs, opaque credit pricing, slower agent UX iteration, no interaction-paradigm bets |
| JetBrains Air | Parallel agent orchestration, agent-driver pluralism (Codex/Claude/Gemini/Junie) | Preview-stage, macOS-only, editor underneath is less mature than VS Code or Cursor |
| Visual Studio + Copilot | .NET enterprise lock-in, Azure AI Foundry BYOM, MCP allowlists, deterministic-first defaults | Windows-only, slow cadence, no innovation beyond enterprise hooks |
| Sublime + plugins | Native speed, opt-out audience | No first-party AI story at all; competing on a feature dimension eri doesn't need to lead on |

The mature IDE-makers have converged on a competent baseline (agent panel, edit prediction, MCP, policies). Their differentiators are **incumbency** (JetBrains enterprise, VS .NET), **performance** (Zed), or **agent orchestration** (Air). None of them is differentiated on **interaction paradigm** — voice as primary input, gaze for context, diffusion for the suggestion surface — which is precisely the seam eri is built into.

The strategic risk is not that one of these vendors out-features eri on chat or Tab. They will all reach feature parity on those surfaces. The risk is that **a credible voice-first or gaze-aware capability ships from one of them before eri's product loop is in front of users**. Zed (own model, willing to ship Mercury Coder as a provider, has microphone capture infrastructure already) is the most likely candidate. Air (agent-pluralist, fresh codebase, ambitious team) is the second.

---

## 10. Open questions for the eri team

1. **Pricing benchmark.** Zed Pro at $10/mo and Business at $30/seat is materially cheaper than Cursor. Is eri's price ceiling Zed's or Cursor's?
2. **Local model story.** Zeta runs in Ollama; Mellum runs on Hugging Face. eri's local-first ambient capture (voice/gaze) implies a local-model culture. Should eri publish or partner-on an open-weight model for the typing-loop hot path, parallel to Zeta/Mellum?
3. **ACP roadmap.** When (not if) eri ships a JetBrains plugin via Agent Client Protocol, which subset of features goes through it? Voice and gaze stay in the editor; agent and diffusion suggestions could travel.
4. **Multiplayer.** Zed has voice + CRDT cursors in the editor today. eri's voice is human-to-agent. Is there a v2 story where eri's voice infrastructure also powers multiplayer pair sessions? The infrastructure overlap is real.
5. **Refactoring depth.** VS Code's LSP-driven refactoring is shallower than IntelliJ's. How aggressively should eri invest in language-server extensions or its own structural-search index to close the gap with Junie?

---

*Brief compiled May 2026 from public vendor documentation, blog posts, and 2025–2026 industry reviews.*
