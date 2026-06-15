/**
 * Raw MCP handshake against the per-user Composio URL — the ground truth for
 * "why 0 tools". Does initialize → (capture Mcp-Session-Id) → initialized →
 * tools/list, exactly like an MCP client, and prints what comes back WITH the
 * session id. If this returns the tools, eri's transport just needs session
 * handling.
 *
 *   COMPOSIO_API_KEY=... COMPOSIO_MCP_SERVER_ID=... \
 *     npx tsx scripts/composio-mcp-probe.ts <your-eri-user-id>
 */

const apiKey = process.env.COMPOSIO_API_KEY;
const serverId = process.env.COMPOSIO_MCP_SERVER_ID;
const userId = process.argv[2];
if (!apiKey || !serverId) throw new Error("set COMPOSIO_API_KEY + COMPOSIO_MCP_SERVER_ID");
if (!userId) throw new Error("pass your eri user id (usr_...)");

const url = `https://backend.composio.dev/v3/mcp/${serverId}/mcp?user_id=${encodeURIComponent(userId)}`;

function parseBody(ct: string, text: string): unknown {
  if (ct.includes("text/event-stream")) {
    const datas = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    return datas.length ? JSON.parse(datas[datas.length - 1]) : null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rpc(
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; sid: string | null; json: unknown }> {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return {
    status: res.status,
    sid: res.headers.get("mcp-session-id"),
    json: parseBody(res.headers.get("content-type") ?? "", text),
  };
}

async function main(): Promise<void> {
  const base: Record<string, string> = {
    "x-api-key": apiKey as string,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  const init = await rpc(base, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
  });
  // eslint-disable-next-line no-console
  console.log("initialize → status", init.status, "session", init.sid);

  const withSession = init.sid ? { ...base, "mcp-session-id": init.sid } : base;

  // The MCP spec requires this notification before normal requests.
  await fetch(url, {
    method: "POST",
    headers: withSession,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const list = await rpc(withSession, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = (list.json as { result?: { tools?: { name: string }[] } })?.result?.tools ?? [];
  // eslint-disable-next-line no-console
  console.log("tools/list → status", list.status, "TOOL COUNT:", tools.length);
  // eslint-disable-next-line no-console
  console.log("first few:", tools.slice(0, 5).map((t) => t.name));
  if (tools.length === 0) {
    // eslint-disable-next-line no-console
    console.log("raw tools/list response:", JSON.stringify(list.json, null, 2).slice(0, 1500));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("probe failed:", err);
  process.exit(1);
});
