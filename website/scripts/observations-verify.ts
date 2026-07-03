/**
 * Live-verify the connections observations normalize against REAL Composio data
 * (bypasses the DB toolkit query; uses the real Gmail/Calendar execute).
 *
 *   cd website && npx tsx scripts/observations-verify.ts [userId]
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
import { CALENDAR_TOOLKIT, GMAIL_TOOLKIT, type ConnectorDeps, type ToolResult } from "@/lib/agent/connectors";
import { fetchObservations } from "@/lib/connections/observations";

async function main(): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY not set (.env.local)");
  const userId = process.argv[2] ?? "usr_118616bec5b74da2a54c48161987357a";
  const composio = new Composio({ apiKey });

  const deps: ConnectorDeps = {
    // Probe both; an unconnected toolkit just yields nothing (caught → []).
    activeToolkits: async () => new Set([GMAIL_TOOLKIT, CALENDAR_TOOLKIT]),
    executeTool: async (uid, slug, args) => {
      const r = (await composio.tools.execute(slug, {
        userId: uid,
        arguments: args,
        version: "latest",
        dangerouslySkipVersionCheck: true,
      })) as { data?: unknown; error?: unknown; successful?: boolean };
      return {
        data: (r?.data ?? {}) as Record<string, unknown>,
        error: (r?.error as string | null) ?? null,
        successful: r?.successful === true,
      } satisfies ToolResult;
    },
  };

  const since = Number(process.argv[3] ?? "0"); // default since=0 (the brain's backfill call)
  const limit = Number(process.argv[4] ?? "60"); // default 60 → exercises internal paging (>40 cap)

  /* eslint-disable no-console */
  const p1 = await fetchObservations(userId, deps, { since, limit });
  console.log(`page1 (since=${since}, limit=${limit}): ${p1.observations.length} obs, nextCursor=${p1.nextCursor}`);
  if (p1.nextCursor) {
    const p2 = await fetchObservations(userId, deps, { since, before: p1.nextCursor, limit });
    const ids1 = new Set(p1.observations.map((o) => o.sourceId));
    const overlap = p2.observations.filter((o) => ids1.has(o.sourceId)).length;
    const oldest = (xs: { ts: number }[]) => (xs.length ? Math.min(...xs.map((x) => x.ts)) : 0);
    console.log(`page2 (before=${p1.nextCursor}): ${p2.observations.length} obs, overlap-with-page1=${overlap}`);
    console.log(`  page1 oldest ts=${oldest(p1.observations)} · page2 oldest ts=${oldest(p2.observations)} (page2 older ⇒ ${oldest(p2.observations) < oldest(p1.observations)})`);
  }
  console.log("sample:", p1.observations.slice(0, 2).map((o) => o.sourceId).join(", "));
  /* eslint-enable no-console */
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("verify failed:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
