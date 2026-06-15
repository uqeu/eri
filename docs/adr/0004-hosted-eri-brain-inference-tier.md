# ADR-0004: eri's hosted brain — an always-warm GPU inference tier (supersedes the "no GPU" stance of ADR-0003)

- Status: Accepted
- Date: 2026-06-15
- Context: [[project_composio_brain_execution]]; the approved "token-frugal Composio + always-on eri brain" plan. Builds on ADR-0003 (infrastructure) and partially supersedes it.

## Context

ADR-0003 deliberately kept inference on Claude alone and **rejected a GPU/VPS** ("GPU
pricing unnecessary since Claude does inference, not local models"), favouring a fully
serverless + hosted footprint. Two things have since changed the calculus:

1. **Cost + latency of Claude-only.** Most everyday eri requests — write the email I just
   dictated, what's on my calendar, summarize this thread — do not need a frontier model.
   Paying Claude token rates (and round-trip latency) for them is wasteful. The 61→6 Composio
   Tool Router migration cut tool tokens, but the *reasoning* tokens still all go to Claude.
2. **The personalization moat requires a model we own.** "Each user gets their own eri" via
   per-user LoRA adapters, and the KTO self-improvement loop, are **impossible on a closed
   API** — they need weights we control. A hosted open model is a prerequisite, not a nicety.

## Decision

Add a **fifth tier** to the ADR-0003 infrastructure: **eri's own always-warm GPU pod serving
"eri-brain"**, a model-agnostic OpenAI-compatible endpoint.

1. **eri-brain is the primary engine; Claude is escalation.** eri-brain (a capable mid-size
   model) handles most requests end-to-end at ~0 marginal Claude cost; the loop escalates to
   Claude only for hard/high-stakes work (code, complex reasoning). The `BuildTurn`/`ControlTurn`
   traits are engine-agnostic, so **eri's identity (persona + memory) is assembled once and
   passed to whichever engine runs** — the user always talks to *eri*, never "Qwen"/"Claude".
2. **Model-agnostic by mandate.** The CLI points at an OpenAI-compatible endpoint via config
   (`ERI_BRAIN_URL`), never a hardcoded model. The leading pick is **dense Qwen3-32B
   (Apache-2.0)** — chosen over the Qwen3-30B-A3B MoE for mature vLLM multi-LoRA + stronger
   tool-calling (BFCL-v3 ~75.7), and over the newer Qwen3.5-35B-A3B whose LoRA is currently
   broken in vLLM. Final pick is settled by a bake-off on eri's own tasks before any
   fine-tuning spend. Switching models is a deploy/config change, never a rewrite.
3. **Serving.** vLLM, quantized (AWQ/GPTQ-INT4 or FP8), `--enable-lora` (vLLM ≥ 0.15 for MoE
   multi-LoRA), **always-warm — no scale-to-zero** (a 10-30s cold start would break the
   realtime requirement). Target: a single 24-48 GB card (~$245-580/mo).
4. **No BYOK.** Users get *eri's* brain (eri-brain + Claude), never their own API keys/models.
   The legacy <3 GB on-device Qwen2.5 tier is retired (it was never going to be eri's real
   brain) — "no local models" means *no user-supplied models*, not "no GPU".
5. **Personalization, phased.** Memory + prompt personalization first (no training; already
   real via the bi-temporal memory engine + token-budgeted MMR recall). Per-user LoRA adapters
   hot-swapped via vLLM multi-LoRA come later (Phase 4), once behavioural data exists. The
   self-improvement objective is **KTO** (learns from binary kept/edited/rejected signals).
6. **⚠️ Training-data provenance (binding legal constraint).** **Never distill Claude or GPT-4**
   to train eri's model — both ban industrial distillation (Feb 2026 ToS). **eri's own
   Claude-on-CLI traces must NOT be recycled into training data.** The teacher for any
   synthetic data is a **permissive model — DeepSeek-R1 or a large Qwen.** Provenance, not the
   dataset's license tag, is the gate.

## Consequences

- **Positive:** COGS falls as volume grows (cheap/frequent work leaves Claude); true realtime
  (warm GPU); model ownership unlocks per-user personalization + self-improvement (the moat);
  reinforces Composio/engine invisibility (one eri voice out).
- **Negative / cost:** a real fixed monthly GPU cost **pre-revenue**, and an always-on box to
  operate — a deliberate departure from ADR-0003's "almost nothing to babysit" serverless
  ethos. The model bake-off + fine-tuning + multi-LoRA serving are genuine R&D.
- **Supersedes** only ADR-0003's GPU-rejection / "Claude does inference" decision. The other
  ADR-0003 tiers stand: Vercel serverless cloud, the on-device `eri remote` daemon, hosted
  Composio connectors, and the deferred Fly worker. The GPU brain is an *added* tier.
- **Open item:** where the Composio Tool Router relay (Phase 1b — keeps the app key off user
  machines) should live. Co-locating it on this GPU server (holds secrets, low latency) is
  likely preferable to a Vercel relay; to be decided when this tier is provisioned.
