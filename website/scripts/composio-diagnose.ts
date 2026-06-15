/**
 * Diagnose why the eri MCP server returns 0 tools (one-off).
 *
 *   COMPOSIO_API_KEY=... COMPOSIO_MCP_SERVER_ID=... \
 *     npx tsx scripts/composio-diagnose.ts <your-eri-user-id>
 *
 * The user id is the `usr_...` shown in eri's `[eri-mcp] composio …` debug line.
 * Prints: the server's REAL stored config (to see if our update persisted), and
 * generates the per-user instance (serverInstanceCount was 0, which the docs say
 * must be non-zero before the per-user URL serves tools).
 */

import { Composio } from "@composio/core";

async function main(): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const serverId = process.env.COMPOSIO_MCP_SERVER_ID;
  const userId = process.argv[2];
  if (!apiKey || !serverId) throw new Error("set COMPOSIO_API_KEY + COMPOSIO_MCP_SERVER_ID");
  if (!userId) throw new Error("pass your eri user id (the usr_... from the [eri-mcp] line)");

  const composio = new Composio({ apiKey });

  const server = await composio.mcp.get(serverId);
  // eslint-disable-next-line no-console
  console.log(
    "SERVER (real stored config):",
    JSON.stringify(
      { toolkits: server.toolkits, allowedTools: server.allowedTools, authConfigIds: server.authConfigIds },
      null,
      2,
    ),
  );

  const instance = await composio.mcp.generate(userId, serverId);
  // eslint-disable-next-line no-console
  console.log("\nGENERATED per-user instance:", JSON.stringify(instance, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("diagnose failed:", err);
  process.exit(1);
});
