#!/usr/bin/env bash
# Launch eri-brain: a vLLM OpenAI-compatible server, always-warm. See README.md + ADR-0004.
# Model-agnostic — everything comes from .env so swapping models never touches eri's code.
set -euo pipefail

cd "$(dirname "$0")"
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi

: "${ERI_BRAIN_MODEL:?set ERI_BRAIN_MODEL (see .env.example)}"
: "${ERI_BRAIN_KEY:?set ERI_BRAIN_KEY (see .env.example)}"
ERI_BRAIN_HOST="${ERI_BRAIN_HOST:-0.0.0.0}"
ERI_BRAIN_PORT="${ERI_BRAIN_PORT:-8000}"
ERI_BRAIN_MAX_LEN="${ERI_BRAIN_MAX_LEN:-32768}"
ERI_BRAIN_GPU_UTIL="${ERI_BRAIN_GPU_UTIL:-0.92}"

# vLLM >= 0.15 is required for MoE multi-LoRA (fine for dense too). --enable-lora lets us
# hot-swap per-user adapters (Phase 4) with no per-user model copy.
args=(
  --model "$ERI_BRAIN_MODEL"
  --host "$ERI_BRAIN_HOST"
  --port "$ERI_BRAIN_PORT"
  --api-key "$ERI_BRAIN_KEY"
  --max-model-len "$ERI_BRAIN_MAX_LEN"
  --gpu-memory-utilization "$ERI_BRAIN_GPU_UTIL"
  --enable-lora
  --enable-auto-tool-choice
)
# Tool-call parser so the OpenAI `tools` API works (eri-brain is a full agent). Qwen uses
# the "hermes" parser; change if you serve a different family.
args+=( --tool-call-parser "${ERI_BRAIN_TOOL_PARSER:-hermes}" )

if [[ -n "${ERI_BRAIN_QUANT:-}" ]]; then
  args+=( --quantization "$ERI_BRAIN_QUANT" )
fi

echo "[eri-brain] starting vLLM: model=$ERI_BRAIN_MODEL quant=${ERI_BRAIN_QUANT:-none} port=$ERI_BRAIN_PORT"

# Warm the endpoint in the background so the first real request isn't cold.
(
  base="http://127.0.0.1:${ERI_BRAIN_PORT}"
  for _ in $(seq 1 120); do
    if curl -sf -H "Authorization: Bearer ${ERI_BRAIN_KEY}" "${base}/v1/models" >/dev/null 2>&1; then
      curl -sf -X POST "${base}/v1/chat/completions" \
        -H "Authorization: Bearer ${ERI_BRAIN_KEY}" -H "Content-Type: application/json" \
        -d "{\"model\":\"${ERI_BRAIN_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1}" \
        >/dev/null 2>&1 || true
      echo "[eri-brain] warmed."
      break
    fi
    sleep 2
  done
) &

exec python -m vllm.entrypoints.openai.api_server "${args[@]}"
