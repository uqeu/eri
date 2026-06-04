// Gaze-lost talk-back: when eri has just answered and you look away from the
// screen, eri speaks the reply aloud so you can keep working hands/eyes-free.
//
// This is eri's edge over text-only CLIs. It wires two pieces that already
// exist but weren't connected: the gaze service's "leave" attention event and
// the chat reply text. The voice is eri_prod_voice (the TTS sidecar's default).

import * as vscode from "vscode";

import type { AttentionEvent, GazeService } from "../gaze/gazeService";
import { speak } from "./ttsClient";

// Only speak a reply that's still fresh -- if you looked away minutes after the
// answer, don't suddenly narrate stale text.
const FRESH_WINDOW_MS = 90_000;

export class GazeNarration implements vscode.Disposable {
  private lastReply = "";
  private replyAt = 0;
  private spokenForCurrentReply = true;
  private readonly sub: vscode.Disposable;

  constructor(
    service: GazeService,
    private readonly voice?: string,
  ) {
    this.sub = service.onAttention((event) => this.onAttention(event));
  }

  /** Record the latest chat reply; arms talk-back for the next look-away. */
  setReply(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.lastReply = trimmed;
    this.replyAt = Date.now();
    this.spokenForCurrentReply = false;
  }

  private onAttention(event: AttentionEvent): void {
    if (event.kind !== "leave") return;
    if (this.spokenForCurrentReply) return;
    if (!this.enabled()) return;
    if (Date.now() - this.replyAt > FRESH_WINDOW_MS) return;
    // Speak once per reply, on the first look-away after it arrived.
    this.spokenForCurrentReply = true;
    void speak(this.lastReply, this.voice);
  }

  private enabled(): boolean {
    return vscode.workspace
      .getConfiguration("eri")
      .get<boolean>("voice.talkBackOnLookAway", true);
  }

  dispose(): void {
    this.sub.dispose();
  }
}
