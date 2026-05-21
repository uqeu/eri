"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateMentionCompletions = activateMentionCompletions;
const vscode = require("vscode");
const provider_1 = require("./provider");
// Wires the `@` completion provider into every text editor. The picker
// commands themselves live in `../at_mentions/index.ts` — this file only
// keeps the inline-typing entrypoint so `@` in any editor still surfaces the
// mention vocabulary.
function activateMentionCompletions(context, registry) {
    const provider = new provider_1.EriMentionCompletionProvider(registry);
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider([
        { scheme: "file" },
        { scheme: "untitled" },
        { scheme: "vscode-userdata" },
    ], provider, "@"));
}
//# sourceMappingURL=mentions.js.map