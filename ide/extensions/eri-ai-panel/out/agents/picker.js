"use strict";
// QuickPick UI for switching the active agent. Shows available agents
// at the top; unavailable agents are listed below with a hint about why
// they can't be selected (sign in / install CLI / set BYOK key).
Object.defineProperty(exports, "__esModule", { value: true });
exports.showAgentPicker = showAgentPicker;
const vscode = require("vscode");
async function showAgentPicker(registry) {
    await registry.refreshAvailability();
    const descriptors = [...registry.list()];
    descriptors.sort(sortByAvailabilityThenLabel);
    const active = registry.active();
    const items = descriptors.map((d) => ({
        id: d.id,
        label: `${availabilityDot(d)} ${d.label}`,
        description: d.id === active.id ? "active" : describeBadge(d),
        detail: d.available ? d.description : `${d.description} — ${unavailableHint(d)}`,
        available: d.available,
    }));
    const pick = await vscode.window.showQuickPick(items, {
        title: "eri: switch agent",
        placeHolder: `current: ${active.label}`,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!pick)
        return;
    if (!pick.available) {
        vscode.window.showInformationMessage(`${pick.label} is unavailable. ${describeBadge({ id: pick.id })}`);
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
        case "mercury":
        case "auto":
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