"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateAtMentions = activateAtMentions;
const vscode = require("vscode");
const registry_1 = require("./registry");
const picker_1 = require("./picker");
const resolvers_1 = require("./resolvers");
const settingsView_1 = require("./settingsView");
const storage_1 = require("./storage");
function activateAtMentions(context, getSidecar) {
    const registry = new registry_1.AtMentionRegistry(context);
    const pastChats = new storage_1.PastChatStore(context);
    const docSources = new storage_1.DocSourceStore(context, (0, picker_1.defaultDocSources)());
    const picker = new picker_1.AtMentionPicker({
        registry,
        listPastChats: () => pastChats.list(),
        listDocSources: () => docSources.list(),
    });
    const resolverDeps = {
        context,
        getSidecar,
        listPastChats: async () => pastChats.list().then((list) => list.map((entry) => ({
            id: entry.id,
            title: entry.title,
        }))),
        loadPastChat: (id) => pastChats.load(id),
        listDocSources: () => docSources.list(),
    };
    const resolvers = new resolvers_1.AtMentionResolvers(resolverDeps);
    const settings = new settingsView_1.AtMentionSettingsView(context, registry);
    let composerSink = null;
    async function pickAndDispatch(kind) {
        const chip = kind
            ? await picker.openKind(kind)
            : await picker.openTopLevel();
        if (!chip) {
            return undefined;
        }
        // Hand the chip to whatever surface asked. If a composer is listening it
        // will render the chip in its context strip; otherwise fall back to the
        // active editor / clipboard so the user still gets useful behavior.
        if (composerSink) {
            composerSink(chip);
        }
        else {
            await fallbackInsert(chip);
        }
        return chip;
    }
    context.subscriptions.push(vscode.commands.registerCommand("eri.atMentions.open", () => pickAndDispatch(undefined)), vscode.commands.registerCommand("eri.atMentions.manage", () => settings.open()), vscode.commands.registerCommand("eri.addDocSource", async () => {
        const label = await vscode.window.showInputBox({
            prompt: "Doc source label (e.g. 'Vue 3')",
        });
        if (!label) {
            return;
        }
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const url = await vscode.window.showInputBox({
            prompt: `Doc source URL for ${label}`,
            placeHolder: "https://…",
        });
        if (!url) {
            return;
        }
        await docSources.add({ slug, label, url });
        vscode.window.showInformationMessage(`eri @Docs — added ${label}`);
    }), 
    // Per-kind shortcuts so the existing keybindings + command palette entries
    // keep working. We dispatch through the same picker so the chip flow is
    // identical.
    vscode.commands.registerCommand("eri.mentions.openPicker", () => pickAndDispatch(undefined)), vscode.commands.registerCommand("eri.mentions.pickFile", () => pickAndDispatch("file")), vscode.commands.registerCommand("eri.mentions.pickFolder", () => pickAndDispatch("folder")), vscode.commands.registerCommand("eri.mentions.pickSymbol", () => pickAndDispatch("code")), vscode.commands.registerCommand("eri.mentions.pickWeb", () => pickAndDispatch("web")), vscode.commands.registerCommand("eri.mentions.pickDocs", () => pickAndDispatch("docs")), vscode.commands.registerCommand("eri.mentions.pickCodebase", () => pickAndDispatch("codebase")), vscode.commands.registerCommand("eri.mentions.pickGit", () => pickAndDispatch("git")), vscode.commands.registerCommand("eri.mentions.pickPastChats", () => pickAndDispatch("pastChats")), vscode.commands.registerCommand("eri.mentions.pickRecentChanges", () => pickAndDispatch("recentChanges")), vscode.commands.registerCommand("eri.mentions.pickLinterErrors", () => pickAndDispatch("linterErrors")), vscode.commands.registerCommand("eri.mentions.pickDefinitions", () => pickAndDispatch("definitions")), vscode.commands.registerCommand("eri.mentions.pickImage", () => pickAndDispatch("image")), { dispose: () => settings.dispose() });
    return {
        pick: (kind) => pickAndDispatch(kind),
        assemble: async (chips, userPrompt) => {
            const resolutions = await Promise.all(chips.map((chip) => resolvers.resolve(chip)));
            return (0, resolvers_1.assembleContextBlock)(resolutions, userPrompt);
        },
        savePastChat: (title, transcript) => pastChats.save(title, transcript),
        setComposerSink: (sink) => {
            composerSink = sink;
        },
        registry,
        dispose: () => settings.dispose(),
    };
}
async function fallbackInsert(chip) {
    const text = renderInlineToken(chip);
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(`eri — copied ${text} to clipboard`);
        return;
    }
    await editor.edit((builder) => {
        for (const selection of editor.selections) {
            builder.replace(selection, text);
        }
    });
}
// The inline-text form of a chip, used when no composer is listening. Mirrors
// Cursor's `@File path/to/file` rendering.
function renderInlineToken(chip) {
    switch (chip.kind) {
        case "file": return `@File ${chip.label}`;
        case "folder": return `@Folder ${chip.label}`;
        case "code": return `@Code ${chip.label}`;
        case "docs": return `@Docs ${chip.label}`;
        case "web": return `@Web ${chip.label}`;
        case "codebase": return `@Codebase ${chip.label}`;
        case "git": return `@Git ${chip.label}`;
        case "pastChats": return `@PastChats ${chip.label}`;
        case "recentChanges": return "@RecentChanges";
        case "linterErrors": return "@LinterErrors";
        case "definitions": return `@Definitions ${chip.label}`;
        case "codemap": return `@Codemap ${chip.label}`;
        case "image": return `@Image ${chip.label}`;
        default: return "@Mention";
    }
}
//# sourceMappingURL=index.js.map