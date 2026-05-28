import * as vscode from "vscode";
import { LayoutManager } from "../layout/layoutManager";
import { LayoutState, resolvePreviewSurface } from "../layout/layoutState";
import { PreviewHandle } from "./index";
import { createEmbeddedPreview, EmbeddedPreviewHandle } from "./embeddedPreview";

export interface PreviewSurfaceCoordinator {
  open(url: string): Promise<void>;
  reload(): void;
  relayGaze(x: number, y: number): void;
  active(): "swift" | "webview";
  dispose(): void;
}

/**
 * Routes preview lifecycle (open / reload / gaze) to whichever surface
 * the current layout state resolves to. Flipping modes closes one
 * surface and opens the other at the same URL so the user never loses
 * the preview frame.
 */
export function createPreviewSurfaceCoordinator(
  context: vscode.ExtensionContext,
  swiftPreview: PreviewHandle,
  layout: LayoutManager,
): PreviewSurfaceCoordinator {
  const embedded: EmbeddedPreviewHandle = createEmbeddedPreview(context);
  let lastUrl: string | null = null;
  let lastResolved = resolvePreviewSurface(layout.current());

  // When the user toggles mode (or explicitly changes preview surface),
  // swap surfaces with the last known URL so the preview stays put.
  const sub = layout.onChange(async (next: LayoutState) => {
    const resolved = resolvePreviewSurface(next);
    if (resolved === lastResolved) return;
    lastResolved = resolved;
    if (!lastUrl) return;
    if (resolved === "webview") {
      try {
        await swiftPreview.client.close();
      } catch {
        /* best-effort */
      }
      await embedded.open({ url: lastUrl, themeSlug: next.themeSlug });
    } else {
      embedded.close();
      swiftPreview.fireShouldOpen(lastUrl);
    }
  });

  context.subscriptions.push(sub);
  context.subscriptions.push({ dispose: () => embedded.dispose() });

  return {
    async open(url: string): Promise<void> {
      lastUrl = url;
      const state = layout.current();
      const resolved = resolvePreviewSurface(state);
      lastResolved = resolved;
      if (resolved === "webview") {
        await embedded.open({ url, themeSlug: state.themeSlug });
      } else {
        swiftPreview.fireShouldOpen(url);
      }
    },
    reload(): void {
      if (lastResolved === "webview") {
        embedded.reload();
      } else {
        void swiftPreview.client.reload().catch(() => undefined);
      }
    },
    relayGaze(x: number, y: number): void {
      if (lastResolved === "webview") {
        embedded.relayGaze(x, y);
      } else {
        swiftPreview.client.relayGaze(x, y);
      }
    },
    active(): "swift" | "webview" {
      return lastResolved;
    },
    dispose(): void {
      sub.dispose();
      embedded.dispose();
    },
  };
}
