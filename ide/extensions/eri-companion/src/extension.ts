// eri-companion — the strict subset of eri.app that works in
// vanilla VS Code. No fork, no voice, no gaze, no diffusion preview,
// no tandem ship. What's here: ask / plan / ship / memory.
//
// Auth: VS Code's SecretStorage holds the bearer; the user signs in
// once via the device-code flow against tryeri.ca and the bearer
// roams across the host's machines via VS Code's settings sync (when
// the user opts into it).

import * as vscode from "vscode";

const SECRET_KEY = "eri.companion.bearer.v1";

interface AgentEvent {
  kind: string;
  text?: string;
  message?: string;
  routedTo?: string;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand("eri.companion.signIn", () =>
      runSignIn(context),
    ),
    vscode.commands.registerCommand("eri.companion.ask", () =>
      runAgent(context, "ask"),
    ),
    vscode.commands.registerCommand("eri.companion.plan", () =>
      runAgent(context, "plan"),
    ),
    vscode.commands.registerCommand("eri.companion.ship", () =>
      runAgent(context, "ship"),
    ),
    vscode.commands.registerCommand("eri.companion.memory.recall", () =>
      runMemoryRecall(context),
    ),
    vscode.commands.registerCommand("eri.companion.memory.remember", () =>
      runMemoryRemember(context),
    ),
  );
}

export function deactivate(): void {}

function baseUrl(): string {
  return (
    vscode.workspace
      .getConfiguration("eri.companion")
      .get<string>("baseUrl") ?? "https://tryeri.ca"
  ).replace(/\/+$/, "");
}

async function requireBearer(context: vscode.ExtensionContext): Promise<string | null> {
  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return stored;
  const action = await vscode.window.showInformationMessage(
    "eri — not signed in. Sign in now?",
    "Sign in",
    "Use my own key",
  );
  if (action === "Sign in") {
    await runSignIn(context);
    return context.secrets.get(SECRET_KEY).then((v) => v ?? null);
  }
  if (action === "Use my own key") {
    const key = await vscode.window.showInputBox({
      prompt: "Paste your eri_sk_… bearer token",
      password: true,
      ignoreFocusOut: true,
    });
    if (!key) return null;
    await context.secrets.store(SECRET_KEY, key);
    return key;
  }
  return null;
}

async function runSignIn(context: vscode.ExtensionContext): Promise<void> {
  try {
    const start = await fetch(`${baseUrl()}/api/v1/auth/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!start.ok) throw new Error(`device/start ${start.status}`);
    const startBody = (await start.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
    };
    const choice = await vscode.window.showInformationMessage(
      `eri — open ${startBody.verificationUrl} and enter ${startBody.userCode}.`,
      "Open browser",
    );
    if (choice === "Open browser") {
      await vscode.env.openExternal(vscode.Uri.parse(startBody.verificationUrl));
    }
    const bearer = await pollDeviceFlow(startBody.deviceCode);
    if (!bearer) {
      vscode.window.showWarningMessage("eri — sign-in didn't complete.");
      return;
    }
    await context.secrets.store(SECRET_KEY, bearer);
    vscode.window.showInformationMessage("eri — signed in.");
  } catch (err) {
    vscode.window.showErrorMessage(
      `eri — sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function pollDeviceFlow(deviceCode: string): Promise<string | null> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl()}/api/v1/auth/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    if (!response.ok) throw new Error(`device/poll ${response.status}`);
    const body = (await response.json()) as {
      status: string;
      bearer?: string;
    };
    if (body.status === "approved") return body.bearer ?? null;
    if (body.status === "denied") throw new Error("sign-in denied");
    if (body.status === "expired") throw new Error("code expired");
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function runAgent(
  context: vscode.ExtensionContext,
  intent: "ask" | "plan" | "ship",
): Promise<void> {
  const bearer = await requireBearer(context);
  if (!bearer) return;
  const placeholder =
    intent === "ask"
      ? "what should I ask eri?"
      : intent === "plan"
        ? "what should eri plan?"
        : "what should eri ship?";
  const prompt = await vscode.window.showInputBox({
    prompt: `eri /${intent}`,
    placeHolder: placeholder,
    ignoreFocusOut: true,
  });
  if (!prompt) return;
  const channel = vscode.window.createOutputChannel("eri");
  channel.show(true);
  channel.appendLine(`/${intent} ${prompt}`);
  channel.appendLine("");
  try {
    await streamAgent({ bearer, intent, prompt }, (event) => {
      if (event.kind === "token" && event.text) channel.append(event.text);
      if (event.kind === "error" && event.message) {
        channel.appendLine(`\n[error] ${event.message}`);
      }
      if (event.kind === "done") {
        channel.appendLine(
          `\n— done (model: ${event.routedTo ?? "auto"})`,
        );
      }
    });
  } catch (err) {
    channel.appendLine(
      `\n[error] ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface StreamArgs {
  bearer: string;
  intent: "ask" | "plan" | "ship";
  prompt: string;
}

async function streamAgent(
  args: StreamArgs,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/v1/agent/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.bearer}`,
      "content-type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      intent: args.intent,
      prompt: args.prompt,
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineBreak: number;
    while ((lineBreak = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, lineBreak);
      buffer = buffer.slice(lineBreak + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          onEvent(JSON.parse(payload) as AgentEvent);
        } catch {
          // ignore unparseable
        }
      }
    }
  }
}

async function runMemoryRecall(context: vscode.ExtensionContext): Promise<void> {
  const bearer = await requireBearer(context);
  if (!bearer) return;
  const query = await vscode.window.showInputBox({
    prompt: "eri — recall what?",
    ignoreFocusOut: true,
  });
  if (!query) return;
  try {
    const response = await fetch(`${baseUrl()}/api/v1/memory/recall`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, limit: 20 }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      results: { id: string; kind: string; body: string }[];
    };
    const channel = vscode.window.createOutputChannel("eri");
    channel.show(true);
    channel.appendLine(`memory.recall("${query}")`);
    if (!body.results.length) {
      channel.appendLine("(no observations)");
      return;
    }
    for (const obs of body.results) {
      channel.appendLine(`- [${obs.kind}] ${obs.body}  (${obs.id})`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `eri — recall failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function runMemoryRemember(context: vscode.ExtensionContext): Promise<void> {
  const bearer = await requireBearer(context);
  if (!bearer) return;
  const text = await vscode.window.showInputBox({
    prompt: "eri — remember what fact?",
    ignoreFocusOut: true,
  });
  if (!text) return;
  try {
    const response = await fetch(`${baseUrl()}/api/v1/memory/remember`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    vscode.window.showInformationMessage("eri — remembered.");
  } catch (err) {
    vscode.window.showErrorMessage(
      `eri — remember failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
