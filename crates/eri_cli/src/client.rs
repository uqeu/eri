//! HTTP client for the eri.dev API.
//!
//! Talks to the public REST surface (`/api/v1/*`) with the user's
//! bearer token. Stream calls (ask, ship) yield JSON events line-by-line
//! over Server-Sent Events / NDJSON; one-shot calls return parsed JSON.

use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Serialize, de::DeserializeOwned};

use crate::config::Credentials;

pub struct Client {
    inner: reqwest::Client,
    base_url: String,
    bearer: Option<String>,
}

impl Client {
    pub fn from_credentials(creds: &Credentials) -> Result<Self> {
        let inner = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(concat!("eri-cli/", env!("CARGO_PKG_VERSION")))
            .build()
            .context("build reqwest client")?;
        Ok(Self {
            inner,
            base_url: trim_slash(creds.base_url()),
            bearer: creds.bearer(),
        })
    }

    pub fn bearer(&self) -> Option<&str> {
        self.bearer.as_deref()
    }

    /// Issue a GET against an API path. Bearer is attached when present.
    pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.inner.get(&url).header("accept", "application/json");
        if let Some(token) = &self.bearer {
            req = req.bearer_auth(token);
        }
        let response = req.send().await.context("transport error")?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("HTTP {}: {}", status.as_u16(), truncate(&body, 512));
        }
        response.json::<T>().await.context("parse JSON")
    }

    /// Issue a POST with a JSON body. Returns the parsed response.
    pub async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self
            .inner
            .post(&url)
            .header("accept", "application/json")
            .json(body);
        if let Some(token) = &self.bearer {
            req = req.bearer_auth(token);
        }
        let response = req.send().await.context("transport error")?;
        let status = response.status();
        if !status.is_success() {
            let txt = response.text().await.unwrap_or_default();
            anyhow::bail!("HTTP {}: {}", status.as_u16(), truncate(&txt, 512));
        }
        response.json::<T>().await.context("parse JSON")
    }

    /// Open a streaming POST. Caller drives the stream — each yielded
    /// `String` is one complete decoded event (NDJSON-style; the
    /// caller does the JSON parse so different endpoints can ship
    /// different envelopes).
    pub async fn post_stream<B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<reqwest::Response> {
        let url = format!("{}{}", self.base_url, path);
        // Override the client's short default timeout: one streamed agent turn
        // (e.g. generating a full file) can legitimately run for minutes. This
        // is a per-request total timeout; the loop opens a fresh stream per turn.
        let mut req = self
            .inner
            .post(&url)
            .timeout(Duration::from_secs(600))
            .header("accept", "text/event-stream")
            .json(body);
        if let Some(token) = &self.bearer {
            req = req.bearer_auth(token);
        }
        let response = req.send().await.context("transport error")?;
        let status = response.status();
        if !status.is_success() {
            let txt = response.text().await.unwrap_or_default();
            anyhow::bail!("HTTP {}: {}", status.as_u16(), truncate(&txt, 512));
        }
        Ok(response)
    }
}

fn trim_slash(mut s: String) -> String {
    while s.ends_with('/') {
        s.pop();
    }
    s
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}
