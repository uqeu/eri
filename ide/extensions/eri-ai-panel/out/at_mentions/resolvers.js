"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtMentionResolvers = exports.BUILT_IN_DOC_SOURCES = void 0;
exports.assembleContextBlock = assembleContextBlock;
const child_process_1 = require("child_process");
const path = require("path");
const util_1 = require("util");
const vscode = require("vscode");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Hard limits to keep prompt context bounded. Resolvers MUST respect these.
const MAX_FILE_BYTES = 200_000;
const MAX_FOLDER_FILES = 50;
const MAX_DIAGNOSTICS = 200;
const MAX_DEFINITIONS = 12;
const SIDECAR_REQUEST_TIMEOUT_MS = 4_000;
exports.BUILT_IN_DOC_SOURCES = [
    {
        slug: "react",
        label: "React",
        url: "https://react.dev/reference/react",
    },
    {
        slug: "node",
        label: "Node.js",
        url: "https://nodejs.org/api/index.html",
    },
    {
        slug: "python",
        label: "Python stdlib",
        url: "https://docs.python.org/3/library/index.html",
    },
    {
        slug: "typescript",
        label: "TypeScript handbook",
        url: "https://www.typescriptlang.org/docs/handbook/intro.html",
    },
];
class AtMentionResolvers {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async resolve(chip) {
        switch (chip.kind) {
            case "file":
                return this.resolveFile(chip);
            case "folder":
                return this.resolveFolder(chip);
            case "code":
                return this.resolveCode(chip);
            case "docs":
                return this.resolveDocs(chip);
            case "web":
                return this.resolveWeb(chip);
            case "codebase":
                return this.resolveCodebase(chip);
            case "git":
                return this.resolveGit(chip);
            case "pastChats":
                return this.resolvePastChats(chip);
            case "recentChanges":
                return this.resolveRecentChanges(chip);
            case "linterErrors":
                return this.resolveLinterErrors(chip);
            case "definitions":
                return this.resolveDefinitions(chip);
            default:
                return assertNever(chip.kind);
        }
    }
    async resolveFile(chip) {
        const fsPath = stringField(chip.payload, "fsPath");
        if (!fsPath) {
            return emptyResolved(`@File ${chip.label}`, "missing fsPath");
        }
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
            const text = document.getText();
            const trimmed = text.length > MAX_FILE_BYTES
                ? `${text.slice(0, MAX_FILE_BYTES)}\n…(truncated ${text.length - MAX_FILE_BYTES} bytes)`
                : text;
            return {
                heading: `@File ${vscode.workspace.asRelativePath(fsPath)}`,
                body: codeFence(trimmed, languageHint(fsPath)),
            };
        }
        catch (err) {
            return emptyResolved(`@File ${chip.label}`, errorMessage(err));
        }
    }
    async resolveFolder(chip) {
        const relativePath = stringField(chip.payload, "path");
        if (!relativePath) {
            return emptyResolved(`@Folder ${chip.label}`, "missing path");
        }
        const pattern = relativePath === "." || relativePath.length === 0
            ? "**/*"
            : `${relativePath}/**/*`;
        const uris = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git,target,dist,out,build}/**", MAX_FOLDER_FILES);
        const listing = uris
            .map((uri) => `- ${vscode.workspace.asRelativePath(uri)}`)
            .join("\n");
        const note = uris.length === MAX_FOLDER_FILES
            ? `\n…(listing truncated to first ${MAX_FOLDER_FILES} files)`
            : "";
        return {
            heading: `@Folder ${relativePath}`,
            body: `${listing}${note}`.trim() || "(empty folder)",
        };
    }
    async resolveCode(chip) {
        const fsPath = stringField(chip.payload, "fsPath");
        const name = stringField(chip.payload, "name") ?? chip.label;
        const startLine = numberField(chip.payload, "startLine");
        const endLine = numberField(chip.payload, "endLine");
        if (!fsPath || startLine === undefined || endLine === undefined) {
            return emptyResolved(`@Code ${name}`, "missing location data");
        }
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
            const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, Number.MAX_SAFE_INTEGER));
            const slice = document.getText(range);
            const rel = vscode.workspace.asRelativePath(fsPath);
            return {
                heading: `@Code ${name} (${rel}:${startLine + 1}-${endLine + 1})`,
                body: codeFence(slice, languageHint(fsPath)),
            };
        }
        catch (err) {
            return emptyResolved(`@Code ${name}`, errorMessage(err));
        }
    }
    async resolveDocs(chip) {
        const slug = stringField(chip.payload, "slug");
        if (!slug) {
            return emptyResolved(`@Docs ${chip.label}`, "missing slug");
        }
        const source = this.deps.listDocSources().find((entry) => entry.slug === slug);
        if (!source) {
            return emptyResolved(`@Docs ${slug}`, "unknown doc source");
        }
        const cached = this.deps.context.globalState.get(`eri.docs.cache.${slug}`);
        const now = Date.now();
        const TTL_MS = 24 * 60 * 60 * 1000;
        if (cached && now - cached.at < TTL_MS) {
            return {
                heading: `@Docs ${source.label} (${source.url}, cached)`,
                body: cached.body,
            };
        }
        // Defer the actual fetch to the sidecar — it has the HTTP stack and
        // can apply auth/proxy rules.
        const sidecar = this.deps.getSidecar();
        if (!sidecar) {
            return {
                heading: `@Docs ${source.label}`,
                body: `(sidecar offline — would fetch ${source.url})`,
                pending: true,
            };
        }
        try {
            const response = await withTimeout(sidecar.request("docs/fetch", {
                slug,
                url: source.url,
            }), SIDECAR_REQUEST_TIMEOUT_MS);
            const body = typeof response?.body === "string" ? response.body : "";
            if (body.length > 0) {
                await this.deps.context.globalState.update(`eri.docs.cache.${slug}`, { at: now, body });
            }
            return {
                heading: `@Docs ${source.label} (${source.url})`,
                body: body.length > 0
                    ? body
                    : `(sidecar returned no content for ${source.url})`,
                pending: body.length === 0,
            };
        }
        catch (err) {
            return {
                heading: `@Docs ${source.label}`,
                body: `(pending sidecar — ${errorMessage(err)})`,
                pending: true,
            };
        }
    }
    async resolveWeb(chip) {
        const query = stringField(chip.payload, "query") ?? chip.label;
        const sidecar = this.deps.getSidecar();
        if (!sidecar) {
            return {
                heading: `@Web ${query}`,
                body: "(sidecar offline)",
                pending: true,
            };
        }
        try {
            const response = await withTimeout(sidecar.request("web/search", {
                query,
            }), SIDECAR_REQUEST_TIMEOUT_MS);
            const summary = typeof response?.summary === "string"
                ? response.summary
                : "";
            if (summary.length > 0) {
                return { heading: `@Web ${query}`, body: summary };
            }
            return {
                heading: `@Web ${query}`,
                body: "(web search not yet implemented in sidecar)",
                pending: true,
            };
        }
        catch (err) {
            return {
                heading: `@Web ${query}`,
                body: `(pending sidecar — ${errorMessage(err)})`,
                pending: true,
            };
        }
    }
    async resolveCodebase(chip) {
        const query = stringField(chip.payload, "query") ?? chip.label;
        const sidecar = this.deps.getSidecar();
        if (!sidecar) {
            return {
                heading: `@Codebase ${query}`,
                body: "(sidecar offline — codebase index unavailable)",
                pending: true,
            };
        }
        try {
            const response = await withTimeout(sidecar.request("index/search", { query, limit: 12 }), SIDECAR_REQUEST_TIMEOUT_MS);
            const hits = Array.isArray(response?.hits) ? response.hits : [];
            if (hits.length === 0) {
                return {
                    heading: `@Codebase ${query}`,
                    body: "(Indexing in progress…)",
                    pending: true,
                };
            }
            const body = hits
                .map((hit) => `## ${hit.path}\n${codeFence(hit.snippet ?? "", "")}`)
                .join("\n\n");
            return { heading: `@Codebase ${query}`, body };
        }
        catch (err) {
            return {
                heading: `@Codebase ${query}`,
                body: `(Indexing in progress… ${errorMessage(err)})`,
                pending: true,
            };
        }
    }
    async resolveGit(chip) {
        const kind = stringField(chip.payload, "gitKind") ?? "commit";
        const ref = stringField(chip.payload, "ref") ?? "HEAD";
        const cwd = workspaceCwd();
        if (!cwd) {
            return emptyResolved("@Git", "no workspace folder");
        }
        try {
            if (kind === "branch") {
                const { stdout } = await execAsync(`git log --pretty=format:"%h %s" -n 30 ${shellEscape(ref)}`, { cwd });
                return {
                    heading: `@Git branch ${ref}`,
                    body: stdout.trim() || "(no commits)",
                };
            }
            if (kind === "diff") {
                const { stdout } = await execAsync(`git diff ${shellEscape(ref)}`, { cwd, maxBuffer: 1024 * 1024 });
                return {
                    heading: `@Git diff ${ref}`,
                    body: codeFence(stdout.trim(), "diff"),
                };
            }
            const { stdout } = await execAsync(`git show --stat --patch ${shellEscape(ref)}`, { cwd, maxBuffer: 1024 * 1024 });
            return {
                heading: `@Git ${ref}`,
                body: codeFence(stdout.trim(), "diff"),
            };
        }
        catch (err) {
            return emptyResolved(`@Git ${ref}`, errorMessage(err));
        }
    }
    async resolvePastChats(chip) {
        const id = stringField(chip.payload, "id");
        if (!id) {
            return emptyResolved("@PastChats", "missing chat id");
        }
        const transcript = await this.deps.loadPastChat(id);
        if (transcript === null) {
            return emptyResolved(`@PastChats ${chip.label}`, "chat not found");
        }
        return {
            heading: `@PastChats ${chip.label}`,
            body: transcript,
        };
    }
    async resolveRecentChanges(_chip) {
        const cwd = workspaceCwd();
        if (!cwd) {
            return emptyResolved("@RecentChanges", "no workspace folder");
        }
        try {
            const [{ stdout: statusOut }, { stdout: diffStat }] = await Promise.all([
                execAsync("git status --porcelain", { cwd }),
                execAsync("git diff --stat", { cwd, maxBuffer: 256 * 1024 }),
            ]);
            const body = [
                "### git status",
                statusOut.trim() || "(clean)",
                "",
                "### git diff --stat",
                diffStat.trim() || "(no changes)",
            ].join("\n");
            return { heading: "@RecentChanges", body };
        }
        catch (err) {
            return emptyResolved("@RecentChanges", errorMessage(err));
        }
    }
    async resolveLinterErrors(_chip) {
        const all = vscode.languages.getDiagnostics();
        const lines = [];
        let total = 0;
        for (const [uri, diagnostics] of all) {
            for (const diag of diagnostics) {
                if (diag.severity !== vscode.DiagnosticSeverity.Error &&
                    diag.severity !== vscode.DiagnosticSeverity.Warning) {
                    continue;
                }
                if (total >= MAX_DIAGNOSTICS) {
                    lines.push(`…(truncated, more than ${MAX_DIAGNOSTICS} diagnostics)`);
                    break;
                }
                const severity = diag.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning";
                const rel = vscode.workspace.asRelativePath(uri);
                const where = `${rel}:${diag.range.start.line + 1}:${diag.range.start.character + 1}`;
                const source = diag.source ? `[${diag.source}] ` : "";
                lines.push(`- ${severity} ${source}${where} — ${diag.message}`);
                total += 1;
            }
            if (total >= MAX_DIAGNOSTICS) {
                break;
            }
        }
        return {
            heading: "@LinterErrors",
            body: lines.length === 0 ? "(no errors or warnings)" : lines.join("\n"),
        };
    }
    async resolveDefinitions(chip) {
        const fsPath = stringField(chip.payload, "fsPath");
        const line = numberField(chip.payload, "line");
        const character = numberField(chip.payload, "character");
        if (!fsPath || line === undefined || character === undefined) {
            return emptyResolved("@Definitions", "missing cursor position");
        }
        try {
            const uri = vscode.Uri.file(fsPath);
            const document = await vscode.workspace.openTextDocument(uri);
            const wordRange = document.getWordRangeAtPosition(new vscode.Position(line, character));
            const sourceSymbol = wordRange ? document.getText(wordRange) : "";
            // Gather symbols referenced in the surrounding ~50 lines, then ask the
            // definition provider for each. We dedupe by symbol name to keep things
            // bounded.
            const startLine = Math.max(0, line - 25);
            const endLine = Math.min(document.lineCount - 1, line + 25);
            const symbolNames = new Set();
            if (sourceSymbol) {
                symbolNames.add(sourceSymbol);
            }
            const identifierRe = /\b[_A-Za-z][_A-Za-z0-9]{2,}\b/g;
            for (let row = startLine; row <= endLine; row += 1) {
                const text = document.lineAt(row).text;
                for (const match of text.matchAll(identifierRe)) {
                    symbolNames.add(match[0]);
                    if (symbolNames.size >= 60) {
                        break;
                    }
                }
            }
            const definitions = [];
            const seenLocations = new Set();
            for (const name of symbolNames) {
                if (definitions.length >= MAX_DEFINITIONS) {
                    break;
                }
                const idx = document.getText().indexOf(name);
                if (idx < 0) {
                    continue;
                }
                const pos = document.positionAt(idx);
                const locations = (await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, pos)) ?? [];
                for (const location of locations) {
                    const targetUri = "uri" in location ? location.uri : location.targetUri;
                    const range = "range" in location ? location.range : location.targetRange;
                    const key = `${targetUri.fsPath}:${range.start.line}:${range.start.character}`;
                    if (seenLocations.has(key)) {
                        continue;
                    }
                    seenLocations.add(key);
                    try {
                        const target = await vscode.workspace.openTextDocument(targetUri);
                        const head = Math.max(0, range.start.line);
                        const tail = Math.min(target.lineCount - 1, range.end.line + 2);
                        const snippet = target.getText(new vscode.Range(new vscode.Position(head, 0), new vscode.Position(tail, Number.MAX_SAFE_INTEGER)));
                        definitions.push(`### ${name} — ${vscode.workspace.asRelativePath(targetUri)}:${head + 1}\n${codeFence(snippet, languageHint(targetUri.fsPath))}`);
                    }
                    catch {
                        // skip files we can't open
                    }
                    if (definitions.length >= MAX_DEFINITIONS) {
                        break;
                    }
                }
            }
            return {
                heading: `@Definitions near ${vscode.workspace.asRelativePath(fsPath)}:${line + 1}`,
                body: definitions.length === 0
                    ? "(no definitions found near cursor)"
                    : definitions.join("\n\n"),
            };
        }
        catch (err) {
            return emptyResolved("@Definitions", errorMessage(err));
        }
    }
}
exports.AtMentionResolvers = AtMentionResolvers;
function assembleContextBlock(resolutions, userPrompt) {
    if (resolutions.length === 0) {
        return userPrompt;
    }
    const sections = resolutions
        .map((entry) => `## ${entry.heading}\n${entry.body.trim()}`)
        .join("\n\n");
    return `# Context\n${sections}\n\n# Request\n${userPrompt}`;
}
// ---------- internal helpers ----------
function stringField(payload, key) {
    const value = payload[key];
    return typeof value === "string" ? value : undefined;
}
function numberField(payload, key) {
    const value = payload[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function workspaceCwd() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders[0]?.uri.fsPath;
}
function codeFence(body, language) {
    const lang = language || "";
    return `\`\`\`${lang}\n${body}\n\`\`\``;
}
function languageHint(fsPath) {
    const ext = path.extname(fsPath).toLowerCase();
    switch (ext) {
        case ".ts": return "typescript";
        case ".tsx": return "tsx";
        case ".js": return "javascript";
        case ".jsx": return "jsx";
        case ".rs": return "rust";
        case ".py": return "python";
        case ".go": return "go";
        case ".md": return "markdown";
        case ".json": return "json";
        case ".html": return "html";
        case ".css": return "css";
        default: return "";
    }
}
function shellEscape(value) {
    // Only allow alnum, dash, underscore, dot, slash, colon, ^, ~, @. Anything
    // else gets stripped to prevent injection into the git command line.
    return value.replace(/[^A-Za-z0-9_\-./:^~@]/g, "");
}
async function withTimeout(promise, ms) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
function emptyResolved(heading, reason) {
    return { heading, body: `(${reason})`, pending: true };
}
function assertNever(kind) {
    throw new Error(`unhandled mention kind: ${kind}`);
}
//# sourceMappingURL=resolvers.js.map