/**
 * Real-time weather for phone eri — a DEDICATED source, not web-search snippets.
 *
 * Asking the generic web_search for weather gave eri stale cached snippets ("1am,
 * 15°C") which it then reported as "now". Weather is a high-value, time-sensitive
 * ask, so it gets its own tool backed by Open-Meteo — FREE, no API key, genuinely
 * real-time. Two cheap calls: geocode the city → fetch current conditions.
 *
 * Backend-agnostic behind a `WeatherDeps` seam (so it's testable without network).
 * Pure mappers + formatter are unit-tested. Never throws — a bad city / failure
 * collapses to `{ ok: false, reason }`, so eri says it couldn't get the weather
 * instead of crashing or fabricating.
 */

import type { ToolDef } from "./run_core";

/** Current conditions, narrowed to what eri needs to answer naturally. */
export interface CurrentWeather {
  place: string;
  tempC: number;
  feelsLikeC: number;
  condition: string;
  isPrecipitating: boolean;
}

export type WeatherResult = { ok: true; weather: CurrentWeather } | { ok: false; reason: string };

/** The IO the reader needs — injected so it's testable with stubs. `fetchJson`
 *  throws on a non-OK response (getWeather catches). */
export interface WeatherDeps {
  fetchJson(url: string): Promise<unknown>;
}

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// ---- pure guards -----------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Map a WMO weather code to a plain-English condition. Pure. */
export function describeWeatherCode(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "mostly clear";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain showers";
  if (code >= 85 && code <= 86) return "snow showers";
  if (code >= 95) return "thunderstorms";
  return "unsettled";
}

/** Whether a WMO code means active precipitation. Pure. */
export function isPrecip(code: number): boolean {
  return (code >= 51 && code <= 86) || code >= 95;
}

/** Parse Open-Meteo geocoding → the first {name, lat, lon}, or undefined. Pure. */
export function parseGeocode(raw: unknown): { name: string; lat: number; lon: number } | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.results) || raw.results.length === 0) return undefined;
  const r = raw.results[0];
  if (!isRecord(r)) return undefined;
  const lat = num(r.latitude);
  const lon = num(r.longitude);
  const name = typeof r.name === "string" ? r.name : undefined;
  if (lat === undefined || lon === undefined || !name) return undefined;
  const admin = typeof r.admin1 === "string" ? `, ${r.admin1}` : "";
  return { name: `${name}${admin}`, lat, lon };
}

/** Parse Open-Meteo forecast `current` block → CurrentWeather fields. Pure. */
export function parseCurrent(raw: unknown, place: string): CurrentWeather | undefined {
  if (!isRecord(raw) || !isRecord(raw.current)) return undefined;
  const c = raw.current;
  const tempC = num(c.temperature_2m);
  const code = num(c.weather_code);
  if (tempC === undefined || code === undefined) return undefined;
  const feels = num(c.apparent_temperature) ?? tempC;
  return {
    place,
    tempC: Math.round(tempC * 10) / 10,
    feelsLikeC: Math.round(feels),
    condition: describeWeatherCode(code),
    isPrecipitating: isPrecip(code),
  };
}

/** Render the weather as compact text fed back to the model. Pure. */
export function formatWeather(result: WeatherResult): string {
  if (!result.ok) return result.reason;
  const w = result.weather;
  const f = Math.round((w.tempC * 9) / 5 + 32);
  const feels =
    Math.abs(w.feelsLikeC - w.tempC) >= 2 ? ` (feels like ${w.feelsLikeC}°C)` : "";
  return `Current weather in ${w.place}: ${w.condition}, ${w.tempC}°C${feels} / ${f}°F. This is live, right now.`;
}

/**
 * Get current weather for a city. Never throws — bad city / failure → {ok:false}.
 */
export async function getWeather(city: string, deps: WeatherDeps): Promise<WeatherResult> {
  const q = city.trim();
  if (!q) return { ok: false, reason: "I need a city to check the weather for." };
  try {
    const geo = parseGeocode(
      await deps.fetchJson(`${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=1`),
    );
    if (!geo) return { ok: false, reason: `I couldn't find a place called "${q}".` };
    const forecast = await deps.fetchJson(
      `${FORECAST_URL}?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,apparent_temperature,weather_code`,
    );
    const weather = parseCurrent(forecast, geo.name);
    if (!weather) return { ok: false, reason: "I couldn't read the current conditions just now." };
    return { ok: true, weather };
  } catch {
    return { ok: false, reason: "I couldn't get the weather just now." };
  }
}

/** eri's weather tool. Resolves in-cloud this turn (real-time, not search snippets). */
export const WEATHER_TOOL: ToolDef = {
  name: "get_weather",
  description:
    "Get the CURRENT, real-time weather for a city — always use this for any weather question instead of web search (search gives stale data). Pass the city; if you already know where the user is, use that. You get live conditions back this turn.",
  input_schema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City to check, e.g. \"Toronto\"." },
    },
    required: ["city"],
  },
};
