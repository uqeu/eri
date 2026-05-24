// Read/write helpers for the mcp.json config file. Kept free of vscode imports
// so the tests can exercise this code under plain node.

import * as fs from "fs";
import * as path from "path";
import { RawConfigRoot } from "./merge";

export async function readMcpConfig(configPath: string): Promise<RawConfigRoot> {
  try {
    const raw = await fs.promises.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as RawConfigRoot;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return { mcpServers: {} };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { mcpServers: {} };
    }
    throw err;
  }
}

export async function writeMcpConfig(
  configPath: string,
  config: RawConfigRoot,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  await fs.promises.writeFile(configPath, serialized, "utf8");
}
