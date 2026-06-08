import { z } from "zod";

/**
 * Zod schemas for the money/auth request boundary. `.strict()` rejects unknown
 * keys (defends against mass-assignment), and the field rules enforce shape +
 * bounds before any DB/business logic runs. Use `parse<T>(schema, body)` which
 * returns `{ ok, data }` or `{ ok: false, error }` — never throws.
 */

export const signupSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(256),
    display_name: z.string().max(120).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

export const turnRecordSchema = z
  .object({
    kind: z.enum(["voice", "cmdk", "composer"]),
    // Accepted for back-compat but ignored server-side (we don't trust client
    // billing numbers — see /turns/record). Still bounded so junk is rejected.
    input_tokens: z.number().int().min(0).max(10_000_000).nullable().optional(),
    output_tokens: z.number().int().min(0).max(10_000_000).nullable().optional(),
    cost_cents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type TurnRecordInput = z.infer<typeof turnRecordSchema>;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Validate `body` against `schema`. Returns a tagged result; never throws. */
export function parse<T>(schema: z.ZodType<T>, body: unknown): ParseResult<T> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first?.path.join(".");
  const msg = first ? `${path ? `${path}: ` : ""}${first.message}` : "invalid request";
  return { ok: false, error: msg };
}
