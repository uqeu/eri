import * as vscode from "vscode";
import {
  ChatPosition,
  DEFAULT_LAYOUT_STATE,
  LayoutMode,
  LayoutState,
  normalizeLayout,
} from "./layoutState";

const CONFIG_SECTION = "eri.layout";

type Listener = (state: LayoutState) => void;

export class LayoutManager {
  private cached: LayoutState;
  private readonly listeners: Set<Listener> = new Set();
  private readonly disposable: vscode.Disposable;

  constructor() {
    this.cached = this.readFromConfig();
    this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        const next = this.readFromConfig();
        if (!sameLayout(next, this.cached)) {
          this.cached = next;
          this.notify();
        }
      }
    });
  }

  current(): LayoutState {
    return this.cached;
  }

  async setMode(mode: LayoutMode): Promise<void> {
    await this.writeConfig("mode", mode);
  }

  async setChatPosition(position: ChatPosition): Promise<void> {
    await this.writeConfig("chatPosition", position);
  }

  async setExplorerHidden(hidden: boolean): Promise<void> {
    await this.writeConfig("explorerHiddenInEriMode", hidden);
  }

  async setPreviewSurface(surface: LayoutState["previewSurface"]): Promise<void> {
    await this.writeConfig("previewSurface", surface);
  }

  async setThemeSlug(slug: string): Promise<void> {
    await this.writeConfig("themeSlug", slug);
  }

  onChange(listener: Listener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  dispose(): void {
    this.disposable.dispose();
    this.listeners.clear();
  }

  private readFromConfig(): LayoutState {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return normalizeLayout({
      mode: cfg.get("mode", DEFAULT_LAYOUT_STATE.mode),
      chatPosition: cfg.get("chatPosition", DEFAULT_LAYOUT_STATE.chatPosition),
      explorerHiddenInEriMode: cfg.get(
        "explorerHiddenInEriMode",
        DEFAULT_LAYOUT_STATE.explorerHiddenInEriMode,
      ),
      previewSurface: cfg.get("previewSurface", DEFAULT_LAYOUT_STATE.previewSurface),
      themeSlug: cfg.get("themeSlug", DEFAULT_LAYOUT_STATE.themeSlug),
    });
  }

  private async writeConfig(key: string, value: unknown): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const target = workspaceTarget();
    await cfg.update(key, value, target);
    // onDidChangeConfiguration fires asynchronously — refresh cache eagerly
    // so callers reading `current()` right after a setter see the new value.
    this.cached = this.readFromConfig();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.cached);
      } catch (err) {
        console.error("LayoutManager listener threw:", err);
      }
    }
  }
}

function sameLayout(a: LayoutState, b: LayoutState): boolean {
  return (
    a.mode === b.mode &&
    a.chatPosition === b.chatPosition &&
    a.explorerHiddenInEriMode === b.explorerHiddenInEriMode &&
    a.previewSurface === b.previewSurface &&
    a.themeSlug === b.themeSlug
  );
}

function workspaceTarget(): vscode.ConfigurationTarget {
  // Prefer workspace settings when one is open so .vscode/settings.json
  // captures the layout choice for the project; fall back to global so
  // first-launch (no workspace) still persists.
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

/**
 * Apply the side-effects of a mode change: explorer visibility, layout
 * orientation, and which preview surface coordinator should drive. We
 * issue the workbench commands here so `setMode()` callers don't have
 * to repeat the boilerplate. Errors are swallowed (worst case the user
 * runs the workbench command themselves).
 */
export async function applyModeSideEffects(state: LayoutState): Promise<void> {
  try {
    if (state.mode === "eri" && state.explorerHiddenInEriMode) {
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
    } else if (state.mode === "coder") {
      // Show the activity bar + sidebar back so the user lands on their
      // explorer (or whichever view they had open before flipping).
      await vscode.commands.executeCommand(
        "workbench.action.focusActiveEditorGroup",
      );
    }
  } catch {
    /* best-effort */
  }
}
