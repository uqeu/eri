"use strict";
// `/document <path-or-url>` — Nia parity (Phase 21b).
//
// Reads a local file path or downloads an HTTP(S) URL, extracts text
// (PDFs get heuristic text extraction; other files are read as UTF-8),
// renders a paginated markdown summary, and opens the result in a
// virtual document the user can chat against by selecting passages.
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPdfText = exports.renderDocumentSummary = exports.isPdfFilename = exports.isHttpUrl = exports.cachePathFor = void 0;
exports.runDocument = runDocument;
exports.showDocumentResult = showDocumentResult;
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const pure_1 = require("./pure");
var pure_2 = require("./pure");
Object.defineProperty(exports, "cachePathFor", { enumerable: true, get: function () { return pure_2.cachePathFor; } });
Object.defineProperty(exports, "isHttpUrl", { enumerable: true, get: function () { return pure_2.isHttpUrl; } });
Object.defineProperty(exports, "isPdfFilename", { enumerable: true, get: function () { return pure_2.isPdfFilename; } });
Object.defineProperty(exports, "renderDocumentSummary", { enumerable: true, get: function () { return pure_2.renderDocumentSummary; } });
Object.defineProperty(exports, "extractPdfText", { enumerable: true, get: function () { return pure_2.extractPdfText; } });
const HTTP_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024; // 32MB
async function runDocument(opts) {
    const target = opts.target.trim();
    if (!target) {
        throw new Error("/document needs a path or URL");
    }
    await fs.mkdir((0, pure_1.cacheRoot)(), { recursive: true });
    const cachePath = (0, pure_1.cachePathFor)(target);
    const bytes = (0, pure_1.isHttpUrl)(target)
        ? await downloadToCache(target, cachePath)
        : await readLocalFile(target, cachePath);
    const looksPdf = (0, pure_1.isPdfFilename)(target) ||
        looksLikePdfMagic(bytes) ||
        target.endsWith(".pdf");
    const markdown = looksPdf
        ? (0, pure_1.renderDocumentSummary)(target, (0, pure_1.extractPdfText)(bytes).pages)
        : (0, pure_1.renderDocumentSummary)(target, [
            { pageNumber: 1, text: Buffer.from(bytes).toString("utf8") },
        ]);
    return { target, markdown, cachePath };
}
async function showDocumentResult(result) {
    const doc = await vscode.workspace.openTextDocument({
        content: result.markdown,
        language: "markdown",
    });
    await vscode.window.showTextDocument(doc, { preview: false });
}
async function downloadToCache(url, cachePath) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("response body missing");
        }
        const chunks = [];
        let total = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            if (value) {
                total += value.length;
                if (total > MAX_DOWNLOAD_BYTES) {
                    throw new Error(`download exceeded ${MAX_DOWNLOAD_BYTES.toLocaleString()} bytes`);
                }
                chunks.push(value);
            }
        }
        const bytes = Buffer.concat(chunks);
        await fs.writeFile(cachePath, bytes);
        return bytes;
    }
    finally {
        clearTimeout(timer);
    }
}
async function readLocalFile(target, cachePath) {
    // Resolve relative to the active workspace if not absolute.
    let resolved = target;
    if (!path.isAbsolute(target)) {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspace) {
            resolved = path.join(workspace, target);
        }
    }
    const bytes = await fs.readFile(resolved);
    await fs.writeFile(cachePath, bytes);
    return bytes;
}
function looksLikePdfMagic(buf) {
    // PDF files start with "%PDF-".
    return (buf.length > 4 &&
        buf[0] === 0x25 &&
        buf[1] === 0x50 &&
        buf[2] === 0x44 &&
        buf[3] === 0x46 &&
        buf[4] === 0x2d);
}
//# sourceMappingURL=index.js.map