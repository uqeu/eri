# ERI Graphify Alignment Notes

> Reference notes for the in-flight `eri_graph` crate. Goal: stay schema- and
> output-compatible with the real `graphify` project so users can move freely
> between eri's built-in live graph and graphify's external CLI tooling.

## What graphify is

[`safishamsi/graphify`](https://github.com/safishamsi/graphify) (PyPI:
`graphifyy`, CLI: `graphify`) is an AI-assistant skill that scans a folder of
code, docs, PDFs, images, videos, and SQL schemas and turns it into a queryable
knowledge graph. Code is parsed locally with tree-sitter (no API calls); docs,
PDFs, images, and audio/video go through whatever LLM backend is configured
(Anthropic, Gemini, OpenAI, DeepSeek, Kimi, Ollama, Bedrock, or `claude-cli`).
The output lives in `graphify-out/` and is meant to be committed to git so a
team's AI assistants share one map of the codebase.

- **License:** MIT
- **Default branch:** `v8` (active — last push 2026-05-17, 48k+ stars)
- **Vendoring:** MIT lets eri vendor or port any of the schema/output code with
  attribution. For our purposes, **schema compatibility is enough** — no need to
  pull in the Python sources.

## On-disk layout (`graphify-out/`)

```
graphify-out/
├── graph.json          # the data (NetworkX node-link JSON, see schema below)
├── graph.html          # interactive vis (cytoscape/pyvis-style)
├── GRAPH_REPORT.md     # human-readable highlights
├── manifest.json       # per-file {mtime, ast_hash, semantic_hash} for incremental rebuild
├── cost.json           # local LLM cost log (gitignored)
├── cache/              # extraction cache (optional commit)
├── .graphify_root      # marker file
├── .graphify_python    # python env marker
└── .graphify_labels.json
```

`manifest.json` keys are **absolute** filesystem paths (this breaks across
machines — the upstream `.gitignore` recommendation is to gitignore
`manifest.json` and `cost.json`).

## `graph.json` schema

Top-level shape is NetworkX `node_link_data`:

```jsonc
{
  "directed": false,
  "multigraph": false,
  "graph": {},                      // graph-level attrs (mostly empty)
  "built_at_commit": "<sha>",       // git SHA the graph was built against
  "nodes": [ /* Node */ ],
  "links": [ /* Edge */ ],          // NB: "links", not "edges"
  "hyperedges": [ /* Hyperedge */ ] // group relations spanning >2 nodes
}
```

### Node

```jsonc
{
  "id": "src_lmstudio_role",                 // stable slug; namespace_subpath_name pattern
  "label": "Role",                            // display name
  "norm_label": "role",                       // lowercased / normalized for dedup
  "file_type": "code",                        // code | concept | document | rationale | image | paper
  "source_file": "lmstudio/src/lmstudio.rs",  // repo-relative
  "source_location": "L12",                   // line ref ("L12" or "L12-L40")
  "community": 343                            // integer cluster id (Leiden/Louvain output)
}
```

Observed `file_type` distribution in this repo's existing
`graphify-out/graph.json` (52k nodes total): `code` (51920), `concept` (60),
`document` (40), `rationale` (17), `image` (6), `paper` (1).

### Edge (a.k.a. "link")

```jsonc
{
  "source": "lmstudio_src_lmstudio_rs",       // node id
  "target": "src_lmstudio_role",              // node id
  "relation": "contains",                     // see enum below
  "confidence": "EXTRACTED",                  // EXTRACTED | INFERRED | AMBIGUOUS
  "confidence_score": 1.0,                    // 0.0..1.0
  "weight": 1.0,                              // edge weight for vis/centrality
  "source_file": "lmstudio/src/lmstudio.rs",
  "source_location": "L12"
}
```

Relation vocabulary observed (top of long tail in this repo):
`calls`, `method`, `contains`, `references`, `conceptually_related_to`,
`rationale_for`, `semantically_similar_to`, `implements`, `defines`, `cites`,
`uses`, `inherits`.

### Hyperedge (group / community concept)

```jsonc
{
  "id": "skill_security_gates",
  "label": "Layered Skill Security Gates",
  "nodes": ["agent_skills_worktree_trust_gate", "..."],
  "relation": "form",                         // form | participate_in (most common)
  "confidence": "EXTRACTED",
  "confidence_score": 0.95,
  "source_file": "crates/agent_skills/README.md"
}
```

### `manifest.json` schema

```jsonc
{
  "<absolute_path>": {
    "mtime": 1778702028.24,        // float epoch seconds
    "ast_hash": "<md5/sha>",       // hash of tree-sitter AST
    "semantic_hash": "<md5/sha>"   // hash of LLM-extracted semantic facts
  }
}
```

`ast_hash` and `semantic_hash` are intentionally separate so a docstring-only
edit can skip the AST pass and vice versa.

## CLI surface worth knowing

```
graphify .                         # build graph for cwd → graphify-out/
graphify --update                  # incremental, only changed files (uses manifest)
graphify --cluster-only            # recluster without re-extracting
graphify query "<question>"        # NL query over graph.json
graphify path A B                  # shortest path between two node labels
graphify explain "NodeLabel"       # neighbors + rationale
graphify export callflow-html      # Mermaid call-flow page
graphify merge-graphs a.json b.json --out merged.json
graphify global add graph.json <name>   # cross-project graph at ~/.graphify/global.json
python -m graphify.serve graph.json     # MCP stdio server (query_graph, get_node, get_neighbors, shortest_path)
```

## Alignment recommendations for `eri_graph`

These are the concrete things to match so an `eri_graph -> graphify` exporter
is a no-op rename, and graphify users feel at home.

### 1. Mirror the NetworkX node-link shape exactly when serializing JSON

Use the keys `directed`, `multigraph`, `graph`, `nodes`, `links` (not
`edges`), `hyperedges`, `built_at_commit`. Even if eri's in-memory graph is a
`petgraph::Graph` with typed nodes/edges, the JSON exporter should produce
exactly this layout. `directed: false` and `multigraph: false` are the
graphify defaults; eri can match.

### 2. Reuse the exact field names and enum values

- Nodes: `id`, `label`, `norm_label`, `file_type`, `source_file`,
  `source_location`, `community`.
- Edges: `source`, `target`, `relation`, `confidence`, `confidence_score`,
  `weight`, `source_file`, `source_location`.
- `confidence` is a **3-value enum** — `EXTRACTED` | `INFERRED` | `AMBIGUOUS`.
  Don't invent a fourth bucket; map eri's internal certainty to one of these.
- `file_type` enum: `code` | `concept` | `document` | `rationale` | `image` |
  `paper`. Anything eri adds (e.g. a `voice` or `gaze` file_type) should be
  added carefully — graphify's HTML viewer styles by these values.
- `source_location` is a string like `"L12"` or `"L12-L40"`, not an integer.
- `source_file` paths are **repo-relative** in nodes/edges, but **absolute** in
  `manifest.json`. Match this split.

### 3. Output directory and filenames

When eri's in-process graph is asked to dump to disk for graphify-compat:

- Write to `graphify-out/` (NOT `eri-graph/` or similar).
- Filenames: `graph.json`, `manifest.json`. Skip `graph.html` and
  `GRAPH_REPORT.md` unless eri actually generates them — leaving stale ones
  is worse than missing.
- Drop the `.graphify_root` marker so the `graphify` CLI recognizes the
  directory and `graphify --update` works as an external follow-up.
- Embed `built_at_commit` from `git rev-parse HEAD` when available.

### 4. Stable node IDs follow the `<namespace>_<path_segments>_<name>` slug pattern

Observed IDs: `lmstudio_src_lmstudio_rs`, `src_lmstudio_role`,
`src_lmstudio_model_supports_tool_calls`. They are:

- lowercase
- underscore-separated
- file-derived prefix collapsing `/` and `.` to `_`
- method nodes append the method name with no extra punctuation
  (`...model_supports_tool_calls`, not `..model::supports_tool_calls`)

`norm_label` is the lowercased version of `label`. Method labels keep the
leading dot (`.supports_tool_calls()`). Stay bug-for-bug compatible — graphify's
dedup logic depends on this.

### 5. TOON-style serializer should preserve graphify's vocabulary

If eri's TOON serializer (the one being built alongside `eri_graph`) is
producing a more readable form for LLM prompts, keep the **same keys and enum
values** so a human (or model) reading TOON output and graphify JSON sees the
same word for the same thing. Concretely:

- Use `relation:` not `kind:` or `type:` for edge kind.
- Use `confidence:` for the enum and `confidence_score:` for the float —
  splitting them, not collapsing into a single field.
- Use `source_file` / `source_location` (snake_case), not `file`/`line`.

### Bonus: things to skip safely

- `community` integers can be omitted from TOON output (only useful for vis).
- `hyperedges` are rare (9 of them in this repo's 52k-node graph) — eri can
  emit an empty list if it has no group-relation concept yet, and that's
  schema-valid.

## License

MIT. We can read sources, port logic, vendor snippets with attribution, or
just stay schema-compatible. Recommended path for eri: **schema-compatible
exporter**, no vendored code. If we later want graphify's clustering
(Leiden/Louvain on networkx) we can either shell out to the `graphify` CLI on
the JSON we wrote, or port a small subset.

## When to use which

| Dimension              | `eri_graph` (in-process)        | `graphify` (external CLI)              |
| ---------------------- | ------------------------------- | -------------------------------------- |
| Lifecycle              | Live, incremental, in-memory    | Batch run, writes to disk              |
| Latency                | Sub-second updates              | Seconds to minutes per scan            |
| Where it runs          | Inside eri's Rust process       | External Python CLI (`pipx`/`uv tool`) |
| Storage                | RAM (optional dump to disk)     | `graphify-out/graph.json` on disk      |
| Update model           | Reactive (file watch, in-proc)  | `--update` re-scans changed files      |
| Extraction             | Whatever eri's iterator emits   | tree-sitter (code) + LLM (docs/media)  |
| Visualization          | eri's own UI                    | `graph.html`, Obsidian, GraphML, SVG   |
| Cross-repo / global    | Per-eri-session                 | `~/.graphify/global.json`              |
| Best for               | Steering during a session       | Onboarding, PR review, offline query   |
| Interop                | Export to `graphify-out/`       | Consume eri-exported `graph.json`      |
