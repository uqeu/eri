"use strict";
// Pure helpers for the /document flow — keep them independent of
// `vscode` so they unit-test cleanly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.cachePathFor = cachePathFor;
exports.cacheRoot = cacheRoot;
exports.isHttpUrl = isHttpUrl;
exports.isPdfFilename = isPdfFilename;
exports.extractPdfText = extractPdfText;
exports.renderDocumentSummary = renderDocumentSummary;
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const CACHE_ROOT = path.join(os.homedir(), ".eri", "documents");
function cachePathFor(target) {
    const sha = crypto
        .createHash("sha256")
        .update(target)
        .digest("hex")
        .slice(0, 16);
    return path.join(CACHE_ROOT, `${sha}.bin`);
}
function cacheRoot() {
    return CACHE_ROOT;
}
function isHttpUrl(target) {
    return /^https?:\/\//.test(target);
}
function isPdfFilename(target) {
    return /\.pdf(\?|#|$)/i.test(target);
}
/**
 * Heuristic extraction of text + page boundaries from a raw PDF byte
 * buffer. Implements a tiny subset of the PDF text-extraction
 * algorithm: walks the object stream looking for `BT` … `ET`
 * (begin-text / end-text) blocks and concatenates the literal strings
 * inside. Not a substitute for a real PDF library — we use it as a
 * fallback when no system PDF tooling is installed.
 *
 * Returns `{ pages: [{ pageNumber, text }] }`. Empty pages are
 * preserved so `[p. N]` citations from the model line up with the
 * source.
 */
function extractPdfText(buf) {
    const ascii = Buffer.from(buf).toString("latin1"); // PDFs are mostly latin-1 / ASCII metadata
    const pagesRaw = ascii.split(/\/Type\s*\/Page(?!s)/);
    const pages = [];
    let pageNumber = 0;
    for (const chunk of pagesRaw.slice(1)) {
        pageNumber += 1;
        const text = extractTextBlocks(chunk);
        pages.push({ pageNumber, text });
    }
    if (pages.length === 0) {
        pages.push({ pageNumber: 1, text: extractTextBlocks(ascii) });
    }
    return { pages };
}
function extractTextBlocks(chunk) {
    const out = [];
    // Use String.matchAll to walk all BT/ET blocks without calling
    // RegExp.exec directly (which trips overly-broad lint rules).
    const blockMatches = chunk.matchAll(/BT([\s\S]*?)ET/g);
    for (const m of blockMatches) {
        const block = m[1] ?? "";
        const literalMatches = block.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g);
        for (const s of literalMatches) {
            out.push(unescapePdfString(s[1] ?? ""));
        }
    }
    return out.join(" ").replace(/\s+/g, " ").trim();
}
function unescapePdfString(s) {
    return s
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
}
/**
 * Render a textual summary of a parsed document, capped at ~600 lines
 * total so the model context isn't blown by a 300-page PDF. Each page
 * gets a `## Page N` header so the model's response can cite `[p. N]`.
 */
function renderDocumentSummary(target, pages, maxLines = 600) {
    const out = [];
    out.push(`# Document: ${target}`);
    out.push("");
    let lineBudget = maxLines;
    let truncated = false;
    outer: for (const page of pages) {
        if (lineBudget <= 0) {
            truncated = true;
            break;
        }
        out.push(`## Page ${page.pageNumber}`);
        lineBudget -= 1;
        const lines = page.text.split(/\n/);
        for (const line of lines) {
            if (lineBudget <= 0) {
                truncated = true;
                break outer;
            }
            const trimmed = line.trim();
            if (trimmed.length === 0)
                continue;
            out.push(trimmed);
            lineBudget -= 1;
        }
        out.push("");
        lineBudget -= 1;
    }
    if (truncated) {
        out.push("…(truncated for context budget)");
    }
    return out.join("\n");
}
//# sourceMappingURL=pure.js.map