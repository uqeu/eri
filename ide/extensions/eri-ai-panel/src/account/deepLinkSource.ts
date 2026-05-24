// Bridges vscode.window.registerUriHandler events into a promise-based
// "give me the next code" API consumable by DeviceCodeFlow. Multiple flows
// over the lifetime of the extension reuse the same queue.

export interface DeepLinkSource {
  /**
   * Resolves with the next received `code`, or `null` if cancelled/disposed.
   * The returned promise never throws.
   */
  next(): Promise<string | null>;
  push(code: string): void;
  dispose(): void;
}

export function createDeepLinkSource(): DeepLinkSource {
  const pending: Array<(code: string | null) => void> = [];
  const buffered: string[] = [];
  let disposed = false;

  return {
    next(): Promise<string | null> {
      if (disposed) return Promise.resolve(null);
      const buf = buffered.shift();
      if (buf !== undefined) return Promise.resolve(buf);
      return new Promise<string | null>((resolve) => {
        pending.push(resolve);
      });
    },
    push(code: string): void {
      if (disposed) return;
      const waiter = pending.shift();
      if (waiter) {
        waiter(code);
        return;
      }
      buffered.push(code);
    },
    dispose(): void {
      disposed = true;
      while (pending.length > 0) {
        const w = pending.shift();
        if (w) w(null);
      }
    },
  };
}
