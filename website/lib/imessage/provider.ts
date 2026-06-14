/**
 * Sendblue send abstraction (ADR-0002).
 *
 * Behind this seam so Sendblue / SMS / RCS are swappable later (Phase 2). Sends
 * use the `sb-api-key-id` + `sb-api-secret-key` headers to Sendblue's
 * send-message endpoint with `{ from_number, number, content }`. Credentials and
 * the eri number come from the environment — never hardcoded.
 */

const SEND_URL = "https://api.sendblue.co/api/send-message";

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

/** Send an ordered set of reply chunks (from `formatReply`), best-effort. */
export async function sendReply(to: string, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    if (chunk.trim()) await sendMessage(to, chunk);
  }
}
