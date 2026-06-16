# eri personalization & learning loop — each user gets their own eri

Status: Design (R&D track, post-users) · Date: 2026-06-15 · See [ADR-0004](../adr/0004-hosted-eri-brain-inference-tier.md), the approved plan, and `[[project_composio_brain_execution]]`.

## Vision

One eri brain, but **each user's eri grows into their own** — it learns who they are and how they
like to work, from their daily use, and gets measurably better at *their* requests over time.
Two halves, both required:

1. **Great out of the box.** eri-brain (hosted dense model, leading pick Qwen3-32B) is already
   strong at the everyday work — email, calendar, summarizing, the Composio meta-tool flow,
   tool-use *restraint* — via base capability + a sharp system prompt + the memory context.
2. **Finetunes to the user.** From everyday interactions, eri adapts to each user without the
   user ever "training" anything explicitly.

**eri is the identity; the model is rented muscle.** Personalization lives in layers *above* and
*around* a model that can be swapped — so switching/upgrading the base never resets the
relationship.

## Three layers, cheapest-first

| Layer | When | Cost | What it personalizes |
|---|---|---|---|
| 1. Memory + prompt | **Now** (no training) | ~0 | Facts, preferences, tone, context — via the bi-temporal memory engine + token-budgeted MMR recall, injected per turn. Already gives each user a distinct eri. |
| 2. Per-user LoRA adapter | Phase 4 (post-data) | low (shared base) | Style, habits, recurring task shapes — a lightweight adapter per user, hot-swapped per request via **vLLM multi-LoRA** on the shared quantized base. Thousands of personalized eris on one warm GPU; no per-user model copy. |
| 3. Cohort / base improvements | Continuous | amortized | Fleet-wide skill gains rolled into the base or shared adapters. |

Anti-bloat guarantee: we **retrieve**, never dump. MMR recall caps memory tokens; the classifier
decides which memories/adapter to load per request. Connecting 20 apps or remembering 10k facts
never balloons the prompt.

## The learning loop (Layer 2/3 — the self-improvement engine)

```
daily use ──▶ behavioral signals ──▶ preference store ──▶ periodic LoRA train ──▶ multi-LoRA serve
   (implicit: kept / edited / rejected / regenerated;  explicit: 👍/👎, corrections, tone)
        ▲                                                                                │
        └──────────────────── escalation log measures falling Claude share ◀─────────────┘
```

- **Objective: KTO** (Kahneman-Tversky Optimization), not DPO. KTO learns from *binary* signals
  (this output was kept-good vs edited/rejected-bad) — exactly what implicit logging yields, with
  no need to construct matched preference pairs. Per-user (or cohort when a user is sparse) LoRA
  SFT/KTO on a cadence.
- **sia (hexo-ai/sia):** borrow the self-improvement *loop pattern*, do not port the code.
- **North-star metric:** the **Claude escalation share** (from the existing `ControlTurnSink`
  escalation log) should fall over time as memory + adapters improve — that falling number *is*
  "eri is outgrowing Claude" per user. Most everyday requests end up handled by eri-brain at 0
  Claude tokens; Claude stays the on-demand genius for genuinely hard work.

## What to build NOW (foundational, not gated on users)

The training data must start accruing **the day eri ships** — you cannot retroactively log it.

1. **Behavioral signal capture.** Record, per assistant turn: the prompt, the response, the engine
   that answered (eri-brain vs Claude), and the outcome signal — kept (sent/accepted as-is),
   edited (and the diff), rejected/regenerated, or explicit 👍/👎. Privacy: this is the user's own
   data, stored under the existing two-tier memory model (server-readable Tier-A profile vs E2E
   Tier-B blob) — design the signal store to respect that split.
2. **Escalation logging** already exists (`ControlTurnSink`) — extend it to the build loop so the
   Claude-share metric covers all surfaces.
3. **Provenance-clean from day one** (see below) — never let Claude/GPT outputs leak into the
   training corpus.

Then Phase 4 (once there's data): the train→serve pipeline (distilabel synthesis for cold-start
skills, KTO LoRA per user, vLLM multi-LoRA serving).

## Training approach: NO teacher — train the student directly on clean data + authored examples

**Decision (user, 2026-06-15): eri does NOT distill any teacher model.** Not Claude/GPT (ToS), and
not even a permissive teacher (DeepSeek-R1/Qwen). The student (Qwen eri-brain) is trained **directly
on data**: (a) existing **clean-provenance** datasets — human-written OR open-model-generated — and
(b) **eri-specific fine-tuning data we author ourselves** (hand-written prompts/responses). This is
simpler, fully owned, and provenance-clean by construction.

- **HARD RULE — never train on Claude/GPT outputs**, including eri's own Claude-on-CLI traces
  (those serve the user; they are walled off from the training corpus). The gate is provenance, not
  a dataset's license tag (an "MIT" set generated by GPT-4 is tainted).
- **Commercial-safe dataset mix** (permissive license AND clean provenance — human or open-model):
  chat = oasst2 + Dolly-15k + open-model/human Tulu-3 slices; tool-use = Glaive-FC-v2 + ToolACE +
  Hermes-FC-v1 + xlam-60k (DeepSeek/Mixtral-generated, no OpenAI taint); tool-use *restraint* =
  nvidia/When2Call + xlam-irrelevance (cut needless tool calls 60-83% w/ no accuracy loss);
  persona/warmth = Synthetic-Persona-Chat + everyday-conversations + PersonaChat. WildChat/LMSYS:
  human user turns only (+ LMSYS open-model assistant turns) for real query distribution + casual
  phrasing.
- **Author (don't distill) the eri-specific data** — there's no off-the-shelf set for these, so we
  WRITE them as curated prompt/response (and preference) examples, optionally bootstrapped by an
  *open* model and human-reviewed, never by Claude/GPT:
  - Composio meta-tool traces: `COMPOSIO_SEARCH_TOOLS → GET_TOOL_SCHEMAS → MULTI_EXECUTE` flows.
  - eri persona/voice/tone (warm, natural, texting register; never names tools — see invisibility).
  - tool-use restraint (when NOT to reach for a tool) + the mode-routing style.
- **Off-limits** (NC license or GPT/Claude-distilled): APIGen-MT-5k, ToolBench, UltraChat,
  OpenHermes-2.5, Orca, Capybara, No-Robots.

## References
- KTO: arXiv 2402.01306 · DPO: 2305.18290 · When2Call (tool restraint): 2504.18851 · APIGen/xLAM:
  2406.18518 · vLLM multi-LoRA (incl. MoE, ≥0.15): docs.vllm.ai/features/lora · S-LoRA: 2311.03285.
