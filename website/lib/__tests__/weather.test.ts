import { strict as assert } from "node:assert";
import {
  describeWeatherCode,
  formatWeather,
  getWeather,
  isPrecip,
  parseCurrent,
  parseGeocode,
  WEATHER_TOOL,
} from "../agent/weather";

// WMO code → condition + precip.
{
  assert.equal(describeWeatherCode(0), "clear");
  assert.equal(describeWeatherCode(3), "cloudy");
  assert.equal(describeWeatherCode(63), "rain");
  assert.equal(describeWeatherCode(95), "thunderstorms");
  assert.equal(isPrecip(0), false);
  assert.equal(isPrecip(63), true);
}

// Geocode parse → first result; bad shape → undefined.
{
  const g = parseGeocode({ results: [{ name: "Toronto", admin1: "Ontario", latitude: 43.7, longitude: -79.4 }] });
  assert.equal(g?.name, "Toronto, Ontario");
  assert.equal(g?.lat, 43.7);
  assert.equal(parseGeocode({ results: [] }), undefined);
  assert.equal(parseGeocode({}), undefined);
}

// Current parse → fields; missing → undefined.
{
  const c = parseCurrent({ current: { temperature_2m: 19.2, apparent_temperature: 18, weather_code: 61 } }, "Toronto");
  assert.equal(c?.tempC, 19.2);
  assert.equal(c?.condition, "rain");
  assert.equal(c?.isPrecipitating, true);
  assert.equal(parseCurrent({ current: {} }, "X"), undefined);
}

// formatWeather: shows live temp in C + F; failure → the reason.
{
  const s = formatWeather({ ok: true, weather: { place: "Toronto", tempC: 19, feelsLikeC: 18, condition: "rain", isPrecipitating: true } });
  assert.ok(s.includes("Toronto"));
  assert.ok(s.includes("19°C"));
  assert.ok(/°F/.test(s));
  assert.ok(s.toLowerCase().includes("right now"));
  assert.equal(formatWeather({ ok: false, reason: "nope" }), "nope");
}

// Tool reads naturally + steers off web search.
{
  assert.equal(WEATHER_TOOL.name, "get_weather");
  assert.ok(/real-time|current/i.test(WEATHER_TOOL.description));
}

// getWeather: geocode then forecast via the injected fetcher; never throws.
async function run() {
  const deps = {
    fetchJson: async (url: string) => {
      if (url.includes("geocoding")) return { results: [{ name: "Toronto", latitude: 43.7, longitude: -79.4 }] };
      return { current: { temperature_2m: 19, apparent_temperature: 19, weather_code: 61 } };
    },
  };
  const ok = await getWeather("Toronto", deps);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.weather.tempC, 19);

  const bad = await getWeather("Toronto", { fetchJson: async () => { throw new Error("down"); } });
  assert.equal(bad.ok, false);

  const blank = await getWeather("  ", { fetchJson: async () => { throw new Error("should not run"); } });
  assert.equal(blank.ok, false);

  // eslint-disable-next-line no-console
  console.log("weather.test.ts: all assertions passed");
}

run();
