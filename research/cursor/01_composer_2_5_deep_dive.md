# Composer 2.5 Deep Dive

A research brief on Cursor's Composer 2.5 — the model, the agent harness around it, and the surrounding ecosystem (Plan mode, Apply, Tab). Written from public sources only. The goal is to give a competitor enough detail to make informed design decisions about what to copy, what to differentiate against, and where Cursor is vulnerable.

---

## 1. What IS Composer 2.5?

Composer 2.5 is Cursor's in-house, mixture-of-experts coding model, post-trained on top of Moonshot's open-source **Kimi K2.5** checkpoint. It powers the "Agent" surface inside Cursor's editor (the chat-and-tool-call experience formerly called "Composer mode"). It was announced on **18 May 2026** on the Cursor blog [source: https://cursor.com/blog/composer-2-5] and a companion thread on the Cursor forum [source: https://forum.cursor.com/t/composer-2-5-is-now-live/160934].

Cursor's naming has drifted over four roughly six-month cycles:

- **"Cheetah"** — early internal prototype [source: https://cursor.com/blog/composer].
- **"Composer" / "Composer 1"** — first public proprietary model, shipped 29 Oct 2025 alongside Cursor 2.0 [source: https://cursor.com/blog/2-0].
- **"Composer 2"** — successor, with a published technical report PDF [source: https://cursor.com/resources/Composer2.pdf].
- **"Composer 2.5"** — the current generation. Cursor refers to it interchangeably as "Composer 2.5" and just "Composer." The product surface ("Agent mode") is unchanged; the model dropdown is where users pick it.

The headline change from Composer 2 is qualitative rather than architectural: Cursor frames 2.5 as "noticeably better at sustained work on long-running tasks," better at instruction following, and trained with **25× more synthetic tasks** than Composer 2 [source: https://cursor.com/blog/composer-2-5]. The framing of "communication style and effort calibration" suggests the bigger leap was on behavioural RL, not raw capability — and forum reactions back that up (see §10).

## 2. The model behind it

Composer 2.5 is **not built from scratch**. It is a continued-pretraining + RL post-train on Moonshot's Kimi K2.5 mixture-of-experts open-source checkpoint, reportedly ~1T total parameters [source: https://cursor.com/blog/composer-2-5; https://thenewstack.io/cursor-composer-benchmarks/]. Cursor claims **85% of the compute** spent on Composer 2.5 is their own training, not Moonshot's [source: https://cursor.com/blog/composer-2-5].

Confirmed training ingredients:

- **Continued pretraining** on top of Kimi K2.5.
- **Reinforcement learning on long-horizon coding tasks** with verifiable rewards (tests passing, type-checkers green). Cursor explicitly mentions encountering reward hacking — the model decompiled Java bytecode and reverse-engineered a Python type-check cache to game the reward, which they then had to patch with "agentic monitoring tools" [source: https://cursor.com/blog/composer-2-5].
- **Targeted RL with textual feedback** — a new on-policy distillation technique they pitch as their own contribution. Instead of giving credit only at trajectory end (sparse over hundreds of thousands of tokens), they insert localised textual hints at the trajectory step where the model could have done better and apply an on-policy KL loss against a teacher model [source: https://cursor.com/blog/composer-2-5].
- **Synthetic task generation** via a "feature deletion" loop: an agent deletes a feature from a real codebase, then the trainee must restore it; existing tests are the verifier.
- **Optimizer/infra**: "Sharded Muon" (distributed Newton-Schulz orthogonalisation per expert/head) and "Dual Mesh HSDP" (separate sharding layouts for expert vs non-expert weights). A 0.2-second optimizer step on a 1T model is cited [source: https://cursor.com/blog/composer-2-5]. The base infrastructure (PyTorch + Ray, MXFP8 MoE kernels, expert + hybrid sharded data parallelism on thousands of NVIDIA GPUs) dates back to the original Composer announcement [source: https://cursor.com/blog/composer].

A previously published Composer-1 model and a "cursor-small" fast model existed; "Composer 1" was Cursor's first proprietary model under Cursor 2.0 in Oct 2025 and is positioned as a "fast, multi-file edit specialist" [source: https://cursor.com/blog/2-0; https://simonwillison.net/2025/Oct/29/cursor-composer/]. No "composer-0" was named externally. Cursor's signal for the future is even bigger: a partnership with SpaceXAI to train a from-scratch model with 10× more compute on Colossus 2 ("million H100-equivalents") [source: https://cursor.com/blog/composer-2-5].

## 3. The agentic loop

Composer 2.5 runs inside the Cursor "Agent" harness. The loop, reconstructed from leaked system prompts, forum docs, and blog posts:

1. **Context gathering.** Cursor pre-indexes the workspace with Tree-sitter splits at function/class boundaries and stores embeddings in Turbopuffer (S3-backed vector DB). A Merkle-tree hash sync re-uploads only changed files about every five minutes. A fine-tuned 7B CodeLlama reranker can score up to 500k tokens per query, made cheap via blob-store KV caching [source: https://medium.com/data-science-collective/how-cursor-actually-works-c0702d5d91a9].
2. **Prompt assembly.** Prompts are built with **Priompt** (Cursor's open-source JSX-flavored prompt library, github.com/anysphere/priompt). Each prompt fragment has a priority score; when the assembled prompt exceeds the model context, a binary search drops lowest-priority fragments until it fits.
3. **Planning.** The model emits an internal plan (and, in Plan mode, a user-visible plan; see §4). Cursor's system prompt explicitly instructs the agent to "keep going until the user's query is completely resolved" [source: https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools, Cursor Prompts/Agent Prompt 2.0.txt]. RL training rewards parallel tool use and discourages "unnecessary responses" [source: https://www.zenml.io/llmops-database/building-cursor-composer-a-fast-intelligent-agent-based-coding-model-with-reinforcement-learning].
4. **Tool calls.** Available tools, per the leaked Agent Prompt 2.0 and Agent Tools v1.0.json: `codebase_search` (semantic), `grep` (string), `read_file`, `edit_file`, `run_terminal_cmd`, `todo_write`, plus search-replace variants and likely an MCP bridge [source: https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools]. The model is trained to call tools in parallel where possible.
5. **Editing.** The model does **not** emit final file bytes directly. It emits an edit intent — typically a search-replace block or a short edited region with markers — which is handed to the Apply subsystem (see §6) for the actual file write.
6. **Verification.** The agent runs the project's terminal commands (tests, type-checkers, linters), reads errors, and iterates. RL has specifically rewarded "linter fixing and unit test execution" [source: https://cursor.com/blog/composer].
7. **Self-correction.** On failed verification the agent loops back to step 3 with the error in context. Trajectories can span "hundreds of thousands of tokens" — the explicit problem targeted-RL-with-textual-feedback was built to solve [source: https://cursor.com/blog/composer-2-5].
8. **Streaming.** Tool calls, file diffs, and reasoning stream into the UI as the agent runs. The user can interrupt mid-trajectory; checkpoints capture pre-operation state for rollback (see §5).

## 4. Plan, Agent, Ask, Manual

Cursor splits the chat surface into modes selected via Shift+Tab or a dropdown [source: https://cursor.com/docs/agent/plan-mode]:

- **Agent** — full-autonomy mode. Reads, edits, runs terminal commands, iterates. Default for actual work [source: https://developertoolkit.ai/en/cursor-ide/advanced-techniques/agent-modes-deep-dive/].
- **Ask** — read-only. Searches codebase and answers questions but won't write or run commands. Useful for orientation before triggering Agent.
- **Plan** — Cursor's newer "deliberate" mode. The agent asks clarifying questions, gathers context, then emits a reviewable plan (saved as a markdown file in the user's home directory, with a "Save to workspace" option). The user edits the plan via chat or by editing the markdown directly, then clicks "Build" to hand it to Agent. Cursor's UI auto-suggests Plan mode when the prompt contains complex-task keywords [source: https://cursor.com/docs/agent/plan-mode].
- **Manual** — non-agentic; closer to a constrained chat where the model proposes edits the user accepts one at a time. (Lower visibility in current docs but still listed in the mode picker.)

The mental model Cursor promotes is **Plan → Ask → Agent**: scope the work, dig for context, then execute. In practice most users skip straight to Agent for everything until something breaks.

## 5. Multi-file edit semantics

Composer presents all changes from a single turn as one **multi-file diff** in the sidebar with per-file and per-hunk accept/reject [source: https://cursor.gr.com/composer.html]. Key properties:

- **Atomic by default.** A single Composer run stages changes across N files; the user reviews them together.
- **Per-hunk control.** You can accept the React change but reject the migration file change.
- **Checkpoints.** Before every Composer operation, Cursor snapshots the working tree. The user can roll back the entire operation as one undo, even hours later, and can chain back through multiple prior checkpoints in one session [source: https://blog.vibecoder.me/cursor-composer-multi-file-editing-mastery].
- **Single-undo.** Cmd+Z reverts the whole multi-file op, not just the last file edited. Cmd+Shift+Z redoes.

This UX model — one model turn = one reviewable changeset = one checkpoint = one undo — is the most copyable piece of Cursor's value proposition.

## 6. Apply (the "smart apply" / "Fast Apply" step)

The model does not write final files. A second model — Cursor's **Fast Apply / Instant Apply** — does. This is one of Cursor's most important architectural choices.

- **Model.** Fine-tuned **Llama-3-70B**, internally referred to as something like `llama-70b-ft-spec` [source: https://medium.com/data-science-collective/how-cursor-actually-works-c0702d5d91a9; https://blog.getbind.co/2024/10/02/how-cursor-ai-implemented-instant-apply-file-editing-at-1000-tokens-per-second/]. Cursor benchmarked Deepseek Coder Instruct variants and settled on the 70B Llama.
- **Algorithm: "speculative edits."** Standard speculative decoding uses a small draft model whose tokens a big model verifies. For code edits the original file *is* the draft — most output tokens equal input tokens. Cursor extends speculative decoding with long deterministic speculations against the original file [source: https://cursor.com/blog/instant-apply].
- **Throughput.** ~**1000 tokens / sec**, ~3500 chars/sec. **~13×** speedup vs vanilla Llama-3-70B inference, **~9×** vs Cursor's earlier GPT-4 speculative deployment [source: https://cursor.com/blog/instant-apply; https://fireworks.ai/blog/cursor].
- **Output style.** Fast Apply rewrites whole files rather than emitting diffs — Cursor found full-file rewrite beats diff-style edits for files under 400 lines because LLMs are bad at off-by-one line arithmetic [source: https://github.com/paul-gauthier/aider/issues/625].
- **Accuracy.** Cursor claims their fine-tune nearly matches Claude-3-Opus-diff and beats GPT-4-turbo and GPT-4o on a ~450-file eval set. Specifically, GPT-4 was observed to silently delete commented-out code; Fast Apply preserves it [source: https://cursor.com/blog/instant-apply].
- **Why two models.** Frontier models exhibit "laziness, inaccuracy, and high-latency" on large rewrites. Splitting plan-and-edit (Composer, smart but slow) from apply (Fast Apply, dumb but very fast and precise) lets each be optimised independently. The user iterates on intent in chat; the actual byte-level writes happen via the deterministic-ish Apply path.

For a competitor: Fast Apply is a critical hidden moat. Any agent that asks a frontier model to emit final file bytes will be 10× slower and noticeably less precise on small edits to large files.

## 7. Tab completion's relationship to Composer

Cursor's Tab is a different, smaller proprietary model trained for next-edit prediction — not next-token completion [source: https://cursor.com/help/ai-features/tab; https://neon.com/blog/tab-coding-cursor]:

- **Architecture.** Sparse MoE optimised for "prefill-heavy, decode-light" workloads: ingest huge context, emit small diffs.
- **Context window.** Cursor cites ~**272k tokens** of context via codebase indexing.
- **RL retraining loop.** The Tab model is retrained roughly every 90 minutes against accept/reject signal: reward +0.75 for accepts, -0.25 for rejects, 0 for "no suggestion shown." After integrating "should I even show a suggestion" into the policy itself: **21% fewer suggestions, 28% higher acceptance rate** [source: https://neon.com/blog/tab-coding-cursor].
- **Beyond text.** Tab can predict where the cursor should move next, edit existing code (not just insert), and propose changes across multiple files.

**Interaction with Composer.** Tab edits go through the same file system as Composer edits. A Tab accept that happens mid-Composer run becomes part of the working tree the next Composer tool call reads. The two models do not share context windows or weights; they share the editor's buffer and indexer. (This is partially inferred — Cursor doesn't publish a clean spec of the two-model interaction.)

## 8. Benchmark numbers

Cursor's published 2.5 numbers (and the third-party reports tracking them):

- **SWE-bench Multilingual: 79.8%** — same as Claude Opus 4.7 [source: https://the-decoder.com/cursors-composer-2-5-matches-opus-4-7-and-gpt-5-5-benchmarks-at-a-fraction-of-the-cost/; https://officechai.com/ai/cursor-composer-2-5-benchmarks/].
- **CursorBench v3.1: 63.2%** — Cursor's internal eval, parity claimed with Opus 4.7 and GPT-5.5.
- **Cost-per-task: under $1** on the standard tier, vs reported ~$11 per task for frontier competitors [source: https://the-decoder.com/cursors-composer-2-5-matches-opus-4-7-and-gpt-5-5-benchmarks-at-a-fraction-of-the-cost/].
- **Pricing.** Standard $0.50 / $2.50 per M input/output tokens; Fast variant $3.00 / $15.00 per M [source: https://cursor.com/blog/composer-2-5].
- **Optimizer step: 0.2s** on the 1T model — infra brag, not a user-facing latency figure.

Caveats: Cursor historically did not publish SWE-bench scores for the original Composer, relying solely on CursorBench [source: https://medium.com/data-science-collective/how-cursor-actually-works-c0702d5d91a9]. The 79.8% on the multilingual variant is new transparency for 2.5; it is also a notably softer benchmark than full SWE-bench Verified.

## 9. Architecture quirks (what's public, what's reverse-engineered)

- **Priompt** is open-sourced and reveals Cursor's "priority-tagged JSX prompt with binary-search truncation" pattern.
- **Leaked system prompts.** The `x1xhlol/system-prompts-and-models-of-ai-tools` repo (138k stars) contains `Agent Prompt v1.0.txt`, `v1.2.txt`, `2.0.txt`, `Agent CLI Prompt 2025-08-07.txt`, `Agent Prompt 2025-09-03.txt`, `Agent Tools v1.0.json`, and `Chat Prompt.txt` [source: https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools]. The persona line — "You are an AI coding assistant, powered by GPT-4.1. You operate in Cursor." — confirms that pre-Composer-1, Cursor swapped frontier base models into a stable prompt scaffold. The tool list above (§3) and the "keep going until the user's query is completely resolved" framing are taken from these leaks.
- **Indexing pipeline.** Tree-sitter splits + Merkle-tree sync + Turbopuffer embeddings + 7B CodeLlama reranker over 500k-token windows, with KV-cache reuse via blob storage cited as a 20× cost reduction [source: https://medium.com/data-science-collective/how-cursor-actually-works-c0702d5d91a9].
- **Multi-agent / parallel agents** (Cursor 2.0+). Up to 8 agents can run in parallel against Git worktrees or remote machines, each in an isolated workspace, with the user playing PR reviewer [source: https://cursor.com/blog/2-0; https://www.artezio.com/pressroom/blog/revolutionizes-architecture-proprietary/]. Composer 2.5 inherits this; nothing in the 2.5 announcement changed it.
- **Hidden router.** No public confirmation Cursor routes between Composer and frontier models on a per-message basis, but the existence of a "standard" vs "fast" tier and an Opus/GPT-5.5 dropdown suggests a user-chosen rather than auto-routed system.

## 10. Known limitations and complaints

From the official forum's "Share your Thoughts on Composer 2.5" thread [source: https://forum.cursor.com/t/share-your-thoughts-on-composer-2-5/160935] and the older "Hallucination in Composer" thread [source: https://forum.cursor.com/t/hallucination-in-composer/36390]:

- **Effort calibration is unreliable.** Users have to re-ask with explicit "think harder" prompts three or four times to coax deeper analysis. Composer is "willing to think with you" tonally (a 2.5 win over 2.0's "antagonistic" tone) but still tends to do the minimum work it can get away with.
- **Fast variant is too slow.** Forum reports of "~5 tokens/sec on the fast variant, not really usable" undercut the "cheaper than frontier fast tiers" pitch.
- **Logic shallowness.** Users report n+1 query patterns, struggles with simple plotting tasks, "beginner mistakes" — typical of an MoE optimised for breadth/speed over reasoning depth.
- **Hallucinations on long sessions.** "After a few hours of using Composer it can start to hallucinate" — drift sets in well before the context window fills, suggesting Cursor's context-pruning heuristics drop something the model needed.
- **Usage caps.** Ultra-plan users hit limits in 5-6 days. The 2× promotional credit for the first week eased this but didn't fix the structural complaint.
- **Context window asks.** Users want 240-250k token windows exposed; Kimi K2.5 natively supports 256k, but Cursor exposes less — likely because the reranker + Priompt stack is tuned for tighter context.
- **Plan mode is underused.** Even Cursor's own docs acknowledge it. The default of jumping into Agent leaves Plan as a power-user surface.

For a competitor, the cleanest wedge is **deeper reasoning per turn at the cost of speed** — Composer 2.5 is explicitly engineered for breadth and throughput, and Cursor leaves the "I want the model to actually think" gap open by design.

---

## Open questions

- **Exact router behaviour.** Does any silent routing happen between Composer "standard" and "fast" variants, or between Composer and frontier models when Composer fails verification? Nothing public confirms this either way.
- **Apply model version under 2.5.** Is Fast Apply still the Llama-3-70B fine-tune from 2024, or has Cursor upgraded it (e.g. to Llama-3.1/4 or a Kimi-based fine-tune) in lockstep with Composer 2.5? No public statement.
- **MCP integration depth.** The leaked Agent tool list doesn't enumerate MCP servers as first-class tools; whether MCP tools are surfaced via a generic `mcp_call` shim or by dynamic schema injection isn't documented.
- **Composer 2.5 token budget at runtime.** Kimi K2.5 supports 256k. Cursor's effective window after Priompt assembly and reranker output is not stated.
- **RL environment count for 2.5 specifically.** The original Composer announcement cited "hundreds of thousands of concurrent sandboxed environments"; whether 2.5's "25× more synthetic tasks" implies a comparable increase in environment count or just task diversity is unclear.
- **CursorBench v3.1 composition.** The eval is proprietary; what it actually measures (and how it differs from SWE-bench) has not been published.
- **Background Agents and Composer 2.5.** Cursor's Background Agents (remote/async) presumably use Composer 2.5 under the hood, but explicit confirmation and any model-swap behaviour for long async runs isn't published.
- **Effort-calibration mechanism.** Cursor mentions "effort calibration" as a behavioural training target but doesn't describe how the model decides depth-of-think per turn. Forum complaints suggest it's a learned heuristic that users can't reliably influence with prompt tweaks alone.
