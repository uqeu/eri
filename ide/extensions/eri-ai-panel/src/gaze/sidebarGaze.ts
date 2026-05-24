import * as vscode from "vscode";

import { AttentionEvent, GazeService } from "./gazeService";

const CONTEXT_KEY = "eri.gaze.attendingSidebar";

/// Sets a VSCode context key when the user dwells on the sidebar long
/// enough to fire an AttentionEvent. UI surfaces (view-welcome, tree
/// item descriptions) can use the context key for subtle highlighting.
/// Never auto-clicks anything.
export class SidebarGaze implements vscode.Disposable {
  private readonly subs: vscode.Disposable[] = [];
  private active = false;

  constructor(private readonly service: GazeService) {
    this.subs.push(this.service.onAttention((event) => this.handle(event)));
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("eri.gaze")
      .get<boolean>("sidebarAttention", true);
  }

  private handle(event: AttentionEvent): void {
    if (!this.isEnabled() && this.active) {
      this.setActive(false);
      return;
    }
    if (event.region !== "sidebar") {
      if (event.kind === "leave" && this.active) {
        this.setActive(false);
      }
      return;
    }
    if (event.kind === "enter") {
      this.setActive(true);
    } else {
      this.setActive(false);
    }
  }

  private setActive(active: boolean): void {
    if (this.active === active) {
      return;
    }
    this.active = active;
    void vscode.commands.executeCommand("setContext", CONTEXT_KEY, active);
  }

  dispose(): void {
    if (this.active) {
      void vscode.commands.executeCommand("setContext", CONTEXT_KEY, false);
    }
    for (const sub of this.subs) {
      sub.dispose();
    }
    this.subs.length = 0;
  }
}
