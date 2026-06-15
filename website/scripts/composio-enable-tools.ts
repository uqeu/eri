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
 *
 * REALTIME/FRUGAL: every enabled tool's JSON schema ships to the model on every
 * turn, so a toolkit's full surface (Gmail has 61) can cost ~60k input tokens and
 * slows the first response. Pass `--only=SLUG,SLUG,...` to enable just the tools
 * that matter — validated against the live catalog so a typo fails loud. A single
 * toolkit is required when using `--only`. Example curated Gmail set:
 *   --only=GMAIL_FETCH_EMAILS,GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID,GMAIL_FETCH_MESSAGE_BY_THREAD_ID,GMAIL_LIST_THREADS,GMAIL_SEND_EMAIL,GMAIL_REPLY_TO_THREAD,GMAIL_CREATE_EMAIL_DRAFT,GMAIL_GET_ATTACHMENT,GMAIL_SEARCH_PEOPLE,GMAIL_GET_PROFILE
 */

import { Composio } from "@composio/core";

async function main(): Promise<void> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const serverId = process.env.COMPOSIO_MCP_SERVER_ID;
  if (!apiKey) throw new Error("set COMPOSIO_API_KEY");
  if (!serverId) throw new Error("set COMPOSIO_MCP_SERVER_ID");

  const rawArgs = process.argv.slice(2);
  const onlyArg = rawArgs.find((a) => a.startsWith("--only="));
  const only = onlyArg
    ? new Set(
        onlyArg
          .slice("--only=".length)
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      )
    : null;
  const toolkits = rawArgs.filter((a) => !a.startsWith("--")).map((t) => t.toLowerCase());
  if (toolkits.length === 0) {
    throw new Error("pass the toolkit slug(s) to enable, e.g. gmail");
  }
  if (only && toolkits.length !== 1) {
    throw new Error("--only=... requires exactly one toolkit");
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
    // `getRawComposioTools` returns a truncated page (~20), so it's only a
    // sufficient source for the "enable everything" path. For `--only` we
    // validate against the union of that page and the server's *current*
    // allowedTools (authoritative, complete) so a typo still fails loud.
    const tools = await composio.tools.getRawComposioTools({ toolkits: [toolkit] });
    const available = tools.map((t) => t.slug).filter((s): s is string => Boolean(s));
    if (available.length === 0) {
      throw new Error(`Composio returned no tools for "${toolkit}"`);
    }
    let allowedTools = available;
    if (only) {
      const server = await composio.mcp.get(serverId);
      const known = new Set(
        [...available, ...(server.allowedTools ?? [])].map((s) => s.toUpperCase()),
      );
      const missing = [...only].filter((s) => !known.has(s));
      if (missing.length > 0) {
        throw new Error(
          `--only listed tool(s) not in the "${toolkit}" catalog: ${missing.join(", ")}`,
        );
      }
      allowedTools = [...only];
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
