// Routes voice transcripts into Visual Editor actions. The bridge is given a
// VisualEditorController surface; that surface lives in panel.ts and exposes
// the methods the bridge needs (apply style, queue change, relay to chat).

import { applyRelative, IntentResult, matchIntent } from "./intentVocab";
import { PickedElement } from "./pickerBridge";
import { TweakStore } from "./styleTweaker";

export interface VoiceBridgeDeps {
  // Current picked element (gaze-resolved OR user-clicked). Null when no
  // target is selected; the bridge will then relay the transcript to chat
  // verbatim.
  readonly getPickedElement: () => PickedElement | null;
  readonly tweaks: TweakStore;
  // Apply a style change against the picked element via the iframe shim.
  readonly applyStyles: (styles: Readonly<Record<string, string>>) => void;
  // Multi-target / unrecognized phrases - relayed to chat as a prompt.
  readonly relayToChat: (prompt: string) => Promise<void>;
  // UI feedback hook (status pill in the webview sidebar).
  readonly showStatus: (text: string, tone?: "info" | "warn" | "error") => void;
}

export interface VoiceDispatchResult {
  readonly handled: boolean;
  readonly intent: IntentResult;
  readonly description: string;
}

export class VoiceBridge {
  constructor(private readonly deps: VoiceBridgeDeps) {}

  // Returns whether the transcript was consumed by the visual editor (true)
  // vs left for other consumers (false).
  async handleTranscript(transcript: string): Promise<VoiceDispatchResult> {
    const intent = matchIntent(transcript);
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
        const resolved = applyRelative(intent, base);
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

  private applyAndTrack(
    styles: Readonly<Record<string, string>>,
    source: "voice" | "manual",
  ): void {
    for (const [property, value] of Object.entries(styles)) {
      this.deps.tweaks.set({ property, value, source });
    }
    this.deps.applyStyles(styles);
  }

  private relayPrompt(transcript: string, picked: PickedElement | null): string {
    if (picked) {
      return `@VisualEditor @Element selector=${JSON.stringify(picked.selector)} - ${transcript}`;
    }
    return `@VisualEditor - ${transcript}`;
  }

  private relayStructuredPrompt(transcript: string, intent: IntentResult): string {
    const payload =
      intent.kind === "none"
        ? {}
        : intent.kind === "relative"
          ? { property: intent.property, delta: intent.delta, unit: intent.unit }
          : { styles: intent.styles };
    return `@VisualEditor voiceIntent=${intent.kind} payload=${JSON.stringify(payload)} transcript=${JSON.stringify(transcript)}`;
  }
}
