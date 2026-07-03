/**
 * Parse the brain's `eri code-job` JSONL stdout — Phase 3 worker.
 *
 * `eri code-job` streams one JSON object per line: progress lines carry `stage`
 * (`CodeProgress.wire()`), the FINAL line carries `kind` (`CodeOutcome.wire()`).
 * Diagnostics go to stderr, but a stray non-JSON line on stdout must never crash
 * the worker — so this is defensive: anything it can't validate returns null and
 * is skipped. Pure + unit-tested.
 */

import type { CodeOutcome, CodeOutcomeKind, CodeProgress, CodeStage } from "./contract";

const STAGES: ReadonlySet<string> = new Set(["plan", "edit", "test", "commit", "pr"]);
const KINDS: ReadonlySet<string> = new Set(["opened", "updated", "testsRed", "halted", "refused"]);

export type ParsedLine =
  | { kind: "progress"; event: CodeProgress }
  | { kind: "outcome"; outcome: CodeOutcome };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A never-empty closing bubble when the brain didn't compose one (defensive). */
function outcomeFallbackText(kind: CodeOutcomeKind): string {
  switch (kind) {
    case "opened": return "opened a PR 🌿";
    case "updated": return "pushed another commit to the PR 🌿";
    case "testsRed": return "couldn't get it green — i didn't open a PR.";
    case "halted": return "i had to stop that one partway.";
    case "refused": return "i can't do that one.";
  }
}

/**
 * Parse one JSONL line into a typed progress event or terminal outcome. Returns
 * null for blank lines, non-JSON, or an object whose `stage`/`kind` isn't a known
 * value — so junk on stdout is silently skipped, never fatal.
 */
export function parseJsonlLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null; // a stray diagnostic on stdout, not a wire frame
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;

  // Terminal outcome — discriminated by `kind`.
  const kind = str(rec.kind);
  if (kind !== undefined) {
    if (!KINDS.has(kind)) return null;
    const k = kind as CodeOutcomeKind;
    return {
      kind: "outcome",
      outcome: {
        kind: k,
        text: str(rec.text)?.trim() ? String(rec.text) : outcomeFallbackText(k),
        number: num(rec.number),
        url: str(rec.url),
        summary: str(rec.summary),
        reason: str(rec.reason),
      },
    };
  }

  // Progress milestone — discriminated by `stage`.
  const stage = str(rec.stage);
  if (stage !== undefined && STAGES.has(stage)) {
    const text = str(rec.text) ?? "";
    // Carry the stage-specific fields through untyped-but-safe (they're advisory).
    return {
      kind: "progress",
      event: { ...(rec as object), stage: stage as CodeStage, text } as CodeProgress,
    };
  }

  return null;
}
