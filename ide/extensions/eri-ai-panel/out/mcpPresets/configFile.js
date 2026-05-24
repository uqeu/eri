"use strict";
// Read/write helpers for the mcp.json config file. Kept free of vscode imports
// so the tests can exercise this code under plain node.
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMcpConfig = readMcpConfig;
exports.writeMcpConfig = writeMcpConfig;
const fs = require("fs");
const path = require("path");
async function readMcpConfig(configPath) {
    try {
        const raw = await fs.promises.readFile(configPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
        return { mcpServers: {} };
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT") {
            return { mcpServers: {} };
        }
        throw err;
    }
}
async function writeMcpConfig(configPath, config) {
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    await fs.promises.writeFile(configPath, serialized, "utf8");
}
//# sourceMappingURL=configFile.js.map