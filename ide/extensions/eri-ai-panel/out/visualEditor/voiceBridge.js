"use strict";
// Routes voice transcripts into Visual Editor actions. The bridge is given a
// VisualEditorController surface; that surface lives in panel.ts and exposes
// the methods the bridge needs (apply style, queue change, relay to chat).
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceBridge = void 0;
const intentVocab_1 = require("./intentVocab");
class VoiceBridge {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    // Returns whether the transcript was consumed by the visual editor (true)
    // vs left for other consumers (false).
    async handleTranscript(transcript) {
        const intent = (0, intentVocab_1.matchIntent)(transcript);
        const picked = this.deps.getPickedElement();
        if (intent.kind === "none") {
            // Multi-target or unknown - always relay to chat with the editor as the
            // context source.
            const prompt = this.relayPrompt(transcript, picked);
            await this.deps.relayToChat(prompt);
            this.deps.showStatus(`relayed to chat: "${transcript}"`, "info");
            return { handled: true, intent, description: "relayed to chat" };
        }
        if (!picked) {
            // We matched a style intent but have no target - send the structured
            // change to chat so the agent can decide what to mutate.
            const prompt = this.relayStructuredPrompt(transcript, intent);
            await this.deps.relayToChat(prompt);
            this.deps.showStatus("no element picked - relayed to chat", "warn");
            return { handled: true, intent, description: "no target, relayed" };
        }
        switch (intent.kind) {
            case "direct":
            case "layout": {
                this.applyAndTrack(intent.styles, "voice");
                this.deps.showStatus(`applied: ${intent.phrase}`, "info");
                return {
                    handled: true,
                    intent,
                    description: `applied direct styles: ${Object.keys(intent.styles).join(", ")}`,
                };
            }
            case "relative": {
                const base = picked.computedStyles[intent.property];
                const resolved = (0, intentVocab_1.applyRelative)(intent, base);
                if (resolved === null) {
                    // Could not compute - fall back to relaying the intent to chat.
                    const prompt = this.relayStructuredPrompt(transcript, intent);
                    await this.deps.relayToChat(prompt);
                    this.deps.showStatus(`relayed: ${intent.phrase}`, "warn");
                    return { handled: true, intent, description: "relative base unparseable" };
                }
                this.applyAndTrack({ [intent.property]: resolved }, "voice");
                this.deps.showStatus(`applied: ${intent.phrase} -> ${intent.property}: ${resolved}`, "info");
                return {
                    handled: true,
                    intent,
                    description: `applied relative: ${intent.property}=${resolved}`,
                };
            }
        }
    }
    applyAndTrack(styles, source) {
        for (const [property, value] of Object.entries(styles)) {
            this.deps.tweaks.set({ property, value, source });
        }
        this.deps.applyStyles(styles);
    }
    relayPrompt(transcript, picked) {
        if (picked) {
            return `@VisualEditor @Element selector=${JSON.stringify(picked.selector)} - ${transcript}`;
        }
        return `@VisualEditor - ${transcript}`;
    }
    relayStructuredPrompt(transcript, intent) {
        const payload = intent.kind === "none"
            ? {}
            : intent.kind === "relative"
                ? { property: intent.property, delta: intent.delta, unit: intent.unit }
                : { styles: intent.styles };
        return `@VisualEditor voiceIntent=${intent.kind} payload=${JSON.stringify(payload)} transcript=${JSON.stringify(transcript)}`;
    }
}
exports.VoiceBridge = VoiceBridge;
//# sourceMappingURL=voiceBridge.js.map