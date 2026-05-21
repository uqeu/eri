import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { McpServerStatus, McpTreeDataProvider } from "./mcpView";

export interface McpServerDef {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly transport: "stdio" | "sse" | "http";
}

export interface McpConfig {
  readonly mcpServers: ReadonlyArray<McpServerDef>;
}

interface RawServerEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  transport?: unknown;
}

interface RawConfigRoot {
  mcpServers?: unknown;
}

const DEFAULT_CONFIG_DIR = ".eri";
const DEFAULT_CONFIG_FILE = "mcp.json";
const RELOAD_DEBOUNCE_MS = 150;

export interface McpRegistryHandle {
  readonly view: McpTreeDataProvider;
  dispose(): void;
}

export function activateMcp(
  context: vscode.ExtensionContext,
  sidecarGetter: () => Sidecar | null,
): McpRegistryHandle {
  const configPath = resolveConfigPath();
  const view = new McpTreeDataProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("eri.mcp", view),
  );

  let pendingReload: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;
  let lastConfig: McpConfig = { mcpServers: [] };

  const scheduleReload = (): void => {
    if (pendingReload) {
      clearTimeout(pendingReload);
    }
    pendingReload = setTimeout(() => {
      pendingReload = null;
      loadAndPush();
    }, RELOAD_DEBOUNCE_MS);
  };

  const loadAndPush = (): void => {
    const next = readConfig(configPath);
    if (next === null) {
      lastConfig = { mcpServers: [] };
      view.setServers([]);
      sidecarGetter()?.notify("eri/mcp/setConfig", { mcpServers: {} });
      return;
    }
    lastConfig = next;
    const initialStatuses = next.mcpServers.map<McpServerStatus>((server) => ({
      name: server.name,
      command: server.command,
      state: "offline",
      toolCount: 0,
      transport: server.transport,
    }));
    view.setServers(initialStatuses);
    sidecarGetter()?.notify("eri/mcp/setConfig", toWireConfig(next));
  };

  const installWatcher = (): void => {
    const watchDir = path.dirname(configPath);
    try {
      if (!fs.existsSync(watchDir)) {
        return;
      }
      watcher = fs.watch(watchDir, { persistent: false }, (_event, filename) => {
        if (!filename) {
          scheduleReload();
          return;
        }
        if (path.basename(configPath) === filename.toString()) {
          scheduleReload();
        }
      });
      watcher.on("error", (err) => {
        console.warn("[eri-mcp] watcher error", err);
      });
    } catch (err) {
      console.warn("[eri-mcp] failed to install watcher", err);
    }
  };

  const restartCommand = vscode.commands.registerCommand(
    "eri.mcp.restart",
    (item?: { server?: McpServerStatus }) => {
      const target = item?.server;
      if (!target) {
        sidecarGetter()?.notify("eri/mcp/restartAll", {});
        return;
      }
      sidecarGetter()?.notify("eri/mcp/restart", { name: target.name });
    },
  );

  const openConfigCommand = vscode.commands.registerCommand(
    "eri.mcp.openConfig",
    async () => {
      await ensureConfigFile(configPath);
      const doc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(doc);
    },
  );

  const viewToolsCommand = vscode.commands.registerCommand(
    "eri.mcp.viewTools",
    async (item?: { server?: McpServerStatus }) => {
      const target = item?.server;
      if (!target) {
        vscode.window.showInformationMessage("eri MCP: select a server first");
        return;
      }
      try {
        const sidecar = sidecarGetter();
        if (!sidecar) {
          vscode.window.showWarningMessage("eri MCP: sidecar not running");
          return;
        }
        const result = await sidecar.request<{ tools?: ReadonlyArray<{ name: string }> }>(
          "eri/mcp/listTools",
          { name: target.name },
        );
        const names = (result?.tools ?? []).map((tool) => tool.name);
        if (names.length === 0) {
          vscode.window.showInformationMessage(
            `eri MCP: ${target.name} exposes no tools`,
          );
          return;
        }
        await vscode.window.showQuickPick(names, {
          title: `Tools — ${target.name}`,
          placeHolder: "Read-only view of registered MCP tools",
        });
      } catch (err) {
        vscode.window.showErrorMessage(
          `eri MCP: failed to list tools for ${target.name} — ${describeError(err)}`,
        );
      }
    },
  );

  context.subscriptions.push(restartCommand, openConfigCommand, viewToolsCommand);

  installWatcher();
  loadAndPush();

  const disposable: vscode.Disposable = {
    dispose: () => {
      if (pendingReload) {
        clearTimeout(pendingReload);
        pendingReload = null;
      }
      watcher?.close();
      watcher = null;
    },
  };
  context.subscriptions.push(disposable);

  void lastConfig;

  return {
    view,
    dispose: () => disposable.dispose(),
  };
}

export function applyServerStatus(
  view: McpTreeDataProvider,
  update: Partial<McpServerStatus> & { name: string },
): void {
  view.updateServer(update);
}

function resolveConfigPath(): string {
  const override = vscode.workspace
    .getConfiguration("eri")
    .get<string>("mcp.configPath");
  if (override && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(override);
  }
  return path.join(os.homedir(), DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE);
}

function readConfig(configPath: string): McpConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    console.warn("[eri-mcp] failed to read config", err);
    return null;
  }
  let parsed: RawConfigRoot;
  try {
    parsed = JSON.parse(raw) as RawConfigRoot;
  } catch (err) {
    void vscode.window
      .showWarningMessage(
        `eri MCP: ${path.basename(configPath)} is malformed — ${describeError(err)}`,
        "Open file",
      )
      .then((choice) => {
        if (choice === "Open file") {
          void vscode.commands.executeCommand("eri.mcp.openConfig");
        }
      });
    return null;
  }
  const servers = normalizeServers(parsed.mcpServers);
  return { mcpServers: servers };
}

function normalizeServers(input: unknown): ReadonlyArray<McpServerDef> {
  if (!input || typeof input !== "object") {
    return [];
  }
  const result: McpServerDef[] = [];
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = value as RawServerEntry;
    const command = typeof entry.command === "string" ? entry.command : null;
    if (!command || command.length === 0) {
      continue;
    }
    result.push({
      name,
      command,
      args: normalizeStringArray(entry.args),
      env: normalizeStringMap(entry.env),
      transport: normalizeTransport(entry.transport),
    });
  }
  return result;
}

function normalizeStringArray(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
    }
  }
  return out;
}

function normalizeStringMap(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      out[key] = raw;
    }
  }
  return out;
}

function normalizeTransport(value: unknown): "stdio" | "sse" | "http" {
  if (value === "sse" || value === "http") {
    return value;
  }
  return "stdio";
}

function toWireConfig(config: McpConfig): {
  mcpServers: Record<string, Omit<McpServerDef, "name">>;
} {
  const wire: Record<string, Omit<McpServerDef, "name">> = {};
  for (const server of config.mcpServers) {
    wire[server.name] = {
      command: server.command,
      args: server.args,
      env: server.env,
      transport: server.transport,
    };
  }
  return { mcpServers: wire };
}

async function ensureConfigFile(configPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  } catch (err) {
    console.warn("[eri-mcp] mkdir failed", err);
  }
  try {
    await fs.promises.access(configPath, fs.constants.F_OK);
  } catch {
    const seed = `${JSON.stringify(
      {
        mcpServers: {
          example: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-everything"],
            env: {},
            transport: "stdio",
          },
        },
      },
      null,
      2,
    )}\n`;
    try {
      await fs.promises.writeFile(configPath, seed, { flag: "wx" });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        console.warn("[eri-mcp] failed to seed config", err);
      }
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
