"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const pure_1 = require("../pure");
function run(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    }
    catch (err) {
        console.error(`  fail ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}
console.log("document.test.ts");
run("isHttpUrl detects http and https", () => {
    assert.equal((0, pure_1.isHttpUrl)("http://foo"), true);
    assert.equal((0, pure_1.isHttpUrl)("https://foo"), true);
    assert.equal((0, pure_1.isHttpUrl)("./foo.pdf"), false);
    assert.equal((0, pure_1.isHttpUrl)("/abs/foo"), false);
});
run("isPdfFilename matches .pdf variants", () => {
    assert.equal((0, pure_1.isPdfFilename)("paper.pdf"), true);
    assert.equal((0, pure_1.isPdfFilename)("paper.PDF"), true);
    assert.equal((0, pure_1.isPdfFilename)("https://arxiv.org/pdf/2306.12345.pdf"), true);
    assert.equal((0, pure_1.isPdfFilename)("paper.pdf?x=1"), true);
    assert.equal((0, pure_1.isPdfFilename)("paper.html"), false);
});
run("cachePathFor is stable + under HOME", () => {
    const a = (0, pure_1.cachePathFor)("paper.pdf");
    const b = (0, pure_1.cachePathFor)("paper.pdf");
    const c = (0, pure_1.cachePathFor)("other.pdf");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.ok(a.startsWith(path.join(os.homedir(), ".eri", "documents")));
});
run("extractPdfText handles minimal BT/ET literal", () => {
    // Constructed minimal PDF-like blob with one page containing the
    // string "Hello".
    const blob = "/Type /Page\nBT (Hello) Tj ET";
    const { pages } = (0, pure_1.extractPdfText)(Buffer.from(blob, "latin1"));
    assert.equal(pages.length, 1);
    assert.match(pages[0].text, /Hello/);
});
run("extractPdfText emits page-1 fallback when no /Page header", () => {
    const blob = "BT (Stranded text) Tj ET";
    const { pages } = (0, pure_1.extractPdfText)(Buffer.from(blob, "latin1"));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].pageNumber, 1);
});
run("renderDocumentSummary tags pages and headlines target", () => {
    const md = (0, pure_1.renderDocumentSummary)("paper.pdf", [
        { pageNumber: 1, text: "first" },
        { pageNumber: 2, text: "second" },
    ]);
    assert.match(md, /# Document: paper\.pdf/);
    assert.match(md, /## Page 1/);
    assert.match(md, /## Page 2/);
});
run("renderDocumentSummary respects maxLines budget", () => {
    const md = (0, pure_1.renderDocumentSummary)("x.pdf", [{ pageNumber: 1, text: Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n") }], 20);
    assert.match(md, /\(truncated/);
    // Should be way fewer than 1000 lines.
    const linesCount = md.split("\n").length;
    assert.ok(linesCount < 50, `expected truncated output, got ${linesCount} lines`);
});
console.log("done.");
//# sourceMappingURL=document.test.js.map