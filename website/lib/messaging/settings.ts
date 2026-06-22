/**
 * Per-user settings (eri Everywhere). eri reads these at reply time (voice mode,
 * proactive-location opt-in); the eri-authored Settings mini-app writes them via
 * `setUserSettings`. Server-owned table (RLS-locked). Reads never throw — a
 * missing row or DB hiccup falls back to safe defaults (text replies, no nudges).
 */

import { sql } from "@/lib/db";
import type { VoiceMode } from "@/lib/messaging/voice";

export interface UserSettings {
  voiceMode: VoiceMode;
  locationNudges: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = { voiceMode: "never", locationNudges: false };

function normalizeVoiceMode(s: unknown): VoiceMode {
  return s === "auto" || s === "always" ? s : "never";
}

/** A user's settings, or safe defaults when unset/unavailable. Never throws. */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  try {
    const rows = await sql()<{ voice_mode: string; location_nudges: boolean }[]>`
      SELECT voice_mode, location_nudges FROM user_settings WHERE user_id = ${userId}
    `;
    const r = rows[0];
    if (!r) return DEFAULT_SETTINGS;
    return { voiceMode: normalizeVoiceMode(r.voice_mode), locationNudges: r.location_nudges === true };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Upsert a partial patch of a user's settings (used by the Settings mini-app).
 *  Only the provided fields change; the rest keep their stored value. */
export async function setUserSettings(userId: string, patch: Partial<UserSettings>): Promise<void> {
  const voiceMode = patch.voiceMode !== undefined ? normalizeVoiceMode(patch.voiceMode) : null;
  const locationNudges = patch.locationNudges ?? null;
  await sql()`
    INSERT INTO user_settings (user_id, voice_mode, location_nudges, updated_at)
    VALUES (${userId}, ${voiceMode ?? DEFAULT_SETTINGS.voiceMode}, ${locationNudges ?? DEFAULT_SETTINGS.locationNudges}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      voice_mode = COALESCE(${voiceMode}, user_settings.voice_mode),
      location_nudges = COALESCE(${locationNudges}, user_settings.location_nudges),
      updated_at = now()
  `;
}
