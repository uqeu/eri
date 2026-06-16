/**
 * Sendblue send abstraction (ADR-0002).
 *
 * Behind this seam so Sendblue / SMS / RCS are swappable later (Phase 2). Sends
 * use the `sb-api-key-id` + `sb-api-secret-key` headers to Sendblue's
 * send-message endpoint with `{ from_number, number, content }`. Credentials and
 * the eri number come from the environment — never hardcoded.
 */

const SEND_URL = "https://api.sendblue.co/api/send-message";
const TYPING_URL = "https://api.sendblue.co/api/send-typing-indicator";

export interface SendResult {
  ok: boolean;
  status: number;
}

/** Send one message to `to` (E.164). Throws if Sendblue env isn't configured. */
export async function sendMessage(to: string, content: string): Promise<SendResult> {
  const keyId = process.env.SENDBLUE_API_KEY_ID;
  const secret = process.env.SENDBLUE_API_SECRET;
  const from = process.env.SENDBLUE_FROM_NUMBER;
  if (!keyId || !secret || !from) {
    throw new Error("Sendblue not configured (SENDBLUE_API_KEY_ID/SECRET/FROM_NUMBER)");
  }
  const response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "sb-api-key-id": keyId,
      "sb-api-secret-key": secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from_number: from, number: to, content }),
  });
  return { ok: response.ok, status: response.status };
}

/**
 * Show the "eri is typing…" bubble on the user's phone while we compose the
 * reply, so the wait reads as intentional rather than broken. Best-effort: never
 * throws and swallows any error — a missing typing bubble must never block or
 * fail the actual reply. No-op (returns false) when Sendblue isn't configured.
 */
export async function sendTypingIndicator(to: string): Promise<boolean> {
  const keyId = process.env.SENDBLUE_API_KEY_ID;
  const secret = process.env.SENDBLUE_API_SECRET;
  if (!keyId || !secret) return false;
  try {
    const response = await fetch(TYPING_URL, {
      method: "POST",
      headers: {
        "sb-api-key-id": keyId,
        "sb-api-secret-key": secret,
        "content-type": "application/json",
      },
      body: JSON.stringify({ number: to }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Send an ordered set of reply chunks (from `formatReply`). Returns true only if
 * EVERY chunk was accepted by Sendblue — a dropped chunk (4xx/5xx, returned not
 * thrown) must be visible to the caller so it can avoid completing the dedup
 * lease and let the retry re-send (Phase 1 review H4). Stops at the first failure
 * so the user never gets a later chunk without an earlier one.
 */
export async function sendReply(to: string, chunks: string[]): Promise<boolean> {
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const result = await sendMessage(to, chunk);
    if (!result.ok) return false;
  }
  return true;
}
