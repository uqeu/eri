"use strict";
// Wire-shape types mirroring the Rust `eri_review` crate's serde output. Keep
// these in sync with crates/eri_review/src/findings.rs and crates/eri_review/src/diff.rs.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEVERITY_RANK = void 0;
exports.severityIcon = severityIcon;
exports.SEVERITY_RANK = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
};
function severityIcon(sev) {
    switch (sev) {
        case "critical":
            return "$(error)";
        case "high":
            return "$(warning)";
        case "medium":
            return "$(issue-opened)";
        case "low":
            return "$(info)";
        case "info":
            return "$(comment)";
    }
}
//# sourceMappingURL=types.js.map