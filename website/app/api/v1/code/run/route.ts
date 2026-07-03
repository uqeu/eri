// POST /api/v1/code/run — the coding-job worker Function (Phase 3).
//
// Kicked (internal, CODEJOB_INTERNAL_SECRET) by the phone kickoff. Runs the harness
// in a Vercel Sandbox and streams status bubbles to the user — both in the
// background (waitUntil) so this returns immediately. NO loop logic here: the Rust
// `eri code-job` owns edit→test→green→commit→PR + retries + the fail-closed gate;
// this forwards its JSONL into the CodeJobRecord row and relays each bubble.

import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { sqlCodeJobStore } from "@/lib/coding/job_store";
import { getUserGithubToken, spectrumSink } from "@/lib/coding/live";
import { vercelSandboxRun } from "@/lib/coding/sandbox";
import { streamJob } from "@/lib/coding/stream";
import { runCodeJob, type RunCodeJobInput } from "@/lib/coding/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A job runs up to its budget; give the Function room. (Vercel plan cap applies;
// jobs that outrun it are picked up by a relay backstop — a later add.)
export const maxDuration = 800;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CODEJOB_INTERNAL_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let input: RunCodeJobInput;
  try {
    input = (await request.json()) as RunCodeJobInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!input?.jobId || !input?.userId || !input?.repo || !input?.task) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const store = sqlCodeJobStore();
  waitUntil(
    Promise.all([
      runCodeJob(input, { store, githubToken: getUserGithubToken, runSandbox: vercelSandboxRun }),
      streamJob(
        {
          fetchRecord: async (id) => {
            const r = await store.read(id);
            if (!r) throw new Error(`code job ${id} not found`);
            return r;
          },
        },
        input.jobId,
        spectrumSink(input.userId),
        { pollMs: 3000, maxPolls: 300 },
      ),
    ]).catch(() => {}),
  );

  return NextResponse.json({ ok: true, jobId: input.jobId }, { status: 202 });
}
