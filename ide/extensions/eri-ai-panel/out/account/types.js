"use strict";
// Core types for the eri account module. The session "token" is a raw bearer
// that lives ONLY in OS Keychain (vscode.SecretStorage); the other fields are
// non-secret metadata cached in globalState for fast cold-start rendering.
//
// Tier slugs match the backend's `users.tier` column exactly — keep this list
// in sync with the website's `lib/stripe.ts::Tier` and `lib/tiers.ts::TierName`
// (the website uses the lowercase slug form for `users.tier`, the display
// names live in TIER_LABELS below).
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_LABELS = void 0;
exports.isEriTier = isEriTier;
exports.TIER_LABELS = {
    free: "Free",
    starter: "Individual I",
    pro: "Individual II",
    pro_plus: "Individual III",
    teams: "Teams",
    enterprise: "Enterprise",
};
function isEriTier(value) {
    return (value === "free" ||
        value === "starter" ||
        value === "pro" ||
        value === "pro_plus" ||
        value === "teams" ||
        value === "enterprise");
}
//# sourceMappingURL=types.js.map