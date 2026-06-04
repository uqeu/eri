//! Server-published update manifest support for the Eri CLI.
//!
//! `eri update check` intentionally does not install yet. It verifies the
//! product contract first: local CLI asks the active Eri host for a signed
//! release manifest, then the installer/updater can consume the same shape.

use anyhow::{Context, Result};
use clap::ValueEnum;
use serde::{Deserialize, Serialize};

use crate::config;

const ERI_CLI_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum UpdateChannel {
    Stable,
    Beta,
    Nightly,
}

impl UpdateChannel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Nightly => "nightly",
        }
    }
}

impl std::fmt::Display for UpdateChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum UpdateOutputMode {
    Text,
    Json,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UpdateCheckOptions {
    pub channel: UpdateChannel,
    pub output: UpdateOutputMode,
}

impl Default for UpdateCheckOptions {
    fn default() -> Self {
        Self {
            channel: UpdateChannel::Stable,
            output: UpdateOutputMode::Text,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub name: String,
    pub channel: String,
    pub current_version: String,
    pub version: String,
    pub update_available: bool,
    pub minimum_version: Option<String>,
    pub target: String,
    pub installer_url: Option<String>,
    pub archive_url: Option<String>,
    pub signature_url: Option<String>,
    pub sha256: Option<String>,
    pub published_at: Option<String>,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub auto_update: bool,
}

pub async fn check(options: UpdateCheckOptions) -> Result<()> {
    let creds = config::load()?;
    let url = manifest_url(&creds.base_url(), options.channel);
    let mut request = reqwest::Client::new()
        .get(&url)
        .header("x-eri-current-version", ERI_CLI_VERSION);
    if let Some(bearer) = creds.bearer() {
        request = request.bearer_auth(bearer);
    }

    let response = request
        .send()
        .await
        .with_context(|| format!("fetch update manifest from {url}"))?;
    if !response.status().is_success() {
        anyhow::bail!(
            "update manifest returned {} from {}",
            response.status(),
            url
        );
    }
    let manifest = response
        .json::<UpdateManifest>()
        .await
        .with_context(|| format!("parse update manifest from {url}"))?;
    print_manifest(&manifest, options.output)?;
    Ok(())
}

fn manifest_url(base_url: &str, channel: UpdateChannel) -> String {
    let base = base_url.trim_end_matches('/');
    format!(
        "{base}/api/v1/updates/eri-cli?version={}&channel={}&target={}",
        ERI_CLI_VERSION,
        channel.as_str(),
        target()
    )
}

fn target() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn print_manifest(manifest: &UpdateManifest, output: UpdateOutputMode) -> Result<()> {
    match output {
        UpdateOutputMode::Json => {
            println!("{}", serde_json::to_string_pretty(manifest)?);
        }
        UpdateOutputMode::Text => {
            println!(
                "eri CLI {} channel: {}",
                manifest.channel, manifest.current_version
            );
            if manifest.update_available
                || version_is_newer(&manifest.version, &manifest.current_version)
            {
                println!("update available: {}", manifest.version);
                if let Some(url) = &manifest.installer_url {
                    println!("installer: {url}");
                }
                if let Some(url) = &manifest.archive_url {
                    println!("archive: {url}");
                }
                if let Some(signature_url) = &manifest.signature_url {
                    println!("signature: {signature_url}");
                }
                if let Some(sha256) = &manifest.sha256 {
                    println!("sha256: {sha256}");
                }
                if manifest.auto_update {
                    println!("auto-update: enabled by server manifest");
                }
            } else {
                println!("up to date: {}", manifest.version);
            }
            if !manifest.notes.is_empty() {
                println!("notes:");
                for note in &manifest.notes {
                    println!("  - {note}");
                }
            }
        }
    }
    Ok(())
}

fn version_is_newer(latest: &str, current: &str) -> bool {
    let latest_parts = numeric_version_parts(latest);
    let current_parts = numeric_version_parts(current);
    latest_parts > current_parts
}

fn numeric_version_parts(input: &str) -> Vec<u64> {
    input
        .split(['.', '-'])
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
        })
        .map(|digits| digits.parse::<u64>().unwrap_or(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_like_versions() {
        assert!(version_is_newer("0.2.0", "0.1.9"));
        assert!(version_is_newer("1.0.0", "0.99.99"));
        assert!(!version_is_newer("0.1.0", "0.1.0"));
        assert!(!version_is_newer("0.1.9", "0.2.0"));
    }

    #[test]
    fn parses_manifest_wire_shape() {
        let raw = r#"{
          "name": "eri-cli",
          "channel": "stable",
          "currentVersion": "0.1.0",
          "version": "0.2.0",
          "updateAvailable": true,
          "minimumVersion": "0.1.0",
          "target": "macos-aarch64",
          "installerUrl": "https://tryeri.ca/install",
          "archiveUrl": "https://tryeri.ca/releases/eri-cli.tar.gz",
          "signatureUrl": "https://tryeri.ca/releases/eri-cli.tar.gz.sig",
          "sha256": "abc123",
          "publishedAt": "2026-06-02T00:00:00.000Z",
          "notes": ["Adds Agent Manager lifecycle commands."],
          "autoUpdate": true
        }"#;
        let manifest: UpdateManifest = serde_json::from_str(raw).unwrap();
        assert_eq!(manifest.name, "eri-cli");
        assert_eq!(manifest.version, "0.2.0");
        assert!(manifest.update_available);
        assert_eq!(manifest.notes.len(), 1);
    }
}
