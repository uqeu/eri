//! `eri phone link` — pair your phone with eri so you can text it (ADR-0002).
//!
//! Calls `/api/v1/phone/pair` with the signed-in api-token bearer to mint a
//! short, single-use code, then tells the user to text that code to the eri
//! number. The inbound webhook matches the code, binds + verifies the number,
//! and from then on the user just texts eri. No prompt content here — this is
//! pairing metadata only.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::config;

#[derive(Serialize)]
struct PairRequest {}

#[derive(Deserialize)]
struct PairResponse {
    code: String,
    #[serde(default)]
    number: Option<String>,
    #[serde(default)]
    expires_in_minutes: u32,
}

pub async fn link() -> Result<()> {
    let creds = config::load()?;
    if !creds.is_signed_in() {
        anyhow::bail!("not signed in — run `eri auth login` first");
    }
    let client = Client::from_credentials(&creds)?;
    let resp: PairResponse = match client
        .post_json("/api/v1/phone/pair", &PairRequest {})
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("HTTP 402") {
                anyhow::bail!(
                    "texting eri is a Pro+ feature — upgrade at tryeri.ca to link your phone."
                );
            }
            if msg.contains("HTTP 401") {
                anyhow::bail!("not authorized — run `eri auth login` again.");
            }
            return Err(e);
        }
    };

    let number = resp.number.as_deref().unwrap_or("the eri number");
    println!("Link your phone to eri 🌿");
    println!();
    println!("  1. From your phone, text this code to {number}:");
    println!();
    println!("         {}", resp.code);
    println!();
    println!("  2. eri texts back to confirm — then just talk to it like a friend.");
    if resp.expires_in_minutes > 0 {
        println!();
        println!(
            "  (the code expires in {} minutes)",
            resp.expires_in_minutes
        );
    }
    Ok(())
}
