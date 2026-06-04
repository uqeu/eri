//! Device-code OAuth-style flow for the `eri` CLI.
//!
//! Mirrors the desktop client's flow: ask the backend for a device code,
//! print the URL + code to the user, open the browser, poll until the
//! user approves, then save the bearer + tier + email to credentials.json.

use std::io::{self, Write};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::config::{self, Credentials};

const POLL_INTERVAL_SECS: u64 = 2;
const POLL_MAX_SECS: u64 = 600; // 10 min — matches the IDE flow.

#[derive(Debug, Serialize)]
struct DeviceStartBody {}

// RFC 8628 device authorization response. /api/v1/auth/device/start returns
// { deviceCode, userCode, verificationUri, verificationUriComplete, ... }.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceStartResponse {
    /// The polling secret — held only by this client, never shown to the user.
    device_code: String,
    /// The short code the user enters/confirms in the browser.
    user_code: String,
    /// Browser URL to enter the user_code.
    verification_uri: Option<String>,
    /// Same URL with the user_code prefilled.
    verification_uri_complete: Option<String>,
    /// Back-compat alias some deployments still emit.
    verify_url: Option<String>,
}

// The token endpoint. We send the secret device_code; on approval it returns
// { status: "approved", token }.
#[derive(Debug, Serialize)]
struct DevicePollBody {
    device_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevicePollResponse {
    status: String,
    // approved payload — backend sends `token`; accept `bearer` too for safety.
    token: Option<String>,
    bearer: Option<String>,
    user_id: Option<String>,
    email: Option<String>,
    tier: Option<String>,
}

pub async fn login() -> Result<Credentials> {
    let creds = config::load()?;
    let client = Client::from_credentials(&creds)?;
    let start: DeviceStartResponse = client
        .post_json("/api/v1/auth/device/start", &DeviceStartBody {})
        .await
        .context("start device flow")?;

    // Prefer the prefilled URL; fall back to the plain verification URI.
    let open_url = start
        .verification_uri_complete
        .clone()
        .or_else(|| start.verify_url.clone())
        .or_else(|| start.verification_uri.clone())
        .unwrap_or_default();
    let manual_url = start
        .verification_uri
        .clone()
        .or_else(|| start.verify_url.clone())
        .unwrap_or_else(|| open_url.clone());

    println!();
    println!("→ Open this URL and confirm the code:");
    println!("  {manual_url}");
    println!();
    println!("→ Your code: {}", start.user_code);
    println!();
    let _ = io::stdout().flush();

    if !open_url.is_empty() {
        let _ = try_open_browser(&open_url);
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(POLL_MAX_SECS);
    let mut spinner = Spinner::new("Waiting for approval");
    loop {
        if std::time::Instant::now() >= deadline {
            spinner.stop();
            anyhow::bail!("timed out waiting for sign-in (10 min cap)");
        }
        spinner.tick();
        tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
        let poll: DevicePollResponse = client
            .post_json(
                "/api/v1/auth/device/poll",
                &DevicePollBody {
                    device_code: start.device_code.clone(),
                },
            )
            .await
            .context("poll device flow")?;
        match poll.status.as_str() {
            "pending" => continue,
            "approved" => {
                spinner.stop();
                let mut next = creds.clone();
                next.bearer = poll.bearer.or(poll.token);
                next.user_id = poll.user_id;
                next.email = poll.email;
                next.tier = poll.tier;
                // Persist the canonical host so future runs skip the apex redirect.
                next.base_url = Some(creds.base_url());
                config::save(&next)?;
                println!(
                    "Signed in as {}",
                    next.email.as_deref().unwrap_or("eri user")
                );
                return Ok(next);
            }
            "denied" => {
                spinner.stop();
                anyhow::bail!("sign-in denied");
            }
            "expired" => {
                spinner.stop();
                anyhow::bail!("sign-in code expired — run `eri auth login` again");
            }
            other => {
                spinner.stop();
                anyhow::bail!("unexpected device-flow status: {other}");
            }
        }
    }
}

pub fn logout() -> Result<()> {
    config::clear()?;
    println!("Signed out.");
    Ok(())
}

pub async fn status() -> Result<()> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        println!("Not signed in. Run `eri auth login`.");
        return Ok(());
    }
    println!(
        "Signed in as {} ({})",
        creds.email.as_deref().unwrap_or("unknown"),
        creds.tier.as_deref().unwrap_or("free")
    );
    // Pull live usage so the user sees their remaining tokens.
    let client = Client::from_credentials(&creds)?;
    match client.get_json::<serde_json::Value>("/api/v1/usage").await {
        Ok(usage) => {
            if let Some(t) = usage.get("tier").and_then(|v| v.as_str()) {
                println!("Tier: {t}");
            }
            if let Some(tokens) = usage.get("tokens") {
                if let Some(remaining) = tokens.get("remainingIncluded").and_then(|v| v.as_i64()) {
                    println!("Tokens remaining (included): {remaining}");
                }
            }
            if let Some(period) = usage.get("period") {
                if let Some(end) = period.get("end").and_then(|v| v.as_str()) {
                    println!("Period ends: {end}");
                }
            }
        }
        Err(err) => {
            eprintln!("(could not fetch usage: {err})");
        }
    }
    Ok(())
}

fn try_open_browser(url: &str) -> Result<()> {
    use std::process::Command;
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "cmd"
    } else {
        "xdg-open"
    };
    let args: Vec<&str> = if opener == "cmd" {
        vec!["/c", "start", "", url]
    } else {
        vec![url]
    };
    let _ = Command::new(opener).args(args).spawn();
    Ok(())
}

struct Spinner {
    frames: &'static [&'static str],
    idx: usize,
    label: &'static str,
}

impl Spinner {
    fn new(label: &'static str) -> Self {
        Self {
            frames: &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
            idx: 0,
            label,
        }
    }
    fn tick(&mut self) {
        let frame = self.frames[self.idx % self.frames.len()];
        self.idx = self.idx.wrapping_add(1);
        eprint!("\r{frame} {}…", self.label);
        let _ = io::stderr().flush();
    }
    fn stop(&mut self) {
        eprintln!("\r{}", " ".repeat(self.label.len() + 4));
    }
}
