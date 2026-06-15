# eri-brain — always-warm hosted inference tier

eri's own brain: a model-agnostic, OpenAI-compatible vLLM endpoint that handles most
requests at ~0 marginal Claude cost and escalates to Claude only for hard work. See
[ADR-0004](../../docs/adr/0004-hosted-eri-brain-inference-tier.md).

**The CLI is model-agnostic** — it only needs `ERI_BRAIN_URL` (+ optional `ERI_BRAIN_KEY`).
Swapping the served model is a deploy/config change, never a code change.

## What to provision

An **always-warm GPU pod** (no scale-to-zero — a 10-30 s cold start breaks realtime):
- RunPod / Hetzner / similar, a single **24-48 GB** card.
  - 4090/A6000 (24-48 GB) runs a quantized dense ~32B comfortably (~$0.34-0.50/hr).
- vLLM **≥ 0.15** (required for MoE multi-LoRA; fine for dense too).

## Leading model (settle by bake-off before fine-tuning spend)

Dense **Qwen3-32B** (Apache-2.0) — chosen for mature vLLM multi-LoRA + strong tool-calling
(BFCL-v3 ~75.7), over the Qwen3-30B-A3B MoE (weaker agentic) and the newer Qwen3.5-35B-A3B
(LoRA currently broken in vLLM). Runner-ups to bench: Qwen3-30B-A3B (cheaper if quality
holds), GLM-4.5 (tops BFCL — verify self-host + LoRA + license).

## Serve

```bash
cp .env.example .env   # then edit
./serve.sh             # launches vLLM OpenAI server + warms it
```

Then point eri at it:

```bash
# eri appends "/v1/chat/completions" itself — give the ORIGIN, NOT a /v1 path.
export ERI_BRAIN_URL="https://<your-pod-host>"      # e.g. http://localhost:11434 for Ollama
export ERI_BRAIN_KEY="<the same key you set in .env>"
eri build "what's on my calendar today"             # answered by eri-brain, 0 Claude tokens
```

Verified end-to-end against a local Ollama (`ERI_BRAIN_URL=http://localhost:11434`,
`ERI_BRAIN_MODEL=llama3.2:3b`): eri-brain answered in one turn with no Claude escalation,
and an unreachable endpoint cleanly escalated to Claude.

## Notes

- `--enable-lora` is on so per-user LoRA adapters (Phase 4, KTO-trained) can be hot-swapped
  per request without a per-user model copy. No adapters are needed to start.
- Quantization (AWQ/GPTQ-INT4 or FP8) is opt-in via `ERI_BRAIN_QUANT` for higher tok/s + lower
  VRAM. Leave empty to serve full precision.
- **Never** train this model by distilling Claude/GPT (ToS); teacher = DeepSeek-R1 / large
  Qwen. eri's own Claude-CLI traces must not be recycled into training data (ADR-0004).
