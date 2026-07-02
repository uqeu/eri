/**
 * Isolate WHY /connections/observations returns empty for a real principal.
 * Runs the real Composio Gmail fetch across query variants + maps each, printing
 * per-stage counts so the empty is pinned to fetch vs map vs the ts>0 filter.
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
} catch { /* rely on env */ }

import { Composio } from "@composio/core";
import { GMAIL_FETCH_TOOL } from "@/lib/agent/connectors";
import { emailToObservation } from "@/lib/connections/observations";

async function main(): Promise<void> {
  const userId = process.argv[2] ?? "usr_118616bec5b74da2a54c48161987357a";
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY ?? "" });

  const recentSec = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
  const queries = ["after:0", `after:${recentSec}`, ""];

  for (const query of queries) {
    const r = (await composio.tools.execute(GMAIL_FETCH_TOOL, {
      userId,
      arguments: { query, max_results: 10 },
      version: "latest",
      dangerouslySkipVersionCheck: true,
    }).catch((e) => ({ __throw: e instanceof Error ? e.message : String(e) }))) as Record<string, unknown>;

    if (r.__throw) {
      console.log(`\nquery="${query}" → THREW: ${r.__throw}`);
      continue;
    }
    const data = (r.data ?? {}) as Record<string, unknown>;
    const rows = Array.isArray(data.messages) ? (data.messages as Record<string, unknown>[]) : [];
    console.log(`\nquery="${query}" → successful=${r.successful} error=${JSON.stringify(r.error)} dataKeys=${JSON.stringify(Object.keys(data))} rows=${rows.length}`);
    const row = rows[0];
    if (row) {
      console.log("  first row keys:", Object.keys(row).join(", "));
      console.log("  date fields:", JSON.stringify({ messageTimestamp: row.messageTimestamp, internalDate: row.internalDate, date: row.date, sender: row.sender, subject: row.subject, messageId: row.messageId }));
      const o = emailToObservation(row);
      console.log("  emailToObservation:", o ? JSON.stringify({ sourceId: o.sourceId, ts: o.ts, tsGt0: o.ts > 0 }) : "NULL (missing id/from/subject)");
      const mapped = rows.map(emailToObservation);
      const nonNull = mapped.filter((x) => x !== null);
      const tsGt0 = nonNull.filter((x) => x!.ts > 0);
      console.log(`  → mapped ${nonNull.length}/${rows.length}, survive ts>0: ${tsGt0.length}`);
    }
  }
}

main().catch((e) => {
  console.error("diagnose failed:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
