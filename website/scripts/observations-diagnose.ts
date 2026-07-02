/**
 * Probe Composio GMAIL_FETCH_EMAILS paging mechanics for the observations fix:
 *  - the max_results cap (limit>=50 reportedly empties)
 *  - page_token / pageToken forward paging (to honor a large `limit`)
 *  - `before:` backward paging (for deep history)
 *
 *   cd website && npx tsx scripts/observations-diagnose.ts [userId]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* env */ }

import { Composio } from "@composio/core";
import { GMAIL_FETCH_TOOL } from "@/lib/agent/connectors";

async function exec(composio: Composio, userId: string, args: Record<string, unknown>) {
  const r = (await composio.tools
    .execute(GMAIL_FETCH_TOOL, { userId, arguments: args, version: "latest", dangerouslySkipVersionCheck: true })
    .catch((e) => ({ __throw: e instanceof Error ? e.message : String(e) }))) as Record<string, unknown>;
  if (r.__throw) return { threw: String(r.__throw) };
  const data = (r.data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(data.messages) ? (data.messages as Record<string, unknown>[]) : [];
  return {
    successful: r.successful,
    error: r.error,
    rows: rows.length,
    nextPageToken: data.nextPageToken ?? data.next_page_token ?? null,
    firstId: rows[0]?.messageId,
    execMsg: (data.composio_execution_message as string | undefined)?.slice(0, 120),
  };
}

async function main(): Promise<void> {
  const userId = process.argv[2] ?? "usr_118616bec5b74da2a54c48161987357a";
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY ?? "" });

  console.log("=== max_results cap ===");
  for (const n of [10, 25, 40, 50, 100]) {
    console.log(`max_results=${n} →`, JSON.stringify(await exec(composio, userId, { query: "", max_results: n })));
  }

  console.log("\n=== forward paging via page_token ===");
  const p1 = await exec(composio, userId, { query: "", max_results: 10 });
  console.log("page1:", JSON.stringify(p1));
  const tok = (p1 as { nextPageToken?: unknown }).nextPageToken;
  if (typeof tok === "string" && tok) {
    console.log("page2 (page_token):", JSON.stringify(await exec(composio, userId, { query: "", max_results: 10, page_token: tok })));
    console.log("page2 (pageToken): ", JSON.stringify(await exec(composio, userId, { query: "", max_results: 10, pageToken: tok })));
  } else {
    console.log("no nextPageToken to page with");
  }

  console.log("\n=== backward paging via before: ===");
  const recentSec = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
  console.log(`before:${recentSec} →`, JSON.stringify(await exec(composio, userId, { query: `before:${recentSec}`, max_results: 5 })));
}

main().catch((e) => { console.error("diagnose failed:", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
