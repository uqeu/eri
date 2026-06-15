/**
 * Enable a toolkit's tools on the existing eri MCP server (phone-eri connector).
 *
 * The server was created without `allowedTools`, so Composio exposed *no* tools
 * to eri. This updates it in place (same server id — no env change) to allow the
 * toolkit's tools. Run once per toolkit you've connected:
 *
 *   COMPOSIO_API_KEY=... COMPOSIO_MCP_SERVER_ID=... npx tsx scripts/composio-enable-tools.ts gmail
 *
 * Tool slugs are fetched live from Composio for the toolkit, so we don't hardcode
 * a (drift-prone) list — whatever Gmail tools Composio offers get enabled.
 */

import { Composio } from "@composio/core";

async function main(): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const serverId = process.env.COMPOSIO_MCP_SERVER_ID;
  if (!apiKey) throw new Error("set COMPOSIO_API_KEY");
  if (!serverId) throw new Error("set COMPOSIO_MCP_SERVER_ID");

  const toolkits = process.argv.slice(2).map((t) => t.toLowerCase());
  if (toolkits.length === 0) {
    throw new Error("pass the toolkit slug(s) to enable, e.g. gmail");
  }

  const composio = new Composio({ apiKey });

  // For each toolkit, the server must (a) reference the toolkit's AUTH CONFIG —
  // otherwise it can't resolve the user's connected account and returns 0 tools —
  // and (b) list the toolkit's tools under it (a top-level allowedTools is
  // ignored). We fetch both from Composio so nothing is hardcoded.
  let total = 0;
  const toolkitConfigs = [];
  for (const toolkit of toolkits) {
    const authConfigs = await composio.authConfigs.list({ toolkit });
    const authConfigId = authConfigs.items?.[0]?.id;
    if (!authConfigId) {
      throw new Error(`no auth config found for "${toolkit}" — create one in the Composio dashboard`);
    }
    const tools = await composio.tools.getRawComposioTools({ toolkits: [toolkit] });
    const allowedTools = tools.map((t) => t.slug).filter((s): s is string => Boolean(s));
    if (allowedTools.length === 0) {
      throw new Error(`Composio returned no tools for "${toolkit}"`);
    }
    total += allowedTools.length;
    toolkitConfigs.push({ toolkit, authConfigId, allowedTools });
  }

  const updated = await composio.mcp.update(serverId, { toolkits: toolkitConfigs });

  // eslint-disable-next-line no-console
  console.log(
    `✓ Linked auth config + enabled ${total} tool(s) on the eri MCP server (${toolkits.join(", ")}):\n`,
    JSON.stringify(updated, null, 2),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("enable-tools failed:", err);
  process.exit(1);
});
