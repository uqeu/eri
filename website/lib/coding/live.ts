/**
 * Live wiring for the coding-job feature — Phase 3. The real deps behind the
 * kickoff + worker seams: repo resolution, GitHub token, the status sink (texts
 * bubbles over Spectrum), the job-id mint, and the worker kick (internal POST to
 * /api/v1/code/run). Only reached behind the ERI_CODEJOB_ENABLED kill-switch, so
 * none of this runs in prod until the operator turns the feature on.
 */

import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { sendProactiveMessage } from "@/lib/messaging/spectrum";
import type { RepoResolution } from "./contract";
import type { StatusSink } from "./stream";
import type { RunCodeJobInput } from "./worker";

export function mintJobId(): string {
  return `job_${randomBytes(9).toString("base64url")}`;
}

/** True if the user has an active GitHub connection (Composio). */
export async function githubConnected(userId: string): Promise<boolean> {
  try {
    const rows = await sql()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM composio_accounts
      WHERE user_id = ${userId} AND toolkit = 'github' AND status = 'active'
    `;
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Phone-side repo resolution for kickoff. An explicit `owner/name` while GitHub is
 * connected → resolved: the user's own token scopes actual access, so a repo they
 * can't reach fails safe as `halted` in the sandbox, never a cross-user reach. A
 * bare name / no hint → ask (or prompt connect when GitHub isn't linked).
 */
export async function resolveRepoLive(userId: string, hint: string | null): Promise<RepoResolution> {
  if (!(await githubConnected(userId))) return { kind: "needs_connect", hint };
  if (hint && hint.includes("/")) return { kind: "resolved", repo: hint };
  return hint ? { kind: "ambiguous", hint } : { kind: "no_hint" };
}

/** The URL to text the user for connecting GitHub (P4). */
export async function connectGithubUrl(_userId: string, _hint: string | null): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://www.tryeri.ca";
  return `${base}/connections`;
}

/**
 * The user's GitHub token for `git clone`. DEPLOY-SEAM: the raw-token source
 * (Composio raw-credential export or the eri GitHub App installation token) is
 * wired at deploy. Until then this returns null → the worker settles the job as
 * `halted` ("reconnect GitHub"), which fails CLOSED — never a cross-user reach,
 * never a crash.
 */
export async function getUserGithubToken(_userId: string): Promise<string | null> {
  return null;
}

/** Resolve the user's verified phone number (for cold outbound status texts). */
async function resolveUserPhone(userId: string): Promise<string | null> {
  try {
    const rows = await sql()<{ phone_e164: string }[]>`
      SELECT phone_e164 FROM phone_links
      WHERE user_id = ${userId} AND verified_at IS NOT NULL
      ORDER BY verified_at DESC LIMIT 1
    `;
    return rows[0]?.phone_e164 ?? null;
  } catch {
    return null;
  }
}

/** A StatusSink that texts the user their job's live bubbles over Spectrum. */
export function spectrumSink(userId: string): StatusSink {
  return {
    sendTyping: async () => {},
    sendBubbles: async (chunks) => {
      if (!chunks.length) return;
      const phone = await resolveUserPhone(userId);
      if (phone) await sendProactiveMessage(phone, chunks).catch(() => false);
    },
  };
}

/** Fire the worker for a job — internal POST to /api/v1/code/run, returns fast. */
export async function kickCodeJob(input: RunCodeJobInput): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://www.tryeri.ca";
  const secret = process.env.CODEJOB_INTERNAL_SECRET;
  if (!secret) throw new Error("CODEJOB_INTERNAL_SECRET not configured");
  await fetch(`${base}/api/v1/code/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(input),
  });
}
