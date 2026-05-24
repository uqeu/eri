"use strict";
// Curated list of MCP servers from the public Model Context Protocol ecosystem.
// Each entry is open-source and runs locally on the user's machine. The list is
// baked into the extension at build time — eri never phones home to fetch this
// catalog. Updates ship via extension updates.
//
// Verification policy: every entry references a package that was confirmed to
// exist on npm (or PyPI for python servers) at the time of authorship. Entries
// dropped during research are listed in the report comments at the bottom.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_ORDER = exports.CATEGORY_LABELS = exports.RECOMMENDED_SAFE_DEFAULTS = exports.MCP_PRESETS = void 0;
exports.getPreset = getPreset;
exports.visiblePresets = visiblePresets;
exports.presetsByCategory = presetsByCategory;
// Helper to build env var specs with consistent defaults.
function envVar(name, label, hint, secret) {
    return { name, label, hint, secret };
}
/**
 * The starter-pack catalog. Categories grouped for the browse view ordering.
 *
 * Verified npm packages (May 2026):
 *   - @modelcontextprotocol/server-filesystem
 *   - @modelcontextprotocol/server-github
 *   - @modelcontextprotocol/server-memory
 *   - @modelcontextprotocol/server-sequential-thinking
 *   - @modelcontextprotocol/server-sqlite
 *   - @modelcontextprotocol/server-postgres
 *   - @modelcontextprotocol/server-brave-search
 *   - @modelcontextprotocol/server-slack
 *   - @modelcontextprotocol/server-puppeteer
 *   - @modelcontextprotocol/server-git
 *
 * Not on npm (use uvx/Python via PyPI under `mcp-server-*`):
 *   - mcp-server-time         (PyPI: `mcp-server-time` — uvx)
 *   - mcp-server-fetch        (PyPI: `mcp-server-fetch` — uvx)
 *
 * Linear: there is no first-party MCP server in @modelcontextprotocol scope
 * at time of authorship. Dropped from default list — marked deprecated below
 * for documentation continuity.
 */
exports.MCP_PRESETS = Object.freeze([
    {
        id: "filesystem",
        displayName: "Filesystem",
        description: "Read and write files in a sandboxed directory. Safe; restricted to the paths you allow.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
        transport: "stdio",
        category: "filesystem",
        requiredEnv: [],
        optionalEnv: [],
        isReadOnly: false,
    },
    {
        id: "memory",
        displayName: "Memory",
        description: "Ephemeral in-process key/value memory the model can write notes to during a session.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        transport: "stdio",
        category: "productivity",
        requiredEnv: [],
        optionalEnv: [],
        isReadOnly: false,
    },
    {
        id: "time",
        displayName: "Time",
        description: "Current time, timezone conversion, and date arithmetic. No network access.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
        command: "uvx",
        args: ["mcp-server-time"],
        transport: "stdio",
        category: "productivity",
        requiredEnv: [],
        optionalEnv: [
            envVar("LOCAL_TIMEZONE", "Local timezone", "e.g. America/Los_Angeles", false),
        ],
        isReadOnly: true,
    },
    {
        id: "fetch",
        displayName: "Fetch",
        description: "HTTP GET an arbitrary URL and return the body as text. Network egress on demand.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
        command: "uvx",
        args: ["mcp-server-fetch"],
        transport: "stdio",
        category: "search",
        requiredEnv: [],
        optionalEnv: [],
        isReadOnly: true,
    },
    {
        id: "sequential-thinking",
        displayName: "Sequential Thinking",
        description: "Lets the model spend extra steps reasoning before answering. No external I/O.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        transport: "stdio",
        category: "productivity",
        requiredEnv: [],
        optionalEnv: [],
        isReadOnly: true,
    },
    {
        id: "git",
        displayName: "Git",
        description: "Read git history, diffs, and branches in the current workspace. Read-only.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
        command: "uvx",
        args: ["mcp-server-git", "--repository", "${workspaceFolder}"],
        transport: "stdio",
        category: "vcs",
        requiredEnv: [],
        optionalEnv: [],
        isReadOnly: true,
    },
    {
        id: "github",
        displayName: "GitHub",
        description: "Issues, PRs, code search, and repo metadata via the GitHub REST API. Requires a personal access token.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        transport: "stdio",
        category: "vcs",
        requiredEnv: [
            envVar("GITHUB_PERSONAL_ACCESS_TOKEN", "GitHub personal access token", "ghp_...", true),
        ],
        optionalEnv: [],
        isReadOnly: false,
    },
    {
        id: "sqlite",
        displayName: "SQLite",
        description: "Query and inspect a local SQLite database. Provide the path to the .db file.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sqlite"],
        transport: "stdio",
        category: "database",
        requiredEnv: [
            envVar("SQLITE_DB_PATH", "Database path", "/path/to/db.sqlite", false),
        ],
        optionalEnv: [],
        isReadOnly: false,
    },
    {
        id: "postgres",
        displayName: "Postgres",
        description: "Read-only SQL query access to a PostgreSQL database via DATABASE_URL.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        transport: "stdio",
        category: "database",
        requiredEnv: [
            envVar("DATABASE_URL", "Postgres connection URL", "postgresql://user:pass@host:5432/db", true),
        ],
        optionalEnv: [],
        isReadOnly: true,
    },
    {
        id: "brave-search",
        displayName: "Brave Search",
        description: "Web search via the Brave Search API. Requires a Brave API key.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-brave-search"],
        transport: "stdio",
        category: "search",
        requiredEnv: [envVar("BRAVE_API_KEY", "Brave API key", "BSA...", true)],
        optionalEnv: [],
        isReadOnly: true,
    },
    {
        id: "slack",
        displayName: "Slack",
        description: "Read messages, post messages, and manage channels via the Slack bot API.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-slack"],
        transport: "stdio",
        category: "productivity",
        requiredEnv: [
            envVar("SLACK_BOT_TOKEN", "Slack bot token", "xoxb-...", true),
            envVar("SLACK_TEAM_ID", "Slack team ID", "T01234567", false),
        ],
        optionalEnv: [],
        isReadOnly: false,
    },
    {
        id: "puppeteer",
        displayName: "Puppeteer",
        description: "Drive a headless Chromium browser for automated interaction. Heavy; opt-in.",
        repo: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-puppeteer"],
        transport: "stdio",
        category: "browser",
        requiredEnv: [],
        optionalEnv: [],
        isReadOnly: false,
        beta: true,
    },
    {
        id: "linear",
        displayName: "Linear",
        description: "Linear issues and projects. Dropped from defaults — no first-party MCP package available at time of authorship.",
        repo: "https://github.com/modelcontextprotocol/servers",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-linear"],
        transport: "stdio",
        category: "productivity",
        requiredEnv: [envVar("LINEAR_API_KEY", "Linear API key", "lin_api_...", true)],
        optionalEnv: [],
        isReadOnly: false,
        deprecated: true,
        note: "No first-party MCP server on npm. Use a community fork at your own risk.",
    },
]);
/** The three safe defaults offered after onboarding — no API keys, low surface area. */
exports.RECOMMENDED_SAFE_DEFAULTS = Object.freeze([
    "filesystem",
    "time",
    "memory",
]);
const PRESET_BY_ID = new Map(exports.MCP_PRESETS.map((preset) => [preset.id, preset]));
function getPreset(id) {
    return PRESET_BY_ID.get(id) ?? null;
}
function visiblePresets(options) {
    return exports.MCP_PRESETS.filter((preset) => {
        if (preset.deprecated) {
            return false;
        }
        if (preset.beta && !options.includeBeta) {
            return false;
        }
        return true;
    });
}
function presetsByCategory(presets) {
    const grouped = new Map();
    for (const preset of presets) {
        const existing = grouped.get(preset.category);
        if (existing) {
            existing.push(preset);
        }
        else {
            grouped.set(preset.category, [preset]);
        }
    }
    return grouped;
}
exports.CATEGORY_LABELS = Object.freeze({
    filesystem: "Filesystem",
    vcs: "Version control",
    search: "Web & search",
    database: "Databases",
    browser: "Browser",
    productivity: "Productivity",
    other: "Other",
});
exports.CATEGORY_ORDER = Object.freeze([
    "filesystem",
    "vcs",
    "search",
    "database",
    "browser",
    "productivity",
    "other",
]);
//# sourceMappingURL=catalog.js.map