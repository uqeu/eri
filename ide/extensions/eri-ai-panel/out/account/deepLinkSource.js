"use strict";
// Bridges vscode.window.registerUriHandler events into a promise-based
// "give me the next code" API consumable by DeviceCodeFlow. Multiple flows
// over the lifetime of the extension reuse the same queue.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeepLinkSource = createDeepLinkSource;
function createDeepLinkSource() {
    const pending = [];
    const buffered = [];
    let disposed = false;
    return {
        next() {
            if (disposed)
                return Promise.resolve(null);
            const buf = buffered.shift();
            if (buf !== undefined)
                return Promise.resolve(buf);
            return new Promise((resolve) => {
                pending.push(resolve);
            });
        },
        push(code) {
            if (disposed)
                return;
            const waiter = pending.shift();
            if (waiter) {
                waiter(code);
                return;
            }
            buffered.push(code);
        },
        dispose() {
            disposed = true;
            while (pending.length > 0) {
                const w = pending.shift();
                if (w)
                    w(null);
            }
        },
    };
}
//# sourceMappingURL=deepLinkSource.js.map