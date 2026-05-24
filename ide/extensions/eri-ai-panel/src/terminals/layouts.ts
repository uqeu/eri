// iTerm-style saved arrangements. A layout is a JSON file under
// `<workspace>/.eri/terminal-layouts/<name>.json` capturing groups and
// their member terminals.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface LayoutTerminal {
  readonly name: string;
  readonly cwd: string;
  readonly command?: string;
  readonly icon?: string;
}

export interface LayoutGroup {
  readonly name: string;
  readonly icon?: string;
  readonly terminals: ReadonlyArray<LayoutTerminal>;
}

export interface TerminalLayout {
  readonly name: string;
  readonly description?: string;
  readonly groups: ReadonlyArray<LayoutGroup>;
}

export interface SavedLayoutRef {
  readonly name: string;
  readonly filePath: string;
}

export const LAYOUTS_DIRNAME = path.join(".eri", "terminal-layouts");

export function layoutsDir(workspaceFsPath: string): string {
  return path.join(workspaceFsPath, LAYOUTS_DIRNAME);
}

export function safeFileName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-");
  return cleaned.length > 0 ? cleaned : `layout-${Date.now()}`;
}

// Strict deserializer that fills in sane defaults for missing fields.
export function parseLayout(raw: unknown): TerminalLayout | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<TerminalLayout>;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) {
    return null;
  }
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups
        .map(parseLayoutGroup)
        .filter((g): g is LayoutGroup => g !== null)
    : [];
  return {
    name: candidate.name,
    description:
      typeof candidate.description === "string"
        ? candidate.description
        : undefined,
    groups,
  };
}

function parseLayoutGroup(raw: unknown): LayoutGroup | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<LayoutGroup>;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) {
    return null;
  }
  const terminals = Array.isArray(candidate.terminals)
    ? candidate.terminals
        .map(parseLayoutTerminal)
        .filter((t): t is LayoutTerminal => t !== null)
    : [];
  return {
    name: candidate.name,
    icon: typeof candidate.icon === "string" ? candidate.icon : undefined,
    terminals,
  };
}

function parseLayoutTerminal(raw: unknown): LayoutTerminal | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<LayoutTerminal>;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) {
    return null;
  }
  return {
    name: candidate.name,
    cwd: typeof candidate.cwd === "string" ? candidate.cwd : "",
    command:
      typeof candidate.command === "string" ? candidate.command : undefined,
    icon: typeof candidate.icon === "string" ? candidate.icon : undefined,
  };
}

export function serializeLayout(layout: TerminalLayout): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}

// Round-trip helper used by tests.
export function cloneLayout(layout: TerminalLayout): TerminalLayout | null {
  return parseLayout(JSON.parse(serializeLayout(layout)));
}

export async function listLayouts(
  workspaceFsPath: string,
): Promise<ReadonlyArray<SavedLayoutRef>> {
  const dir = layoutsDir(workspaceFsPath);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((file) => ({
      name: file.slice(0, -".json".length),
      filePath: path.join(dir, file),
    }));
}

export async function readLayout(
  filePath: string,
): Promise<TerminalLayout | null> {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return parseLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeLayout(
  workspaceFsPath: string,
  layout: TerminalLayout,
): Promise<string> {
  const dir = layoutsDir(workspaceFsPath);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${safeFileName(layout.name)}.json`);
  await fs.writeFile(filePath, serializeLayout(layout), "utf8");
  return filePath;
}

export async function deleteLayout(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
