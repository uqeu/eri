//! `eri research <query>` — one-shot web research via the model's built-in web
//! search, run on the user's **eri token budget through the eri proxy**.
//!
//! eri is a harness: end users don't bring their own provider keys — they spend
//! their eri plan's tokens via the signed-in proxy. So research routes through
//! the eri session bearer (like build / iterate / control), never a raw provider
//! key. Not signed in → tell them to sign in. Honest, and never fabricates.

use anyhow::{Context, Result};
use eri_inference::providers::anthropic::AnthropicProvider;

use crate::config;

/// Anthropic wire model id eri uses for Sonnet (matches the rest of the stack).
const WIRE_MODEL: &str = "claude-sonnet-4-6";

pub fn research(query: &str) -> Result<()> {
    let query = query.trim();
    if query.is_empty() {
        anyhow::bail!("research needs a question, e.g. eri research \"what is pgvector?\"");
    }

    // eri tokens, via the proxy — no bring-your-own-key for end users.
    let creds = config::load().context("load eri credentials")?;
    let Some(bearer) = creds.bearer() else {
        println!(
            "eri research runs on your eri tokens, so it needs you signed in:\n\
             \n  eri auth login\n  eri research \"{query}\"\n"
        );
        return Ok(());
    };

    // Route through the eri inference proxy (Bearer = the eri session), so the
    // web search is billed to the user's eri plan — not a provider key.
    let provider = AnthropicProvider::for_model_with_proxy(WIRE_MODEL, bearer, &creds.base_url())
        .context("build eri research provider")?;

    println!("eri is searching…\n");
    let answer = provider.search_web(query).context("web search")?;
    let answer = answer.trim();
    if answer.is_empty() {
        println!("(No answer came back — try rephrasing the question.)");
    } else {
        println!("{answer}");
    }
    Ok(())
}
