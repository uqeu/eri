import * as vscode from "vscode";

import { AttentionEvent, GazeService } from "./gazeService";

const REFOCUS_COOLDOWN_MS = 5000;

/// When the user dwells on the bottom panel region long enough to fire
/// an AttentionEvent, focus the eri chat composer. Heavy cooldown so we
/// don't thrash if the user is just glancing.
export class ChatFocus implements vscode.Disposable {
  private readonly subs: vscode.Disposable[] = [];
  private lastFocusAt = 0;

  constructor(private readonly service: GazeService) {
    this.subs.push(this.service.onAttention((event) => this.handle(event)));
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("eri.gaze")
      .get<boolean>("chatAutoFocus", true);
  }

  private handle(event: AttentionEvent): void {
    if (!this.isEnabled()) {
      return;
    }
    if (event.kind !== "enter" || event.region !== "panel") {
      return;
    }
    const now = Date.now();
    if (now - this.lastFocusAt < REFOCUS_COOLDOWN_MS) {
      return;
    }
    this.lastFocusAt = now;
    void vscode.commands.executeCommand("eri.panel.focus");
  }

  dispose(): void {
    for (const sub of this.subs) {
      sub.dispose();
    }
    this.subs.length = 0;
  }
}
