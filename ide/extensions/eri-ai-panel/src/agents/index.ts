// Activation entry point for the multi-agent picker.
//
// Wires together:
//   - AgentRegistry          (built-ins + user file)
//   - Agent backends         (Mercury / proxy / BYOK / CLI / auto)
//   - Status bar item        (active agent indicator)
//   - Tree view              (eri.agents sidebar)
//   - Commands               (switch / detectCli / addCustom / showCurrent / setActive)
//   - Picker UI bridge       (panel webview can request the picker)
//   - Config sync            (eri.agents.default)

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SecretsStore } from "../settings/secrets";
import { SessionStore } from "../account/sessionStore";
import { Sidecar } from "../sidecar";
import { AgentRegistry } from "./registry";
import { AgentBackend, AgentDescriptor, AgentTurn } from "./types";
import { MercuryAgent } from "./mercuryAgent";
import { ProxyAgent } from "./proxyAgent";
import { ByokAgent } from "./byokAgent";
import { CliAgent } from "./cliAgent";
import { AutoAgent } from "./autoAgent";
import { showAgentPicker } from "./picker";
import { activateAgentStatusBar, AgentStatusBarHandle } from "./statusBar";
import { AgentsTreeProvider } from "./view";

const DEFAULT_ENV_BLOCKLIST: ReadonlyArray<string> = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
];

export interface AgentsHandle extends vscode.Disposable {
  readonly registry: AgentRegistry;
  /** Run a chat turn through the currently active agent. */
  dispatch(turn: AgentTurn, signal?: AbortSignal): AsyncIterable<unknown>;
}

export interface ActivateAgentsOptions {
  readonly secrets: SecretsStore;
  readonly session: SessionStore;
  readonly getSidecar: () => Sidecar | null;
  /** Callback so the chat composer can be notified of agent changes. */
  readonly onActiveChanged?: (descriptor: AgentDescriptor) => void;
}

export function activateAgents(
  context: vscode.ExtensionContext,
  opts: ActivateAgentsOptions,
): AgentsHandle {
  const registry = new AgentRegistry({
    session: opts.session,
    secrets: opts.secrets,
    globalState: context.globalState,
    getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });

  const envBlocklist = readEnvBlocklist();
  const mercury: AgentBackend = new MercuryAgent({ getSidecar: opts.getSidecar });
  const proxy: AgentBackend = new ProxyAgent({ getSidecar: opts.getSidecar });
  const byok: AgentBackend = new ByokAgent({ getSidecar: opts.getSidecar });
  const cli: AgentBackend = new CliAgent({ envBlocklist });
  const auto: AgentBackend = new AutoAgent({
    getSidecar: opts.getSidecar,
    resolve: (id) => registry.get(id),
    mercury,
    proxy,
  });

  const pick = (descriptor: AgentDescriptor): AgentBackend => {
    switch (descriptor.kind) {
      case "auto":
        return auto;
      case "mercury":
        return mercury;
      case "byok":
        return byok;
      case "cli":
        return cli;
      case "proxy":
      default:
        return proxy;
    }
  };

  const treeProvider = new AgentsTreeProvider(registry);
  const treeView = vscode.window.createTreeView("eri.agents", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  let statusBar: AgentStatusBarHandle | null = activateAgentStatusBar(context, registry);

  // Notify chat composer / external listeners.
  const changeListener = registry.onChange((descriptor) => {
    opts.onActiveChanged?.(descriptor);
  });
  context.subscriptions.push(changeListener);

  // Refresh on session sign-in/out and on config change.
  const sessionListener = opts.session.onChange(() => {
    void registry.refreshAvailability();
  });
  context.subscriptions.push(sessionListener);

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("eri.agents")) {
      void registry.refreshAvailability();
    }
  });
  context.subscriptions.push(configListener);

  // Initial async detection. Best-effort; doesn't block activation.
  void registry.refreshAvailability();

  // Auto-detect on launch if configured.
  if (vscode.workspace.getConfiguration("eri.agents.detectCli").get<boolean>("onLaunch", true)) {
    // Already triggered by refreshAvailability above — but re-running is harmless.
  }

  // Commands ---------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("eri.agents.switch", () => showAgentPicker(registry)),
    vscode.commands.registerCommand("eri.agents.detectCli", async () => {
      await registry.refreshAvailability();
      const cliCount = registry.list().filter((d) => d.kind === "cli" && d.available).length;
      vscode.window.showInformationMessage(`eri: detected ${cliCount} local CLI agent(s).`);
    }),
    vscode.commands.registerCommand("eri.agents.addCustom", () => openCustomAgentsFile()),
    vscode.commands.registerCommand("eri.agents.showCurrent", () => {
      const active = registry.active();
      vscode.window.showInformationMessage(
        `eri agent: ${active.label} (${active.kind}, ${active.vendor})`,
      );
    }),
    vscode.commands.registerCommand("eri.agents.setActive", async (id?: unknown) => {
      if (typeof id === "string") {
        await registry.setActive(id);
      }
    }),
  );

  return {
    registry,
    dispatch(turn: AgentTurn, signal?: AbortSignal): AsyncIterable<unknown> {
      const descriptor = registry.active();
      const backend = pick(descriptor);
      const controller = signal ?? new AbortController().signal;
      return backend.run(descriptor, turn, controller);
    },
    dispose: (): void => {
      statusBar?.dispose();
      statusBar = null;
      treeView.dispose();
      registry.dispose();
    },
  };
}

function readEnvBlocklist(): ReadonlyArray<string> {
  const configured = vscode.workspace
    .getConfiguration("eri.agents")
    .get<string[]>("cliEnvBlocklist", [...DEFAULT_ENV_BLOCKLIST]);
  if (!Array.isArray(configured)) {
    return DEFAULT_ENV_BLOCKLIST;
  }
  return configured.filter((entry): entry is string => typeof entry === "string");
}

async function openCustomAgentsFile(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const target = folder
    ? vscode.Uri.joinPath(folder.uri, ".eri", "agents.json")
    : vscode.Uri.file(path.join(process.env.HOME ?? "", ".eri", "agents.json"));
  const dir = path.dirname(target.fsPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — open will surface the real error.
  }
  if (!fs.existsSync(target.fsPath)) {
    const stub = JSON.stringify(
      {
        agents: [
          {
            id: "my-agent",
            label: "My Agent",
            kind: "cli",
            binary: "/usr/local/bin/my-agent",
            binaryArgs: ["--workspace", "${workspaceRoot}"],
          },
        ],
      },
      null,
      2,
    );
    fs.writeFileSync(target.fsPath, stub, "utf8");
  }
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc);
}

export type { AgentDescriptor, AgentTurn } from "./types";
