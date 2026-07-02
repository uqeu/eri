/**
 * Streamed job status — Phase 3 P2 (+ the P3 PR-link reply, which is just the
 * pr-stage event / opened outcome relayed verbatim).
 *
 * The brain streams `CodeProgress` milestones into a durable job-status row
 * (CodeJobRecord); the phone polls it and texts each NEW event's `text` as a
 * bubble, showing typing between polls so eri is NEVER silent during a long job.
 * On settle it sends the outcome's closing bubble. The brain owns the voice — the
 * phone relays `text` verbatim (formatReply only strips markdown + length-chunks
 * for iMessage, it never re-words eri).
 *
 * The bubble computation (`newBubblesFromRecord`, `eventBubbles`) is pure +
 * unit-tested; `streamJob` is the thin poll loop around it.
 */

import { formatReply } from "@/lib/imessage/format";
import type { CodeJobRecord, CodeOutcome, CodeProgress } from "./contract";

/** How the phone shows typing + sends a job's live status bubbles (injected, so
 *  `streamJob` is transport-agnostic + testable). */
export interface StatusSink {
  /** Best-effort "eri is typing…"; must never throw. */
  sendTyping(): Promise<void>;
  /** Send the ordered status bubbles for this poll. */
  sendBubbles(chunks: string[]): Promise<void>;
}

/** One event → the bubble(s) to send. `text` verbatim, markdown-stripped + length-
 *  chunked for iMessage; blank text sends nothing. Works for a progress event or
 *  the terminal outcome (both carry `.text`). */
export function eventBubbles(event: CodeProgress | CodeOutcome): string[] {
  return event.text.trim() ? formatReply(event.text) : [];
}

export interface RecordBubbles {
  /** Bubbles for events (and the outcome) not yet sent. */
  bubbles: string[];
  /** New high-water mark of events consumed (pass back as `alreadySent` next poll). */
  sent: number;
  /** True once the job settled. */
  settled: boolean;
  /** The terminal outcome, or null while still running. */
  outcome: CodeOutcome | null;
}

/**
 * Given a job-status record and how many of its events were already sent, return
 * the bubbles for the NEW events — plus the outcome's closing bubble once settled.
 * Pure: the caller tracks `sent` across polls. Idempotent per record (re-reading
 * the same record with an up-to-date `sent` yields no bubbles).
 */
export function newBubblesFromRecord(record: CodeJobRecord, alreadySent: number): RecordBubbles {
  const fresh = record.events.slice(Math.max(0, alreadySent));
  const bubbles = fresh.flatMap(eventBubbles);
  const settled = record.phase === "settled";
  const outcome = record.outcome ?? null;
  if (settled && outcome) bubbles.push(...eventBubbles(outcome));
  return { bubbles, sent: record.events.length, settled, outcome };
}

export interface StreamOpts {
  /** Ms between polls (default 2000). */
  pollMs?: number;
  /** Max polls before giving up (default 300 ≈ 10 min at 2s) — bounds a hung job. */
  maxPolls?: number;
  /** Sleep impl (injected so tests don't wait). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Drive a job's progress to the user: poll → send new bubbles → typing → repeat,
 * until the job settles (returns its outcome) or the poll budget is exhausted
 * (returns null; the caller may send a "still working" note). A transient poll
 * error is retried, never fatal — a blip must not drop the user mid-job.
 */
export async function streamJob(
  client: { fetchRecord(jobId: string): Promise<CodeJobRecord> },
  jobId: string,
  sink: StatusSink,
  opts: StreamOpts = {},
): Promise<CodeOutcome | null> {
  const pollMs = opts.pollMs ?? 2000;
  const maxPolls = opts.maxPolls ?? 300;
  const sleep = opts.sleep ?? defaultSleep;

  let sent = 0;
  for (let poll = 0; poll < maxPolls; poll++) {
    let record: CodeJobRecord;
    try {
      record = await client.fetchRecord(jobId);
    } catch {
      // Transient poll failure → wait and retry; don't abandon the user mid-job.
      await sleep(pollMs);
      continue;
    }

    const next = newBubblesFromRecord(record, sent);
    if (next.bubbles.length) await sink.sendBubbles(next.bubbles);
    sent = next.sent;
    if (next.settled) return next.outcome;

    // Between milestones show typing so the wait reads as "working", not "gone".
    void sink.sendTyping().catch(() => {});
    await sleep(pollMs);
  }
  return null;
}
