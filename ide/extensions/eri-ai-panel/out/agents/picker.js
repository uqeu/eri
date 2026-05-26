"use strict";
// QuickPick UI for the agent selector. Renders three groups using
// QuickPick separators so the user sees:
//
//   eri
//     · eri (default — Mercury + Sonnet + GPT-4o + Gemini auto-routed)
//   Bring your own keys
//     · Claude (your key)
//     · GPT (your key)
//     · Gemini (your key)
//   External CLIs
//     · Claude Code (local)
//     · Codex (local)
//     · Aider (local)
//
// Anything in the registry with surface === "hidden" (Mercury + the three
// internal proxy variants) never appears here. The brain layer dispatches
// to them under the hood when the active agent is the default "eri".
Object.defineProperty(exports, "__esModule", { value: true });
exports.showAgentPicker = showAgentPicker;
const vscode = require("vscode");
const GROUP_LABEL = {
    default: "eri",
    byok: "Bring your own keys",
    cli: "External CLIs",
};
const GROUP_ORDER = ["default", "byok", "cli"];
function groupOf(d) {
    if (d.surface === "hidden")
        return "hidden";
    if (d.surface === "byok")
        return "byok";
    if (d.surface === "cli")
        return "cli";
    return "default";
}
async function showAgentPicker(registry) {
    await registry.refreshAvailability();
    const active = registry.active();
    const allDescriptors = [...registry.list()];
    // Partition by group + drop the hidden ones from the picker.
    const groups = {
        default: [],
        byok: [],
        cli: [],
    };
    for (const d of allDescriptors) {
        const g = groupOf(d);
        if (g === "hidden")
            continue;
        groups[g].push(d);
    }
    // Within each group: available first, then alphabetical.
    for (const g of GROUP_ORDER) {
        groups[g].sort(sortByAvailabilityThenLabel);
    }
    const items = [];
    for (const g of GROUP_ORDER) {
        const groupItems = groups[g];
        if (groupItems.length === 0)
            continue;
        items.push({
            label: GROUP_LABEL[g],
            kind: vscode.QuickPickItemKind.Separator,
        });
        for (const d of groupItems) {
            items.push({
                id: d.id,
                descriptor: d,
                available: d.available,
                label: `${availabilityDot(d)} ${d.label}`,
                description: d.id === active.id ? "active" : describeBadge(d),
                detail: d.available
                    ? d.description
                    : `${d.description} — ${unavailableHint(d)}`,
            });
        }
    }
    const pick = await vscode.window.showQuickPick(items, {
        title: "eri: switch agent",
        placeHolder: `current: ${active.label}`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!pick || !pick.id)
        return;
    if (pick.available === false) {
        vscode.window.showInformationMessage(`${pick.label} is unavailable. ${unavailableHint(pick.descriptor)}`);
        return;
    }
    await registry.setActive(pick.id);
}
function sortByAvailabilityThenLabel(a, b) {
    if (a.available !== b.available)
        return a.available ? -1 : 1;
    return a.label.localeCompare(b.label);
}
function availabilityDot(d) {
    if (!d.available)
        return "○";
    if (d.kind === "cli")
        return "🟢";
    if (d.free)
        return "🟡";
    return "🔵";
}
function describeBadge(d) {
    switch (d.kind) {
        case "auto":
            return "default · routes per turn";
        case "mercury":
            return "free · eri Engine";
        case "proxy":
            return "metered · eri proxy";
        case "byok":
            return "your key · no eri cost";
        case "cli":
            return "local CLI · no eri cost";
        default:
            return "";
    }
}
function unavailableHint(d) {
    switch (d.kind) {
        case "proxy":
            return "sign in to eri";
        case "byok":
            return "add an API key in Settings";
        case "cli":
            return `install \`${d.binary ?? "binary"}\` on your PATH`;
        default:
            return "unavailable";
    }
}
//# sourceMappingURL=picker.js.map