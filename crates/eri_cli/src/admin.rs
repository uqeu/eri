//! `eri admin usage` -- per-user usage analytics for the account owner.
//!
//! Calls the admin-only `/api/v1/admin/analytics` endpoint with the signed-in
//! api-token bearer and prints a compact rollup. The endpoint gates on
//! `users.is_admin`; a non-admin bearer gets a friendly message. No prompt
//! content is ever involved -- this is token/cost metadata only.

use anyhow::Result;
use serde::Deserialize;

use crate::client::Client;
use crate::config;

#[derive(Deserialize)]
struct Totals {
    requests: u64,
    tokens_in: u64,
    tokens_out: u64,
    credits: u64,
    cost_usd_micros: i64,
    active_users: u64,
}

#[derive(Deserialize)]
struct ModelRollup {
    model: String,
    requests: u64,
    tokens_in: u64,
    tokens_out: u64,
    cost_usd_micros: i64,
}

#[derive(Deserialize)]
struct UserRollup {
    user_id: String,
    email: Option<String>,
    tier: Option<String>,
    requests: u64,
    credits: u64,
    cost_usd_micros: i64,
    last_active: Option<String>,
}

#[derive(Deserialize)]
struct Analytics {
    days: u32,
    totals: Totals,
    by_model: Vec<ModelRollup>,
    top_users: Vec<UserRollup>,
}

fn usd(micros: i64) -> String {
    format!("${:.2}", micros as f64 / 1_000_000.0)
}

pub async fn usage(days: u32, top: u32) -> Result<()> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in -- run `eri auth login` first");
    }
    let client = Client::from_credentials(&creds)?;
    let path = format!("/api/v1/admin/analytics?days={days}&top={top}");
    let data: Analytics = match client.get_json(&path).await {
        Ok(d) => d,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("HTTP 403") {
                anyhow::bail!("this account isn't an admin -- analytics is owner-only.");
            }
            if msg.contains("HTTP 401") {
                anyhow::bail!("not authorized -- run `eri auth login` again.");
            }
            return Err(e);
        }
    };

    let t = &data.totals;
    println!("eri usage -- last {} days", data.days);
    println!(
        "  active users {}   requests {}   credits {}   cost {}",
        t.active_users,
        t.requests,
        t.credits,
        usd(t.cost_usd_micros)
    );
    println!("  tokens: {} in / {} out", t.tokens_in, t.tokens_out);

    if !data.top_users.is_empty() {
        println!("\ntop users:");
        println!(
            "  {:<28} {:<10} {:>6} {:>10} {:>9}  last active",
            "user", "tier", "reqs", "credits", "cost"
        );
        for u in data.top_users.iter().take(top as usize) {
            let who = u.email.clone().unwrap_or_else(|| u.user_id.clone());
            println!(
                "  {:<28} {:<10} {:>6} {:>10} {:>9}  {}",
                truncate(&who, 28),
                u.tier.as_deref().unwrap_or("-"),
                u.requests,
                u.credits,
                usd(u.cost_usd_micros),
                u.last_active.as_deref().unwrap_or("-")
            );
        }
    }

    if !data.by_model.is_empty() {
        println!("\nby model:");
        for m in &data.by_model {
            println!(
                "  {:<28} reqs {:>6}  {} in / {} out  {}",
                truncate(&m.model, 28),
                m.requests,
                m.tokens_in,
                m.tokens_out,
                usd(m.cost_usd_micros)
            );
        }
    }
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let head: String = s.chars().take(max - 1).collect();
        format!("{head}…")
    }
}
