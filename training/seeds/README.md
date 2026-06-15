# SEED TEMPLATES — structural scaffolding, NOT training data

The `*.jsonl` files in this directory are **seed templates**. They illustrate the
**target schema + structure** for each eri-specific category — for example the
`COMPOSIO_SEARCH_TOOLS → COMPOSIO_GET_TOOL_SCHEMAS → COMPOSIO_MULTI_EXECUTE_TOOL → natural answer`
sequence in `meta_tools.jsonl`, or eri's warm texting register in `persona.jsonl`.

> **These are NOT training data.** They were Claude-authored, so they are *provenance-tainted*
> and must never enter the training corpus (HARD RULE — see
> [`../../docs/architecture/personalization-learning-loop.md`](../../docs/architecture/personalization-learning-loop.md)).

## What they are for

`generate_eri_data.py` loads these as **structural few-shot scaffolding** — they show the
generator *the shape* an example must take (roles, the tool-call/tool-response interleave, the
invisibility of tool names in the assistant's natural-language reply, the per-category voice).
The model sees the structure and produces *fresh, varied* examples in the same shape.

## What they are NOT

- They are **not** copied into `eri_data/`.
- They are **not** counted as training examples.
- They carry `"meta":{"provenance":"seed-template"}` so the validator can tell them apart from
  generated training data and exempt them from the "is this real training data?" provenance rule
  (it still validates their messages schema + invisibility lint).

## The actual training examples

The real eri training examples are **generated fresh by open models** (Kimi K2.7 Code via the
Moonshot API, or local Qwen/DeepSeek via Ollama) and written to `../eri_data/`. The generated text
is the open model's output → **provenance-clean by construction**. Claude only orchestrates the
pipeline; it never authors a training example.

Keep these seeds **minimal and structural** — one or two clean exemplars per category is enough
to anchor the schema. Add more shapes here only when introducing a genuinely new structure.

## Files

| file | structure it anchors |
|---|---|
| `meta_tools.jsonl` | Composio meta-tool flow (search → schemas → multi-execute → natural answer) |
| `persona.jsonl`    | eri's voice (warm, concise, texting register; never names tools) |
| `restraint.jsonl`  | answer directly without a tool when appropriate |
| `routing.jsonl`    | build vs control vs answer vs chat mode feel |
