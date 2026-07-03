/**
 * Diagnose the Gmail-over-iMessage read path — runs the EXACT call the reply path
 * uses (`composio.tools.execute("GMAIL_FETCH_EMAILS", { userId, arguments })`) and
 * prints the raw result, so we see whether it's the connection, the args, the
 * action slug, or the user/entity mapping.
 *
 *   cd website && npx tsx scripts/composio-gmail-diagnose.ts [userId]
 *   (defaults to bellkaizen's usr_…; COMPOSIO_API_KEY auto-loaded from .env.local)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* rely on real env */
}

import { Composio } from "@composio/core";

const GMAIL_FETCH_TOOL = "GMAIL_FETCH_EMAILS";
const DEFAULT_USER = "usr_118616bec5b74da2a54c48161987357a"; // bellkaizen

/* eslint-disable no-console */
function show(label: string, value: unknown): void {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  console.log(label, s && s.length > 1800 ? s.slice(0, 1800) + " …(truncated)" : s);
}

async function main(): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY not set (.env.local)");
  const userId = process.argv[2] ?? DEFAULT_USER;
  const composio = new Composio({ apiKey });
  console.log(`\n=== Composio Gmail diagnose — userId=${userId} ===\n`);

  // 1. Does the active gmail connected account resolve for this user?
  try {
    const accounts = await composio.connectedAccounts.list({ userIds: [userId] });
    const items = (accounts as { items?: unknown[] }).items ?? accounts;
    show("connectedAccounts.list →", items);
  } catch (e) {
    console.error("connectedAccounts.list THREW:", e instanceof Error ? e.message : e);
  }

  // 2. Run the EXACT execute the reply path runs.
  const afterSec = Math.floor((Date.now() - 24 * 60 * 60_000) / 1000);
  const args = { query: `(is:unread OR is:important) after:${afterSec}`, max_results: 5 };
  console.log(`\n--- execute ${GMAIL_FETCH_TOOL}  args=${JSON.stringify(args)} ---`);
  try {
    const result = (await composio.tools.execute(GMAIL_FETCH_TOOL, {
      userId,
      arguments: args,
      version: "latest",
      dangerouslySkipVersionCheck: true,
    })) as {
      successful?: boolean;
      error?: unknown;
      data?: unknown;
    };
    console.log("successful:", result?.successful);
    console.log("error:", result?.error);
    const data = result?.data;
    console.log("data keys:", data && typeof data === "object" ? Object.keys(data as object) : typeof data);
    const msgs = (data as { messages?: unknown[] })?.messages;
    if (Array.isArray(msgs) && msgs[0] && typeof msgs[0] === "object") {
      const m0 = msgs[0] as Record<string, unknown>;
      console.log("\nfirst message TOP-LEVEL keys:", Object.keys(m0));
      for (const k of ["sender", "subject", "from", "to", "preview", "messageText"]) {
        if (m0[k] !== undefined) console.log(`  top-level ${k}:`, String(m0[k]).slice(0, 80));
      }
      const payload = m0.payload as { headers?: Array<{ name?: string; value?: string }> } | undefined;
      if (Array.isArray(payload?.headers)) {
        console.log("  payload.headers names:", payload!.headers!.map((h) => h?.name).filter(Boolean).join(", "));
      }
    }
  } catch (e) {
    console.error("EXECUTE THREW:", e instanceof Error ? (e.stack ?? e.message) : e);
  }
}

main().catch((e) => {
  console.error("diagnose failed:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
