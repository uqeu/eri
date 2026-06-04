"use strict";
// Gaze-lost talk-back: when eri has just answered and you look away from the
// screen, eri speaks the reply aloud so you can keep working hands/eyes-free.
//
// This is eri's edge over text-only CLIs. It wires two pieces that already
// exist but weren't connected: the gaze service's "leave" attention event and
// the chat reply text. The voice is eri_prod_voice (the TTS sidecar's default).
Object.defineProperty(exports, "__esModule", { value: true });
exports.GazeNarration = void 0;
const vscode = require("vscode");
const ttsClient_1 = require("./ttsClient");
// Only speak a reply that's still fresh -- if you looked away minutes after the
// answer, don't suddenly narrate stale text.
const FRESH_WINDOW_MS = 90_000;
class GazeNarration {
    voice;
    lastReply = "";
    replyAt = 0;
    spokenForCurrentReply = true;
    sub;
    constructor(service, voice) {
        this.voice = voice;
        this.sub = service.onAttention((event) => this.onAttention(event));
    }
    /** Record the latest chat reply; arms talk-back for the next look-away. */
    setReply(text) {
        const trimmed = text.trim();
        if (trimmed.length === 0)
            return;
        this.lastReply = trimmed;
        this.replyAt = Date.now();
        this.spokenForCurrentReply = false;
    }
    onAttention(event) {
        if (event.kind !== "leave")
            return;
        if (this.spokenForCurrentReply)
            return;
        if (!this.enabled())
            return;
        if (Date.now() - this.replyAt > FRESH_WINDOW_MS)
            return;
        // Speak once per reply, on the first look-away after it arrived.
        this.spokenForCurrentReply = true;
        void (0, ttsClient_1.speak)(this.lastReply, this.voice);
    }
    enabled() {
        return vscode.workspace
            .getConfiguration("eri")
            .get("voice.talkBackOnLookAway", true);
    }
    dispose() {
        this.sub.dispose();
    }
}
exports.GazeNarration = GazeNarration;
//# sourceMappingURL=gazeNarration.js.map