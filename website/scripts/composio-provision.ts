/**
 * One-time Composio MCP server provisioning for eri (phone-eri connector layer).
 *
 * Run this ONCE after you've created your Composio auth configs. It creates the
 * single MCP server eri's computers stream tools from, and prints its id — copy
 * that into COMPOSIO_MCP_SERVER_ID in your env (Vercel + the computer).
 *
 *   COMPOSIO_API_KEY=... npx tsx scripts/composio-provision.ts gmail github googlecalendar
 *
 * The args are Composio toolkit slugs (the apps to expose); Composio uses each
 * toolkit's managed auth config. Re-running makes another server — keep the
 * first id.
 */

import { Composio } from "@composio/core";

async function main(): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error("set COMPOSIO_API_KEY in the environment first");
  }

  const toolkits = process.argv.slice(2);
  if (toolkits.length === 0) {
    throw new Error("pass the toolkit slugs to expose, e.g. gmail github googlecalendar");
  }

  const composio = new Composio({ apiKey });
  // Composio requires a server name of at least 4 characters.
  const server = await composio.mcp.create("eri-mcp", { toolkits });

  // eslint-disable-next-line no-console
  console.log(
    "✓ Composio MCP server created. Put its id in COMPOSIO_MCP_SERVER_ID (Vercel + computer):\n",
    JSON.stringify(server, null, 2),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("provisioning failed:", err);
  process.exit(1);
});
