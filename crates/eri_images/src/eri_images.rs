//! Image generation via Replicate's Flux models.
//!
//! This crate is the "lorem ipsum imagery" fix for eri: every Mercury build
//! ships with curated `https://images.unsplash.com/...` placeholders, but the
//! moment you put two real builds next to each other the same stock photos
//! repeat. Once the user voice-triggers an image command (handled in
//! `eri_ui::handle_generate_hero_image` / `handle_regenerate_images`), this
//! crate hits Replicate's prediction API and returns either the hosted URL or
//! the raw PNG bytes so the panel can splice it into the live `index.html`
//! through Mercury Edit 2.
//!
//! Wire shape (Replicate REST API):
//!   1. `POST /v1/predictions` with `{version, input: {prompt, aspect_ratio}}`
//!      and `Authorization: Bearer <REPLICATE_API_TOKEN>`.
//!   2. The response carries `urls.get` — a per-prediction polling endpoint.
//!   3. Poll `GET <urls.get>` once per second until `status == "succeeded"`
//!      (giving up after 60s). On success, `output` is either an array of URLs
//!      or a single URL string depending on the model; flux-schnell returns an
//!      array, flux-dev returns a string. We normalize to a single URL.
//!   4. For [`generate_image`], we then download that URL into a `Vec<u8>`.

use std::{env, io::Read, thread, time::Duration};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const REPLICATE_PREDICTIONS_URL: &str = "https://api.replicate.com/v1/predictions";
const DEFAULT_MODEL: &str = "black-forest-labs/flux-schnell";
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const POLL_TIMEOUT: Duration = Duration::from_secs(60);

/// Static configuration for a single image-generation request. Cheap to clone
/// and reusable across many `generate_*` calls — the underlying `ureq::Agent`
/// is constructed lazily inside each call so the config struct itself stays
/// `Send + Sync` without any locking.
#[derive(Clone, Debug)]
pub struct ImageGenConfig {
    pub api_key: String,
    /// Replicate model slug. Examples: `black-forest-labs/flux-schnell`
    /// (fastest, ~1s end-to-end), `black-forest-labs/flux-dev` (higher
    /// quality, ~5-10s).
    pub model: String,
    pub aspect: AspectRatio,
}

impl ImageGenConfig {
    /// Load configuration from environment.
    ///
    /// Returns `None` only when `REPLICATE_API_TOKEN` is missing or empty —
    /// the model and aspect ratio fall back to sensible defaults.
    pub fn from_env() -> Option<Self> {
        let api_key = env::var("REPLICATE_API_TOKEN")
            .ok()
            .filter(|key| !key.trim().is_empty())?;
        let model = env::var("ERI_IMAGE_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
        let aspect = env::var("ERI_IMAGE_ASPECT")
            .ok()
            .and_then(|raw| AspectRatio::parse(&raw))
            .unwrap_or(AspectRatio::Wide16x9);
        Some(Self {
            api_key,
            model,
            aspect,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AspectRatio {
    Wide16x9,
    Square,
    Portrait4x5,
}

impl AspectRatio {
    /// Replicate's `aspect_ratio` input value. Flux's published schema accepts
    /// `"16:9"`, `"1:1"`, `"4:5"`, etc.
    pub fn as_str(self) -> &'static str {
        match self {
            AspectRatio::Wide16x9 => "16:9",
            AspectRatio::Square => "1:1",
            AspectRatio::Portrait4x5 => "4:5",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "16:9" | "wide" | "landscape" => Some(AspectRatio::Wide16x9),
            "1:1" | "square" => Some(AspectRatio::Square),
            "4:5" | "portrait" => Some(AspectRatio::Portrait4x5),
            _ => None,
        }
    }
}

#[derive(Debug, Error)]
pub enum ImageError {
    #[error(
        "Image generation needs REPLICATE_API_TOKEN — get one at https://replicate.com/account/api-tokens"
    )]
    ApiKey,
    #[error("transport error: {0}")]
    Transport(#[from] Box<ureq::Error>),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Replicate API failure: {0}")]
    ApiFailure(String),
}

impl From<ureq::Error> for ImageError {
    fn from(e: ureq::Error) -> Self {
        ImageError::Transport(Box::new(e))
    }
}

/// Generate an image and return the hosted Replicate URL. Cheaper than
/// [`generate_image`] when the caller only needs to splice a `<img src>` —
/// Replicate keeps the URL alive for the rest of the day, which is plenty for
/// a live preview.
pub fn generate_image_url(config: &ImageGenConfig, prompt: &str) -> Result<String, ImageError> {
    if config.api_key.trim().is_empty() {
        return Err(ImageError::ApiKey);
    }
    let agent = build_agent();
    let body = build_request_body(&config.model, prompt, config.aspect)?;
    let initial: PredictionResponse = post_prediction(&agent, &config.api_key, &body)?;
    let final_prediction = poll_until_terminal(&agent, &config.api_key, initial)?;
    extract_first_output_url(&final_prediction)
}

/// Generate an image and download it into memory as raw bytes (typically PNG,
/// though Replicate may also serve WebP — callers that care can sniff the
/// magic bytes).
pub fn generate_image(config: &ImageGenConfig, prompt: &str) -> Result<Vec<u8>, ImageError> {
    let url = generate_image_url(config, prompt)?;
    let agent = build_agent();
    let response = agent.get(&url).call()?;
    let mut bytes: Vec<u8> = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|error| ImageError::ApiFailure(format!("download failed: {error}")))?;
    Ok(bytes)
}

/// Build the JSON request body that gets POSTed to `/v1/predictions`.
/// Extracted so the unit test can assert on its shape without making an actual
/// network call. The model slug is used verbatim — Replicate accepts either a
/// `model` field (for official models registered under a namespace) or a
/// `version` field (for pinned SHAs). We pass `model` since `flux-schnell` /
/// `flux-dev` are both official Black Forest Labs models.
pub fn build_request_body(
    model: &str,
    prompt: &str,
    aspect: AspectRatio,
) -> Result<String, ImageError> {
    let payload = PredictionRequest {
        model,
        input: PredictionInput {
            prompt,
            aspect_ratio: aspect.as_str(),
        },
    };
    Ok(serde_json::to_string(&payload)?)
}

fn build_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
}

fn post_prediction(
    agent: &ureq::Agent,
    api_key: &str,
    body: &str,
) -> Result<PredictionResponse, ImageError> {
    let response = match agent
        .post(REPLICATE_PREDICTIONS_URL)
        .set("authorization", &format!("Bearer {api_key}"))
        .set("content-type", "application/json")
        .send_string(body)
    {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(ImageError::ApiFailure(format!(
                "POST predictions returned {status}: {body}"
            )));
        }
        Err(other) => return Err(ImageError::Transport(Box::new(other))),
    };
    let body = response.into_string().map_err(|error| {
        ImageError::ApiFailure(format!("could not read prediction response: {error}"))
    })?;
    let parsed: PredictionResponse = serde_json::from_str(&body)?;
    Ok(parsed)
}

fn poll_until_terminal(
    agent: &ureq::Agent,
    api_key: &str,
    initial: PredictionResponse,
) -> Result<PredictionResponse, ImageError> {
    if is_terminal(&initial.status) {
        return finalize(initial);
    }
    let Some(poll_url) = initial.urls.as_ref().and_then(|urls| urls.get.clone()) else {
        return Err(ImageError::ApiFailure(
            "Replicate response missing urls.get poll endpoint".into(),
        ));
    };

    let mut elapsed = Duration::from_secs(0);
    loop {
        if elapsed >= POLL_TIMEOUT {
            return Err(ImageError::ApiFailure(format!(
                "prediction timed out after {}s",
                POLL_TIMEOUT.as_secs()
            )));
        }
        thread::sleep(POLL_INTERVAL);
        elapsed += POLL_INTERVAL;

        let response = match agent
            .get(&poll_url)
            .set("authorization", &format!("Bearer {api_key}"))
            .call()
        {
            Ok(response) => response,
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                return Err(ImageError::ApiFailure(format!(
                    "GET prediction returned {status}: {body}"
                )));
            }
            Err(other) => return Err(ImageError::Transport(Box::new(other))),
        };
        let body = response.into_string().map_err(|error| {
            ImageError::ApiFailure(format!("could not read poll response: {error}"))
        })?;
        let parsed: PredictionResponse = serde_json::from_str(&body)?;
        if is_terminal(&parsed.status) {
            return finalize(parsed);
        }
    }
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "succeeded" | "failed" | "canceled")
}

fn finalize(prediction: PredictionResponse) -> Result<PredictionResponse, ImageError> {
    match prediction.status.as_str() {
        "succeeded" => Ok(prediction),
        "failed" => Err(ImageError::ApiFailure(
            prediction
                .error
                .clone()
                .unwrap_or_else(|| "prediction failed".into()),
        )),
        "canceled" => Err(ImageError::ApiFailure("prediction canceled".into())),
        other => Err(ImageError::ApiFailure(format!(
            "unexpected terminal status: {other}"
        ))),
    }
}

fn extract_first_output_url(prediction: &PredictionResponse) -> Result<String, ImageError> {
    let Some(output) = prediction.output.as_ref() else {
        return Err(ImageError::ApiFailure(
            "prediction succeeded but output was empty".into(),
        ));
    };
    match output {
        // flux-schnell returns an array of image URLs.
        serde_json::Value::Array(array) => array
            .iter()
            .find_map(|value| value.as_str().map(str::to_string))
            .ok_or_else(|| ImageError::ApiFailure("output array contained no string URL".into())),
        // flux-dev (older signature) sometimes returns a single string.
        serde_json::Value::String(url) => Ok(url.clone()),
        other => Err(ImageError::ApiFailure(format!(
            "unexpected output shape: {other}"
        ))),
    }
}

#[derive(Serialize)]
struct PredictionRequest<'a> {
    model: &'a str,
    input: PredictionInput<'a>,
}

#[derive(Serialize)]
struct PredictionInput<'a> {
    prompt: &'a str,
    aspect_ratio: &'a str,
}

#[derive(Deserialize, Debug)]
struct PredictionResponse {
    #[serde(default)]
    status: String,
    #[serde(default)]
    output: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    urls: Option<PredictionUrls>,
}

#[derive(Deserialize, Debug)]
struct PredictionUrls {
    #[serde(default)]
    get: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_includes_prompt_and_aspect_ratio() {
        let body = build_request_body(
            "black-forest-labs/flux-schnell",
            "a coffee shop on a rainy night",
            AspectRatio::Wide16x9,
        )
        .expect("body serializes");
        let value: serde_json::Value = serde_json::from_str(&body).expect("body parses as json");
        assert_eq!(value["model"], "black-forest-labs/flux-schnell");
        assert_eq!(value["input"]["prompt"], "a coffee shop on a rainy night");
        assert_eq!(value["input"]["aspect_ratio"], "16:9");
    }

    #[test]
    fn aspect_ratio_parses_known_aliases() {
        assert_eq!(AspectRatio::parse("16:9"), Some(AspectRatio::Wide16x9));
        assert_eq!(AspectRatio::parse("wide"), Some(AspectRatio::Wide16x9));
        assert_eq!(AspectRatio::parse("1:1"), Some(AspectRatio::Square));
        assert_eq!(AspectRatio::parse("square"), Some(AspectRatio::Square));
        assert_eq!(AspectRatio::parse("4:5"), Some(AspectRatio::Portrait4x5));
        assert_eq!(
            AspectRatio::parse("portrait"),
            Some(AspectRatio::Portrait4x5)
        );
        assert_eq!(AspectRatio::parse("nonsense"), None);
    }
}
