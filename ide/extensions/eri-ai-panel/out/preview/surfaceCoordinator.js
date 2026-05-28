"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPreviewSurfaceCoordinator = createPreviewSurfaceCoordinator;
const layoutState_1 = require("../layout/layoutState");
const embeddedPreview_1 = require("./embeddedPreview");
/**
 * Routes preview lifecycle (open / reload / gaze) to whichever surface
 * the current layout state resolves to. Flipping modes closes one
 * surface and opens the other at the same URL so the user never loses
 * the preview frame.
 */
function createPreviewSurfaceCoordinator(context, swiftPreview, layout) {
    const embedded = (0, embeddedPreview_1.createEmbeddedPreview)(context);
    let lastUrl = null;
    let lastResolved = (0, layoutState_1.resolvePreviewSurface)(layout.current());
    // When the user toggles mode (or explicitly changes preview surface),
    // swap surfaces with the last known URL so the preview stays put.
    const sub = layout.onChange(async (next) => {
        const resolved = (0, layoutState_1.resolvePreviewSurface)(next);
        if (resolved === lastResolved)
            return;
        lastResolved = resolved;
        if (!lastUrl)
            return;
        if (resolved === "webview") {
            try {
                await swiftPreview.client.close();
            }
            catch {
                /* best-effort */
            }
            await embedded.open({ url: lastUrl, themeSlug: next.themeSlug });
        }
        else {
            embedded.close();
            swiftPreview.fireShouldOpen(lastUrl);
        }
    });
    context.subscriptions.push(sub);
    context.subscriptions.push({ dispose: () => embedded.dispose() });
    return {
        async open(url) {
            lastUrl = url;
            const state = layout.current();
            const resolved = (0, layoutState_1.resolvePreviewSurface)(state);
            lastResolved = resolved;
            if (resolved === "webview") {
                await embedded.open({ url, themeSlug: state.themeSlug });
            }
            else {
                swiftPreview.fireShouldOpen(url);
            }
        },
        reload() {
            if (lastResolved === "webview") {
                embedded.reload();
            }
            else {
                void swiftPreview.client.reload().catch(() => undefined);
            }
        },
        relayGaze(x, y) {
            if (lastResolved === "webview") {
                embedded.relayGaze(x, y);
            }
            else {
                swiftPreview.client.relayGaze(x, y);
            }
        },
        active() {
            return lastResolved;
        },
        dispose() {
            sub.dispose();
            embedded.dispose();
        },
    };
}
//# sourceMappingURL=surfaceCoordinator.js.map