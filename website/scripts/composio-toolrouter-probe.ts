/**
 * Probe Composio's Tool Router session — ground-truth for Phase 1.
 *
 * Creates a tool-router session for a user, connects to the returned MCP url,
 * and lists tools. If this returns ~6 META-tools (COMPOSIO_SEARCH_TOOLS, etc.)
 * instead of 61 flat Gmail tools, the migration is viable: we point eri at the
 * session url and the model lazily searches for the few tools a task needs.
 *
 *   COMPOSIO_API_KEY=... npx tsx scripts/composio-toolrouter-probe.ts <user_id> [toolkit...]
 *
 * Optionally pass toolkits to scope the session (default: let Composio decide
 * from the user's connected accounts).
 */

const apiKey = process.env.COMPOSIO_API_KEY;
const userId = process.argv[2];
const toolkits = process.argv.slice(3).map((t) => t.toLowerCase());
if (!apiKey) throw new Error("set COMPOSIO_API_KEY");
if (!userId) throw new Error("pass a user id (usr_...)");

const SESSION_ENDPOINT = "https://backend.composio.dev/api/v3.1/tool_router/session";

interface SessionResponse {
  session_id?: string;
  mcp?: { type?: string; url?: string };
  [k: string]: unknown;
}

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

async function createSession(): Promise<SessionResponse> {
  const body: Record<string, unknown> = { user_id: userId };
  if (toolkits.length) body.toolkits = toolkits;
  const res = await fetch(SESSION_ENDPOINT, {
    method: "POST",
    headers: { "x-api-key": apiKey as string, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // eslint-disable-next-line no-console
  console.log(`session POST -> ${res.status}`);
  if (!res.ok) throw new Error(`session create failed: ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text) as SessionResponse;
}

async function listTools(url: string): Promise<string[]> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey as string,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const init = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
    }),
  });
  // eslint-disable-next-line no-console
  console.log(`initialize -> ${init.status}`);
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const listRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const json = parseBody(listRes.headers.get("content-type") ?? "", await listRes.text()) as {
    result?: { tools?: { name: string }[] };
  };
  return (json?.result?.tools ?? []).map((t) => t.name);
}

async function main(): Promise<void> {
  const session = await createSession();
  const url = session.mcp?.url;
  // eslint-disable-next-line no-console
  console.log("session_id:", session.session_id, "\nmcp.url:", url);
  if (!url) throw new Error(`no mcp.url in session response: ${JSON.stringify(session).slice(0, 400)}`);
  const tools = await listTools(url);
  // eslint-disable-next-line no-console
  console.log(`\nTOOL COUNT: ${tools.length}`);
  // eslint-disable-next-line no-console
  console.log(tools.join("\n"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("toolrouter probe failed:", err);
  process.exit(1);
});
