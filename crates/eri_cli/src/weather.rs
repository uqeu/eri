//! `get_weather` tool — real-time weather via Open-Meteo (keyless, free). Gives
//! the desktop brain the same weather capability phone eri has.
//!
//! This is a self-contained fetch (no API key, no secrets). The full one-brain
//! plan (P3 — one tool registry) will consolidate weather behind a single shared
//! endpoint both surfaces call; until then the desktop has it natively here.

use anyhow::{Result, anyhow};
use serde_json::Value;

/// Look up a place, then its current conditions + today's high/low. Returns a
/// short human line. Async (reqwest) — safe to call directly from the loop.
pub(crate) async fn get_weather(location: &str) -> Result<String> {
    let loc = location.trim();
    if loc.is_empty() {
        return Err(anyhow!("get_weather needs a `location`"));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent(concat!("eri-cli/", env!("CARGO_PKG_VERSION")))
        .build()?;

    // 1) Geocode the place name → lat/lon (keyless).
    let geo: Value = client
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", loc), ("count", "1")])
        .send()
        .await?
        .json()
        .await?;
    let place = geo
        .get("results")
        .and_then(|r| r.get(0))
        .ok_or_else(|| anyhow!("couldn't find a place called {loc:?}"))?;
    let lat = place
        .get("latitude")
        .and_then(Value::as_f64)
        .ok_or_else(|| anyhow!("geocode missing latitude"))?;
    let lon = place
        .get("longitude")
        .and_then(Value::as_f64)
        .ok_or_else(|| anyhow!("geocode missing longitude"))?;
    let name = place.get("name").and_then(Value::as_str).unwrap_or(loc);
    let admin = place.get("admin1").and_then(Value::as_str).unwrap_or("");
    let country = place.get("country").and_then(Value::as_str).unwrap_or("");

    // 2) Current conditions + today's range.
    let fc: Value = client
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", lat.to_string().as_str()),
            ("longitude", lon.to_string().as_str()),
            (
                "current",
                "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
            ),
            ("daily", "temperature_2m_max,temperature_2m_min"),
            ("timezone", "auto"),
            ("forecast_days", "1"),
        ])
        .send()
        .await?
        .json()
        .await?;
    let cur = fc
        .get("current")
        .ok_or_else(|| anyhow!("forecast missing current conditions"))?;
    let temp = cur.get("temperature_2m").and_then(Value::as_f64).unwrap_or(0.0);
    let feels = cur
        .get("apparent_temperature")
        .and_then(Value::as_f64)
        .unwrap_or(temp);
    let wind = cur.get("wind_speed_10m").and_then(Value::as_f64).unwrap_or(0.0);
    let code = cur.get("weather_code").and_then(Value::as_i64).unwrap_or(-1);
    let units = fc
        .pointer("/current_units/temperature_2m")
        .and_then(Value::as_str)
        .unwrap_or("°C");
    let hi = fc.pointer("/daily/temperature_2m_max/0").and_then(Value::as_f64);
    let lo = fc.pointer("/daily/temperature_2m_min/0").and_then(Value::as_f64);

    let place_str = [name, admin, country]
        .iter()
        .filter(|s| !s.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(", ");
    let mut out = format!(
        "{place_str}: {desc}, {temp:.0}{units} (feels {feels:.0}{units}), wind {wind:.0} km/h",
        desc = wmo_desc(code),
    );
    if let (Some(hi), Some(lo)) = (hi, lo) {
        out.push_str(&format!(", today {lo:.0}–{hi:.0}{units}"));
    }
    Ok(out)
}

/// Map a WMO weather code to a short human word.
fn wmo_desc(code: i64) -> &'static str {
    match code {
        0 => "clear",
        1 | 2 => "partly cloudy",
        3 => "overcast",
        45 | 48 => "foggy",
        51 | 53 | 55 | 56 | 57 => "drizzle",
        61 | 63 | 65 => "rain",
        66 | 67 => "freezing rain",
        71 | 73 | 75 | 77 => "snow",
        80..=82 => "rain showers",
        85 | 86 => "snow showers",
        95 => "thunderstorm",
        96 | 99 => "thunderstorm with hail",
        _ => "unsettled",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wmo_codes_map_to_human_words() {
        assert_eq!(wmo_desc(0), "clear");
        assert_eq!(wmo_desc(3), "overcast");
        assert_eq!(wmo_desc(65), "rain");
        assert_eq!(wmo_desc(95), "thunderstorm");
        assert_eq!(wmo_desc(12345), "unsettled");
    }
}
