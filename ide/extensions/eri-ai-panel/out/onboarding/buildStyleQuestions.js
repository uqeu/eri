"use strict";
// Phase 23 onboarding — three voice-friendly questions on first
// sign-in. Each answer writes into `<workspace>/.eri/preferences.json`
// (or `~/.eri/preferences.json` when no workspace is open) so the
// model sees the user's style from the very next turn.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOnboarding = runOnboarding;
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");
const QUESTIONS = [
    {
        prompt: "What do you usually build?",
        options: [
            {
                label: "Web apps",
                description: "Next.js / Tailwind / shadcn",
                apply: (d) => {
                    setPath(d, "stack.frontend", "next");
                    setPath(d, "stack.ui", "shadcn");
                    setPath(d, "stack.css", "tailwind");
                },
            },
            {
                label: "APIs",
                description: "axum / FastAPI / Postgres",
                apply: (d) => {
                    setPath(d, "stack.backend", "axum");
                    setPath(d, "stack.db", "postgres");
                },
            },
            {
                label: "Mobile apps",
                description: "Expo + Tamagui",
                apply: (d) => {
                    setPath(d, "stack.frontend", "expo");
                    setPath(d, "stack.ui", "tamagui");
                },
            },
            {
                label: "Scripts",
                description: "Quick automation, CLIs",
                apply: (d) => {
                    setPath(d, "workflow.verbosity", "terse");
                },
            },
            {
                label: "All of it",
                description: "Polyglot — keep defaults loose",
                apply: () => {
                    // No-op — defaults stay open.
                },
            },
        ],
    },
    {
        prompt: "What's your vibe?",
        options: [
            {
                label: "Minimal",
                description: "White, mono, max whitespace.",
                apply: (d) => {
                    setPath(d, "_themeSuggestion", "minimalism");
                },
            },
            {
                label: "Playful",
                description: "Pastels, rounded, friendly.",
                apply: (d) => {
                    setPath(d, "_themeSuggestion", "daisy-cupcake");
                },
            },
            {
                label: "Dark + technical",
                description: "Linear / GitHub Dark Dimmed.",
                apply: (d) => {
                    setPath(d, "_themeSuggestion", "linear");
                },
            },
            {
                label: "Warm + cozy",
                description: "Cream backgrounds, soft accents.",
                apply: (d) => {
                    setPath(d, "_themeSuggestion", "notion");
                },
            },
        ],
    },
    {
        prompt: "Any quirks? (free text — we'll extract preferences.)",
        options: [
            {
                label: "Skip",
                apply: () => undefined,
            },
        ],
        parseFreeForm: (text, d) => {
            const lower = text.toLowerCase();
            if (/no\s+semi|hate\s+semi|drop\s+semi/.test(lower)) {
                setPath(d, "codeStyle.semicolons", false);
            }
            const pmMatch = lower.match(/use\s+(pnpm|yarn|bun|npm)\b/);
            if (pmMatch && pmMatch[1]) {
                setPath(d, "stack.packageManager", pmMatch[1]);
            }
            if (/no\s+comments|hate\s+comments/.test(lower)) {
                setPath(d, "comments.publicApiDocs", "off");
                setPath(d, "comments.inlinePolicy", "minimal");
            }
            if (/tabs?\s+only|use\s+tabs/.test(lower)) {
                setPath(d, "codeStyle.indentation", "tabs");
            }
            if (/test[- ]?driven|tdd/.test(lower)) {
                setPath(d, "testing.preCommitRun", "tests");
            }
        },
    },
];
/**
 * Runs the three-question modal. Each answer mutates an in-memory
 * draft; we merge into the on-disk preferences at the end so a user
 * cancelling mid-flow doesn't corrupt their state.
 */
async function runOnboarding() {
    const draft = {};
    for (const question of QUESTIONS) {
        const items = question.options.map((o) => ({
            label: o.label,
            description: o.description,
        }));
        items.push({ label: "Other…", description: "Type a free-text answer" });
        const pick = await vscode.window.showQuickPick(items, {
            title: question.prompt,
            placeHolder: "Pick or type.",
            ignoreFocusOut: true,
        });
        if (!pick)
            return null; // user cancelled
        if (pick.label === "Other…") {
            const free = await vscode.window.showInputBox({
                prompt: question.prompt,
                ignoreFocusOut: true,
            });
            if (free === undefined)
                return null;
            if (free.trim() && question.parseFreeForm) {
                question.parseFreeForm(free.trim(), draft);
            }
        }
        else {
            const matched = question.options.find((o) => o.label === pick.label);
            matched?.apply(draft);
        }
    }
    const themeSuggestion = draft["_themeSuggestion"];
    delete draft["_themeSuggestion"];
    const path_ = await preferencesPath();
    const existing = await loadExisting(path_);
    const merged = deepMerge(existing, draft);
    await fs.mkdir(path.dirname(path_), { recursive: true });
    await fs.writeFile(path_, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return { preferencesPath: path_, themeSuggestion };
}
async function preferencesPath() {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspace) {
        return path.join(workspace, ".eri", "preferences.json");
    }
    return path.join(os.homedir(), ".eri", "preferences.json");
}
async function loadExisting(file) {
    try {
        const raw = await fs.readFile(file, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function setPath(obj, pathStr, value) {
    const parts = pathStr.split(".");
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        const next = cursor[key];
        if (!next || typeof next !== "object") {
            const fresh = {};
            cursor[key] = fresh;
            cursor = fresh;
        }
        else {
            cursor = next;
        }
    }
    cursor[parts[parts.length - 1]] = value;
}
function deepMerge(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
        const existing = out[k];
        if (existing &&
            typeof existing === "object" &&
            !Array.isArray(existing) &&
            v &&
            typeof v === "object" &&
            !Array.isArray(v)) {
            out[k] = deepMerge(existing, v);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
//# sourceMappingURL=buildStyleQuestions.js.map