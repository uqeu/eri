"use strict";
// MCP marketplace hub (Phase 17c) — a curated list of the top
// community MCP servers with one-click install.
//
// Implementation note: the actual install path is the existing
// `eri.mcp.addServer` command surface (see mcpRegistry.ts). The hub
// just renders the catalog + dispatches to that command with the
// preset's command + args.
//
// The catalog ships inline so the hub stays useful offline; a future
// revision will fetch additions from https://tryeri.ca/api/v1/mcp/catalog
// for community submissions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_PRESETS = void 0;
exports.openMcpHub = openMcpHub;
const vscode = require("vscode");
exports.MCP_PRESETS = [
    {
        id: "filesystem",
        displayName: "Filesystem",
        description: "Read & write files within a sandboxed root directory.",
        category: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceRoot}"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    },
    {
        id: "fetch",
        displayName: "Fetch",
        description: "Make HTTP requests from your agent.",
        category: "fetch",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-fetch"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    },
    {
        id: "github",
        displayName: "GitHub",
        description: "List issues, read PRs, comment, search code across repos.",
        category: "git",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    },
    {
        id: "git",
        displayName: "Git",
        description: "Inspect history, blame, branches, and diffs of a local repo.",
        category: "git",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-git", "${workspaceRoot}"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    },
    {
        id: "postgres",
        displayName: "Postgres",
        description: "Run read-only SQL queries against a Postgres database.",
        category: "database",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    },
    {
        id: "sqlite",
        displayName: "SQLite",
        description: "Read + write a local SQLite database from the agent.",
        category: "database",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sqlite", "${workspaceRoot}/data.db"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    },
    {
        id: "brave-search",
        displayName: "Brave Search",
        description: "Search the web via the Brave Search API. Requires API key.",
        category: "search",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-brave-search"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    },
    {
        id: "tavily",
        displayName: "Tavily",
        description: "Tavily-powered web search optimized for LLM context.",
        category: "search",
        command: "npx",
        args: ["-y", "tavily-mcp"],
        homepage: "https://github.com/tavily-ai/tavily-mcp",
    },
    {
        id: "playwright",
        displayName: "Playwright",
        description: "Drive a headless browser — click, type, screenshot.",
        category: "browser",
        command: "npx",
        args: ["-y", "@playwright/mcp"],
        homepage: "https://github.com/microsoft/playwright-mcp",
    },
    {
        id: "puppeteer",
        displayName: "Puppeteer",
        description: "Chromium automation via Puppeteer.",
        category: "browser",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-puppeteer"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    },
    {
        id: "memory",
        displayName: "Memory",
        description: "Reference MCP memory server — persistent knowledge graph for the agent.",
        category: "memory",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    },
    {
        id: "everart",
        displayName: "EverArt",
        description: "Generate images from prompts via EverArt.",
        category: "other",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everart"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/everart",
    },
    {
        id: "slack",
        displayName: "Slack",
        description: "Post to channels, search messages, manage threads.",
        category: "other",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-slack"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    },
    {
        id: "google-drive",
        displayName: "Google Drive",
        description: "Search + read files in a connected Google Drive.",
        category: "other",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-gdrive"],
        homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive",
    },
    {
        id: "stripe",
        displayName: "Stripe",
        description: "Run Stripe API calls — customers, payments, refunds.",
        category: "other",
        command: "npx",
        args: ["-y", "@stripe/mcp"],
        homepage: "https://github.com/stripe/mcp",
    },
    {
        id: "supabase",
        displayName: "Supabase",
        description: "Manage Supabase projects, tables, migrations from the agent.",
        category: "database",
        command: "npx",
        args: ["-y", "@supabase/mcp-server-supabase"],
        homepage: "https://github.com/supabase-community/mcp-server-supabase",
    },
    {
        id: "linear",
        displayName: "Linear",
        description: "Create, list, comment on Linear issues from the agent.",
        category: "other",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-linear"],
        homepage: "https://github.com/jerhadf/linear-mcp-server",
    },
    {
        id: "notion",
        displayName: "Notion",
        description: "Read + edit Notion pages.",
        category: "other",
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        homepage: "https://github.com/makenotion/notion-mcp-server",
    },
    {
        id: "exa",
        displayName: "Exa Search",
        description: "Exa-powered semantic web search.",
        category: "search",
        command: "npx",
        args: ["-y", "exa-mcp-server"],
        homepage: "https://github.com/exa-labs/exa-mcp-server",
    },
    {
        id: "shadcn-ui",
        displayName: "shadcn/ui",
        description: "Browse, install, and configure shadcn/ui components.",
        category: "other",
        command: "npx",
        args: ["-y", "@shadcn-ui/mcp"],
        homepage: "https://github.com/shadcn-ui/ui",
    },
];
/**
 * Quick-pick driven install flow. Renders the catalog grouped by
 * category, hands the selected preset to the existing
 * `eri.mcp.addServer` command which knows how to spawn + persist.
 */
async function openMcpHub() {
    const items = [];
    const byCategory = new Map();
    for (const p of exports.MCP_PRESETS) {
        const list = byCategory.get(p.category) ?? [];
        list.push(p);
        byCategory.set(p.category, list);
    }
    for (const [category, presets] of byCategory) {
        items.push({
            label: prettyCategory(category),
            kind: vscode.QuickPickItemKind.Separator,
        });
        for (const p of presets) {
            items.push({
                label: p.displayName,
                description: p.description,
                detail: p.command + " " + p.args.join(" "),
            });
        }
    }
    const picked = await vscode.window.showQuickPick(items, {
        title: "MCP hub — pick a server to install",
        placeHolder: "Filter by name…",
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked || !picked.label)
        return;
    const preset = exports.MCP_PRESETS.find((p) => p.displayName === picked.label);
    if (!preset)
        return;
    await installPreset(preset);
}
async function installPreset(preset) {
    // Dispatch through the existing MCP registry's add-server command.
    // We pass a structured payload it knows how to consume; if the
    // command isn't registered we fall back to copying the JSON to the
    // clipboard so the user can paste it into their settings.
    try {
        await vscode.commands.executeCommand("eri.mcp.addServer", {
            id: preset.id,
            command: preset.command,
            args: [...preset.args],
            displayName: preset.displayName,
        });
        vscode.window.showInformationMessage(`Installed MCP server: ${preset.displayName}`);
    }
    catch (err) {
        const payload = JSON.stringify({
            mcpServers: {
                [preset.id]: { command: preset.command, args: preset.args },
            },
        }, null, 2);
        await vscode.env.clipboard.writeText(payload);
        vscode.window.showWarningMessage(`Couldn't auto-install — copied MCP server config to clipboard. ${err instanceof Error ? err.message : ""}`);
    }
}
function prettyCategory(c) {
    switch (c) {
        case "filesystem":
            return "Filesystem";
        case "fetch":
            return "Fetch & web";
        case "git":
            return "Git";
        case "database":
            return "Databases";
        case "search":
            return "Search";
        case "browser":
            return "Browser";
        case "memory":
            return "Memory";
        default:
            return "Other";
    }
}
//# sourceMappingURL=mcpHub.js.map