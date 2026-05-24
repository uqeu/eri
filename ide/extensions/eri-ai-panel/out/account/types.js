"use strict";
// Core types for the eri account module. The session "token" is a raw bearer
// that lives ONLY in OS Keychain (vscode.SecretStorage); the other fields are
// non-secret metadata cached in globalState for fast cold-start rendering.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_LABELS = void 0;
exports.isEriTier = isEriTier;
exports.TIER_LABELS = {
    free: "Free",
    pro: "Pro",
    proPlus: "Pro+",
    team: "Team",
    enterprise: "Enterprise",
};
function isEriTier(value) {
    return (value === "free" ||
        value === "pro" ||
        value === "proPlus" ||
        value === "team" ||
        value === "enterprise");
}
//# sourceMappingURL=types.js.map