/**
 * vision — a bounded, single-shot Anthropic vision turn for phone eri (ADR-0002).
 *
 * When a user texts eri a *photo* over iMessage (Sendblue delivers a `media_url`),
 * we can't run it through `run_core`'s text-only turn — the model needs the image
 * as an `image` content block. This is the minimal vision analogue: build the
 * image-from-URL + text content blocks (pure, unit-tested) and do one Anthropic
 * Messages call (the same thin fetch shape as run_core's `callAnthropic`).
 *
 * Source for the image-by-URL block shape: Anthropic Messages API docs (via
 * Context7, /websites/platform_claude_en_api) — the URL image source is
 * `{ type: "image", source: { type: "url", url } }` on the standard (non-beta)
 * Messages endpoint. Verified 2026-06-16.
 */

import { getMasterKey } from "@/lib/inference/providers";

/** Sonnet is the vision default — Haiku is materially weaker at reading images,
 *  so a texted photo (receipts, screenshots, whiteboards) wants the stronger
 *  model even though plain chat replies use Haiku (see run_core PHONE_REPLY_MODEL). */
export const VISION_MODEL = "claude-sonnet-4-6";

/** Vision replies stay text-message short; bound the turn so it fits the budget. */
const DEFAULT_VISION_MAX_TOKENS = 1024;

/** An Anthropic image content block sourced from a URL. */
export interface ImageUrlBlock {
  type: "image";
  source: { type: "url"; url: string };
}

/** An Anthropic text content block. */
export interface TextBlock {
  type: "text";
  text: string;
}

export type VisionContentBlock = ImageUrlBlock | TextBlock;

/**
 * Build the Anthropic message content blocks for an image-from-URL plus the
 * user's text. Image first so the model has it in view when it reads the prompt.
 * Pure — unit-tested. A blank prompt yields a sensible default ask so the model
 * always has an instruction (a photo with no caption still gets described).
 */
export function buildImageContent(imageUrl: string, prompt: string): VisionContentBlock[] {
  const text = prompt.trim() || "What's in this image?";
  return [
    { type: "image", source: { type: "url", url: imageUrl } },
    { type: "text", text },
  ];
}

export interface VisionTurnInput {
  imageUrl: string;
  prompt: string;
  system: string;
  /** Defaults to VISION_MODEL (Sonnet). Override only with a vision-capable model. */
  model?: string;
  maxTokens?: number;
}

export interface VisionTurnResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}
interface AnthropicMessagesResponse {
  content?: ContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Concatenate + trim the model's text blocks into the reply. */
function extractText(content: ContentBlock[] | undefined): string {
  return (content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("")
    .trim();
}

/**
 * Run one Anthropic Messages call over an image (by URL) + the user's text and
 * return the final reply. Single-shot (no tools/loop) — vision turns describe or
 * answer about the photo; heavier follow-up still goes through the normal text
 * path. Throws on an upstream error (the caller turns it into a friendly reply).
 */
export async function runVisionTurn(input: VisionTurnInput): Promise<VisionTurnResult> {
  const model = input.model ?? VISION_MODEL;
  const body = await callAnthropicVision({
    model,
    maxTokens: input.maxTokens ?? DEFAULT_VISION_MAX_TOKENS,
    system: input.system,
    content: buildImageContent(input.imageUrl, input.prompt),
  });
  return {
    text: extractText(body.content) || "(eri couldn't read that image)",
    tokensIn: body.usage?.input_tokens ?? 0,
    tokensOut: body.usage?.output_tokens ?? 0,
    model,
  };
}

async function callAnthropicVision(args: {
  model: string;
  maxTokens: number;
  system: string;
  content: VisionContentBlock[];
}): Promise<AnthropicMessagesResponse> {
  const payload = {
    model: args.model,
    max_tokens: args.maxTokens,
    // Cache the system+profile block — identical across a user's texts (mirrors
    // run_core's caching). The image block itself isn't cached (it varies).
    system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: args.content }],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": getMasterKey("anthropic"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`anthropic ${response.status}: ${txt.slice(0, 200)}`);
  }
  return (await response.json()) as AnthropicMessagesResponse;
}
