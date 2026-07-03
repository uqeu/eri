//! One place the cold-path base-engine calls ride the eri proxy's Anthropic-shaped
//! `/v1/messages` endpoint. Both the reflection pass and the ingest privacy screen
//! go through [`call`], so the request shape, the response-text extraction, and the
//! over-quota (402) handling live (and are tested) in exactly one spot.

use anyhow::{Context, Result};
use serde::Serialize;

/// The Anthropic-shaped `/v1/messages` proxy path (replaces the deprecated
/// `/agent/run {intent:…}`, whose intents the backend never recognized).
pub const INFERENCE_PATH: &str = "/api/v1/inference/messages";

/// One message in the `/v1/messages` body.
#[derive(Serialize)]
struct InferenceMessage<'a> {
    role: &'a str,
    content: &'a str,
}

/// The `/v1/messages` request: `system` instruction + a single user message,
/// non-streaming.
#[derive(Serialize)]
struct InferenceRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: [InferenceMessage<'a>; 1],
    stream: bool,
}

/// Build the request body — pure, so the wire shape is unit-tested without a call.
fn request<'a>(
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    user: &'a str,
) -> InferenceRequest<'a> {
    InferenceRequest {
        model,
        max_tokens,
        system,
        messages: [InferenceMessage {
            role: "user",
            content: user,
        }],
        stream: false,
    }
}

/// Extract the assistant text from an Anthropic `/v1/messages` response — concat
/// every `text` content block. Defensive: a missing/oddly-shaped body yields `""`,
/// never an error (the caller decides what an empty reply means).
pub fn extract_message_text(response_json: &str) -> Result<String> {
    let v: serde_json::Value =
        serde_json::from_str(response_json).context("parse inference response")?;
    Ok(v.get("content")
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<String>()
        })
        .unwrap_or_default())
}

/// The proxy's over-quota 402 — cold-path callers treat it as a soft signal
/// (`Ok(None)`), never a hard error.
fn is_quota_deferral(status: u16) -> bool {
    status == 402
}

/// Call the proxy with `system` + `user` on `model`. `Ok(Some(text))` = the reply;
/// `Ok(None)` = **deferred** (over quota); `Err` = a real failure. Live IO —
/// exercised end-to-end on the real binary, never in CI (callers inject mocks).
pub async fn call(
    model: &str,
    max_tokens: u32,
    system: &str,
    user: &str,
) -> Result<Option<String>> {
    let creds = crate::config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let client = crate::client::Client::from_credentials(&creds)?;
    let (status, body) = client
        .post_for_status(INFERENCE_PATH, &request(model, max_tokens, system, user))
        .await?;
    if is_quota_deferral(status.as_u16()) {
        return Ok(None);
    }
    if !status.is_success() {
        anyhow::bail!("inference HTTP {}: {}", status.as_u16(), body);
    }
    Ok(Some(extract_message_text(&body)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_is_the_anthropic_messages_shape() {
        let v =
            serde_json::to_value(request("claude-haiku-4-5-20251001", 512, "SYS", "hi")).unwrap();
        assert_eq!(v["model"], "claude-haiku-4-5-20251001");
        assert_eq!(v["system"], "SYS");
        assert_eq!(v["stream"], false);
        assert_eq!(v["messages"][0]["role"], "user");
        assert_eq!(v["messages"][0]["content"], "hi");
        assert_eq!(v["max_tokens"], 512);
    }

    #[test]
    fn extract_message_text_concats_anthropic_text_blocks() {
        let resp = r#"{"content":[{"type":"text","text":"{\"entities\":[]}"}],"usage":{}}"#;
        assert_eq!(extract_message_text(resp).unwrap(), r#"{"entities":[]}"#);
    }

    #[test]
    fn extract_message_text_is_defensive_on_a_malformed_response() {
        assert_eq!(extract_message_text(r#"{"error":"x"}"#).unwrap(), "");
    }

    #[test]
    fn over_quota_402_is_a_deferral() {
        assert!(is_quota_deferral(402));
        assert!(!is_quota_deferral(200));
        assert!(!is_quota_deferral(500));
    }
}
