"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateMcp = activateMcp;
exports.applyServerStatus = applyServerStatus;
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const mcpView_1 = require("./mcpView");
const DEFAULT_CONFIG_DIR = ".eri";
const DEFAULT_CONFIG_FILE = "mcp.json";
const RELOAD_DEBOUNCE_MS = 150;
function activateMcp(context, sidecarGetter) {
    const configPath = resolveConfigPath();
    const view = new mcpView_1.McpTreeDataProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider("eri.mcp", view));
    let pendingReload = null;
    let watcher = null;
    let lastConfig = { mcpServers: [] };
    const scheduleReload = () => {
        if (pendingReload) {
            clearTimeout(pendingReload);
        }
        pendingReload = setTimeout(() => {
            pendingReload = null;
            loadAndPush();
        }, RELOAD_DEBOUNCE_MS);
    };
    const loadAndPush = () => {
        const next = readConfig(configPath);
        if (next === null) {
            lastConfig = { mcpServers: [] };
            view.setServers([]);
            sidecarGetter()?.notify("eri/mcp/setConfig", { mcpServers: {} });
            return;
        }
        lastConfig = next;
        const initialStatuses = next.mcpServers.map((server) => ({
            name: server.name,
            command: server.command,
            state: "offline",
            toolCount: 0,
            transport: server.transport,
        }));
        view.setServers(initialStatuses);
        sidecarGetter()?.notify("eri/mcp/setConfig", toWireConfig(next));
    };
    const installWatcher = () => {
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
        }
        catch (err) {
            console.warn("[eri-mcp] failed to install watcher", err);
        }
    };
    const restartCommand = vscode.commands.registerCommand("eri.mcp.restart", (item) => {
        const target = item?.server;
        if (!target) {
            sidecarGetter()?.notify("eri/mcp/restartAll", {});
            return;
        }
        sidecarGetter()?.notify("eri/mcp/restart", { name: target.name });
    });
    const openConfigCommand = vscode.commands.registerCommand("eri.mcp.openConfig", async () => {
        await ensureConfigFile(configPath);
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);
    });
    const viewToolsCommand = vscode.commands.registerCommand("eri.mcp.viewTools", async (item) => {
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
            const result = await sidecar.request("eri/mcp/listTools", { name: target.name });
            const names = (result?.tools ?? []).map((tool) => tool.name);
            if (names.length === 0) {
                vscode.window.showInformationMessage(`eri MCP: ${target.name} exposes no tools`);
                return;
            }
            await vscode.window.showQuickPick(names, {
                title: `Tools — ${target.name}`,
                placeHolder: "Read-only view of registered MCP tools",
            });
        }
        catch (err) {
            vscode.window.showErrorMessage(`eri MCP: failed to list tools for ${target.name} — ${describeError(err)}`);
        }
    });
    // Phase 17c — MCP hub picker for one-click install of curated servers.
    // Lives in mcpHub.ts; we register the command + addServer hook here
    // since they share configPath + sidecarGetter context.
    const openHubCommand = vscode.commands.registerCommand("eri.mcp.openHub", async () => {
        const { openMcpHub } = await Promise.resolve().then(() => require("./mcpHub"));
        await openMcpHub();
    });
    const addServerCommand = vscode.commands.registerCommand("eri.mcp.addServer", async (preset) => {
        if (!preset || typeof preset.id !== "string")
            return;
        await ensureConfigFile(configPath);
        try {
            const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(configPath));
            const text = Buffer.from(raw).toString("utf8");
            const json = JSON.parse(text);
            const servers = json.mcpServers ?? {};
            servers[preset.id] = {
                command: preset.command,
                args: preset.args,
            };
            json.mcpServers = servers;
            const out = JSON.stringify(json, null, 2) + "\n";
            await vscode.workspace.fs.writeFile(vscode.Uri.file(configPath), Buffer.from(out, "utf8"));
            sidecarGetter()?.notify("eri/mcp/restartAll", {});
        }
        catch (err) {
            throw err instanceof Error
                ? err
                : new Error("failed to persist MCP server config");
        }
    });
    context.subscriptions.push(restartCommand, openConfigCommand, viewToolsCommand, openHubCommand, addServerCommand);
    installWatcher();
    loadAndPush();
    const disposable = {
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
function applyServerStatus(view, update) {
    view.updateServer(update);
}
function resolveConfigPath() {
    const override = vscode.workspace
        .getConfiguration("eri")
        .get("mcp.configPath");
    if (override && override.trim().length > 0) {
        return path.isAbsolute(override) ? override : path.resolve(override);
    }
    return path.join(os.homedir(), DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE);
}
function readConfig(configPath) {
    let raw;
    try {
        raw = fs.readFileSync(configPath, "utf8");
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT") {
            return null;
        }
        console.warn("[eri-mcp] failed to read config", err);
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        void vscode.window
            .showWarningMessage(`eri MCP: ${path.basename(configPath)} is malformed — ${describeError(err)}`, "Open file")
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
function normalizeServers(input) {
    if (!input || typeof input !== "object") {
        return [];
    }
    const result = [];
    for (const [name, value] of Object.entries(input)) {
        if (!value || typeof value !== "object") {
            continue;
        }
        const entry = value;
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
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const out = [];
    for (const item of value) {
        if (typeof item === "string") {
            out.push(item);
        }
    }
    return out;
}
function normalizeStringMap(value) {
    if (!value || typeof value !== "object") {
        return {};
    }
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === "string") {
            out[key] = raw;
        }
    }
    return out;
}
function normalizeTransport(value) {
    if (value === "sse" || value === "http") {
        return value;
    }
    return "stdio";
}
function toWireConfig(config) {
    const wire = {};
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
async function ensureConfigFile(configPath) {
    try {
        await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    }
    catch (err) {
        console.warn("[eri-mcp] mkdir failed", err);
    }
    try {
        await fs.promises.access(configPath, fs.constants.F_OK);
    }
    catch {
        const seed = `${JSON.stringify({
            mcpServers: {
                example: {
                    command: "npx",
                    args: ["-y", "@modelcontextprotocol/server-everything"],
                    env: {},
                    transport: "stdio",
                },
            },
        }, null, 2)}\n`;
        try {
            await fs.promises.writeFile(configPath, seed, { flag: "wx" });
        }
        catch (err) {
            const code = err.code;
            if (code !== "EEXIST") {
                console.warn("[eri-mcp] failed to seed config", err);
            }
        }
    }
}
function describeError(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
//# sourceMappingURL=mcpRegistry.js.map