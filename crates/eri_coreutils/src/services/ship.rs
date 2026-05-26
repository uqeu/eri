//! `eri/ship/run` JSON-RPC handler — Builder/Checker tandem ship.
//!
//! Proxies the request to `{ERI_BASE_URL}/api/v1/inference/ship`, reads
//! the SSE stream of [`TandemEvent`]s, and re-emits each frame as an
//! `eri/ship/event` notification on the JSON-RPC channel so the extension
//! can render per-builder + checker progress in real time.
//!
//! HTTP 402 (over-quota) → [`DispatchError::OverQuota`] so the IDE pops
//! the upgrade dialog via the existing `-32402` handler.
//!
//! HTTP 401 / network failure / missing session → returned as a generic
//! `DispatchError::Other` carrying enough context for diagnostics.

use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

/// One file pulled from the workspace into the ship context.
#[derive(Debug, Clone, Deserialize, Serialize)]
struct WorkspaceFileWire {
    path: String,
    #[serde(default)]
    content: String,
}

/// Optional plan override. When unset, the backend uses
/// `tandem.ts::DEFAULT_PLAN` (Sonnet + GPT-4o builders, Gemini checker).
#[derive(Debug, Clone, Deserialize, Serialize)]
struct BuilderCheckerPlanWire {
    builders: Vec<TandemSlotWire>,
    checker: TandemSlotWire,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TandemSlotWire {
    role: String,
    provider: String,
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShipParams {
    instructions: String,
    workspace_files: Vec<WorkspaceFileWire>,
    #[serde(default)]
    plan: Option<BuilderCheckerPlanWire>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShipResult {
    /// Whether the ship completed without `ship_failed`.
    ok: bool,
    /// Models that produced output (at least the checker if ok).
    survivors: Vec<String>,
    /// Aggregate token spend across all three model calls.
    total_tokens_in: u64,
    total_tokens_out: u64,
    /// Cost in micro-USD; rough estimate per `lib/inference/tokens.ts`.
    total_cost_micros: u64,
    /// Final merged patchset emitted by the checker — search/replace
    /// blocks in eri_apply's canonical format, ready for ApplyOrchestrator.
    merged_patchset: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TokenCountsWire {
    #[serde(default)]
    tokens_in: u64,
    #[serde(default)]
    tokens_out: u64,
}

/// `eri/ship/run` handler. Returns the aggregate after the SSE stream
/// closes; per-frame progress is delivered via `eri/ship/event`
/// notifications during the stream.
pub async fn run(
    params: Value,
    _tier_state: &SharedTierState,
    services: &Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: ShipParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/ship/run: {e}")))?;

    let session = services
        .secrets
        .eri_session_token(services.host_client.as_deref())
        .await
        .ok_or_else(|| {
            DispatchError::Other(anyhow::anyhow!(
                "no eri session token; user must sign in to ship"
            ))
        })?;
    let base_url = services.secrets.eri_base_url();
    let url = format!("{base_url}/api/v1/inference/ship");

    let body = serde_json::json!({
        "instructions": p.instructions,
        "workspaceFiles": p.workspace_files,
        "plan": p.plan,
    });

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("ship http client: {e}")))?;

    let response = client
        .post(&url)
        .bearer_auth(&session)
        .header("accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| DispatchError::Other(anyhow::anyhow!("ship request failed: {e}")))?;

    let status = response.status();
    if status == reqwest::StatusCode::PAYMENT_REQUIRED {
        // Best effort to extract the JSON `{ tier, remaining }` payload.
        let payload = response.json::<serde_json::Value>().await.ok();
        let tier = payload
            .as_ref()
            .and_then(|v| v.get("tier"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let remaining = payload
            .as_ref()
            .and_then(|v| v.get("remaining"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        return Err(DispatchError::OverQuota { tier, remaining });
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        // Best effort to extract { tier, window, resetAt } so the IDE
        // can drive the clock toast instead of the paywall modal.
        let payload = response.json::<serde_json::Value>().await.ok();
        let tier = payload
            .as_ref()
            .and_then(|v| v.get("tier"))
            .and_then(|v| v.as_str())
            .unwrap_or("free")
            .to_string();
        let window = payload
            .as_ref()
            .and_then(|v| v.get("window"))
            .and_then(|v| v.as_str())
            .unwrap_or("minute")
            .to_string();
        let reset_at = payload
            .as_ref()
            .and_then(|v| v.get("resetAt"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        return Err(DispatchError::RateLimited {
            tier,
            window,
            reset_at,
        });
    }
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(DispatchError::Other(anyhow::anyhow!(
            "ship upstream status {}: {}",
            status.as_u16(),
            text
        )));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut survivors: Vec<String> = Vec::new();
    let mut totals_in: u64 = 0;
    let mut totals_out: u64 = 0;
    let mut totals_cost: u64 = 0;
    let mut merged_patchset = String::new();
    let mut ok = false;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| {
            DispatchError::Other(anyhow::anyhow!("ship stream read: {e}"))
        })?;
        let text = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(_) => continue,
        };
        buffer.push_str(text);

        // SSE frames are separated by blank lines.
        while let Some(idx) = buffer.find("\n\n") {
            let frame = buffer[..idx].to_string();
            buffer = buffer[idx + 2..].to_string();
            for line in frame.lines() {
                let Some(payload) = line.strip_prefix("data:") else {
                    continue;
                };
                let payload = payload.trim();
                if payload.is_empty() {
                    continue;
                }
                let parsed: Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                // Side-effects driven by event kind.
                if let Some(kind) = parsed.get("kind").and_then(|v| v.as_str()) {
                    match kind {
                        "builder_done" | "checker_done" => {
                            if let Some(tokens) = parsed.get("tokens") {
                                if let Ok(t) =
                                    serde_json::from_value::<TokenCountsWire>(tokens.clone())
                                {
                                    totals_in += t.tokens_in;
                                    totals_out += t.tokens_out;
                                }
                            }
                            if let Some(cost) =
                                parsed.get("cost_usd_micros").and_then(|v| v.as_u64())
                            {
                                totals_cost += cost;
                            }
                            if kind == "checker_done" {
                                if let Some(text) =
                                    parsed.get("text").and_then(|v| v.as_str())
                                {
                                    merged_patchset.push_str(text);
                                }
                            }
                        }
                        "ship_done" => {
                            ok = true;
                            if let Some(arr) =
                                parsed.get("survivors").and_then(|v| v.as_array())
                            {
                                survivors = arr
                                    .iter()
                                    .filter_map(|v| v.as_str().map(str::to_string))
                                    .collect();
                            }
                        }
                        _ => {}
                    }
                }

                // Forward every event verbatim to the extension.
                if let Some(notifier) = services.notifier.as_ref() {
                    notifier.notify("eri/ship/event", parsed);
                }
            }
        }
    }

    // Phase 18a — auto-review pass. After a successful merge, surface
    // the eri_review crate's findings on the merged patchset as a
    // `review_findings` event so the IDE can render ghost comments on
    // the diff. Skip when the merge is empty or the ship failed —
    // there's nothing to review.
    if ok && !merged_patchset.trim().is_empty() {
        if let Some(notifier) = services.notifier.as_ref() {
            let started = std::time::Instant::now();
            // Emit a lightweight "review_started" event so the IDE can
            // show a spinner immediately; the findings event below
            // arrives once the synchronous classifier completes.
            notifier.notify(
                "eri/ship/event",
                serde_json::json!({ "type": "review_started" }),
            );
            // Run the cheap heuristic review (no model call) so we can
            // ship findings synchronously without doubling ship latency.
            // The full model-backed review still lives behind the
            // existing /review surface for users who want a deeper pass.
            let findings = quick_review_findings(&merged_patchset);
            notifier.notify(
                "eri/ship/event",
                serde_json::json!({
                    "type": "review_findings",
                    "findings": findings,
                    "elapsedMs": started.elapsed().as_millis() as u64,
                }),
            );
        }
    }

    Ok(serde_json::to_value(ShipResult {
        ok,
        survivors,
        total_tokens_in: totals_in,
        total_tokens_out: totals_out,
        total_cost_micros: totals_cost,
        merged_patchset,
    })
    .unwrap_or(Value::Null))
}

/// Lightweight, sync, heuristic-only review of a unified-diff patchset.
/// Catches a small set of common smells (TODO injections, console.log,
/// debug prints, hardcoded localhost URLs) so the user gets immediate
/// feedback after a ship without paying for another model round-trip.
/// The full model-backed review lives behind the existing
/// `eri/review/*` JSON-RPC surface for deeper passes.
fn quick_review_findings(patch: &str) -> Vec<serde_json::Value> {
    let mut findings = Vec::new();
    let mut current_file: Option<String> = None;
    let mut new_line_no: u32 = 0;
    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("+++ b/") {
            current_file = Some(rest.to_string());
            new_line_no = 0;
            continue;
        }
        if line.starts_with("+++ ") || line.starts_with("--- ") {
            continue;
        }
        if let Some(rest) = line.strip_prefix("@@ ") {
            // Parse "+START[,LEN]" to anchor the new file's line counter.
            if let Some(plus) = rest.split_whitespace().find(|t| t.starts_with('+')) {
                let nums = &plus[1..];
                let start = nums
                    .split(',')
                    .next()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0);
                new_line_no = start.saturating_sub(1);
            }
            continue;
        }
        if line.starts_with('+') && !line.starts_with("++") {
            new_line_no += 1;
            let added = &line[1..];
            for smell in detect_smells(added) {
                findings.push(serde_json::json!({
                    "file": current_file.clone().unwrap_or_default(),
                    "line": new_line_no,
                    "severity": smell.severity,
                    "category": smell.category,
                    "message": smell.message,
                }));
            }
        } else if line.starts_with(' ') {
            new_line_no += 1;
        }
        // '-' lines don't advance the new-file counter.
    }
    findings
}

struct Smell {
    severity: &'static str,
    category: &'static str,
    message: String,
}

fn detect_smells(added_line: &str) -> Vec<Smell> {
    let mut out = Vec::new();
    let trimmed = added_line.trim();
    if trimmed.contains("TODO") || trimmed.contains("FIXME") || trimmed.contains("XXX") {
        out.push(Smell {
            severity: "info",
            category: "todo",
            message: "Open TODO/FIXME added — flag for follow-up.".into(),
        });
    }
    if trimmed.contains("console.log(") || trimmed.contains("println!(") || trimmed.contains("print(") {
        out.push(Smell {
            severity: "warning",
            category: "debug",
            message: "Debug print added; remove before shipping to prod.".into(),
        });
    }
    if trimmed.contains("localhost") || trimmed.contains("127.0.0.1") {
        out.push(Smell {
            severity: "warning",
            category: "hardcode",
            message: "Hardcoded localhost — replace with config / env var.".into(),
        });
    }
    if trimmed.contains("debugger;") {
        out.push(Smell {
            severity: "warning",
            category: "debug",
            message: "`debugger;` statement added; remove before commit.".into(),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_review_flags_console_log_on_added_lines() {
        let patch = "\
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
+console.log(x);
 const y = 2;
";
        let findings = quick_review_findings(patch);
        assert_eq!(findings.len(), 1);
        let f = &findings[0];
        assert_eq!(f["file"], "src/foo.ts");
        assert_eq!(f["category"], "debug");
        // Hunk starts at line 1; we keep 1 context line, then the +
        // lands on line 2 of the new file.
        assert_eq!(f["line"], 2);
    }

    #[test]
    fn quick_review_does_not_flag_removed_lines() {
        let patch = "\
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,2 @@
 keep
-console.log('old');
 keep
";
        let findings = quick_review_findings(patch);
        assert!(findings.is_empty(), "removed lines must not flag");
    }

    #[test]
    fn quick_review_flags_localhost_and_todo() {
        let patch = "\
--- a/src/api.ts
+++ b/src/api.ts
@@ -10,2 +10,3 @@
 const url = 'http://localhost:3000';
+// TODO: replace localhost with config
 const z = 0;
";
        let findings = quick_review_findings(patch);
        // The `+` line has both a TODO and "localhost" — both smells fire.
        let cats: Vec<&str> = findings
            .iter()
            .map(|f| f["category"].as_str().unwrap_or(""))
            .collect();
        assert!(cats.contains(&"todo"));
        assert!(cats.contains(&"hardcode"));
    }

    #[test]
    fn quick_review_returns_empty_for_clean_patch() {
        let patch = "\
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
";
        let findings = quick_review_findings(patch);
        assert!(findings.is_empty());
    }
}
