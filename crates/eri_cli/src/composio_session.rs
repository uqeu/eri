//! Composio Tool Router session minting.
//!
//! The built-in `composio` MCP server (`eri_mcp::config::builtin_servers`) points
//! at `${COMPOSIO_MCP_URL}`. That URL is a **Tool Router session** endpoint we mint
//! here at launch rather than a static catalog URL.
//!
//! WHY a session instead of the flat catalog: the old `…/v3/mcp/<server_id>/mcp`
//! URL advertised all 61 connector tools on every `tools/list`, which we paid for
//! in input tokens each turn. A Tool Router session instead exposes just 6
//! meta-tools (search / get-schemas / multi-execute / manage-connections /
//! workbench / bash); eri drives the search → schema → execute flow itself, so the
//! per-turn tool surface — and its token cost — drops dramatically.
//!
//! The session is created with a single authenticated POST. We deliberately omit a
//! `toolkits` field: Composio infers the available toolkits from the user's
//! connected accounts (sending a bare array is rejected `400`). The response
//! carries `mcp.url`, the streamable-HTTP endpoint that needs the same
//! `x-api-key` header on every request.

use std::time::Duration;

use serde_json::{Value, json};

/// Composio Tool Router session-create endpoint (verified ground truth).
const SESSION_ENDPOINT: &str = "https://backend.composio.dev/api/v3.1/tool_router/session";

/// Pull the session MCP url out of a session-create response body.
///
/// Pure and unit-testable: separated from the network call so the (fiddly) JSON
/// shape can be asserted without hitting Composio. Returns `None` when the
/// `mcp.url` field is absent or not a string, so a malformed/changed response
/// fails closed (the caller then skips the server).
pub(crate) fn parse_session_url(body: &Value) -> Option<String> {
    body.get("mcp")?.get("url")?.as_str().map(str::to_string)
}

/// POST a Tool Router session-create request and return the session `mcp.url`.
///
/// Returns `None` on any failure (network error, non-success status, missing
/// field) so the caller can fall back to skipping the Composio server — minting
/// a session must never break a build. Under `ERI_DEBUG` a one-line diagnostic
/// is emitted so a silent skip is explainable.
///
/// `api_key` is never logged. `user_id` scopes the session to one eri user.
pub(crate) async fn create_tool_router_session(api_key: &str, user_id: &str) -> Option<String> {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .user_agent(concat!("eri-cli/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            debug(format!("client build failed: {e}"));
            return None;
        }
    };

    // No `toolkits` field on purpose — Composio infers from connected accounts.
    let body = json!({ "user_id": user_id });
    let resp = match client
        .post(SESSION_ENDPOINT)
        .header("x-api-key", api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            debug(format!("session POST transport error: {e}"));
            return None;
        }
    };

    let status = resp.status();
    if !status.is_success() {
        // Read (truncated) body for the diagnostic, but never echo the key.
        let txt = resp.text().await.unwrap_or_default();
        debug(format!(
            "session POST returned HTTP {}: {}",
            status.as_u16(),
            truncate(&txt, 300)
        ));
        return None;
    }

    let parsed: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            debug(format!("session response not JSON: {e}"));
            return None;
        }
    };

    match parse_session_url(&parsed) {
        Some(url) => Some(url),
        None => {
            debug("session response missing mcp.url".to_string());
            None
        }
    }
}

/// Emit a diagnostic only under `ERI_DEBUG`. Kept tiny so call sites stay clean.
fn debug(msg: String) {
    if std::env::var("ERI_DEBUG").is_ok() {
        eprintln!("[eri-mcp] composio session: {msg}");
    }
}

/// Truncate to `max` bytes on a char boundary, appending an ellipsis when cut.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_session_url_extracts_mcp_url_from_valid_body() {
        let body = json!({
            "session_id": "trs_abc123",
            "mcp": {
                "type": "http",
                "url": "https://backend.composio.dev/tool_router/trs_abc123/mcp"
            }
        });
        assert_eq!(
            parse_session_url(&body).as_deref(),
            Some("https://backend.composio.dev/tool_router/trs_abc123/mcp")
        );
    }

    #[test]
    fn parse_session_url_returns_none_when_mcp_url_missing() {
        // `mcp` present but no `url`.
        let no_url = json!({ "session_id": "trs_x", "mcp": { "type": "http" } });
        assert_eq!(parse_session_url(&no_url), None);

        // No `mcp` object at all.
        let no_mcp = json!({ "session_id": "trs_x" });
        assert_eq!(parse_session_url(&no_mcp), None);

        // `mcp.url` present but not a string.
        let bad_type = json!({ "mcp": { "url": 42 } });
        assert_eq!(parse_session_url(&bad_type), None);
    }

    #[test]
    fn truncate_respects_byte_budget_and_char_boundaries() {
        assert_eq!(truncate("short", 100), "short");
        assert_eq!(truncate("abcdef", 3), "abc…");
        // Multi-byte char that would be split is not included.
        let s = "aé"; // 'a' = 1 byte, 'é' = 2 bytes
        assert_eq!(truncate(s, 2), "a…");
    }
}
