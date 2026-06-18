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
    println!("eri is searching…\n");
    match search_web_via_proxy(query)? {
        Some(answer) if !answer.trim().is_empty() => println!("{}", answer.trim()),
        Some(_) => println!("(No answer came back — try rephrasing the question.)"),
        None => println!(
            "eri research runs on your eri tokens, so it needs you signed in:\n\
             \n  eri auth login\n  eri research \"{query}\"\n"
        ),
    }
    Ok(())
}

/// Run a web search through the model's built-in web search, billed to the
/// user's eri plan via the proxy bearer. The ONE web-search implementation —
/// shared by the `eri research` CLI and the in-turn `web_search` agent tool, so
/// the desktop brain searches the web the same way everywhere (no clone).
///
/// `Ok(None)` = not signed in (the only non-error "can't" case); `Ok(Some(text))`
/// = the answer (possibly empty); `Err` = a real failure.
pub(crate) fn search_web_via_proxy(query: &str) -> Result<Option<String>> {
    let creds = config::load().context("load eri credentials")?;
    let Some(bearer) = creds.bearer() else {
        return Ok(None);
    };
    // Route through the eri inference proxy (Bearer = the eri session), so the
    // web search is billed to the user's eri plan — not a provider key.
    let provider = AnthropicProvider::for_model_with_proxy(WIRE_MODEL, bearer, &creds.base_url())
        .context("build eri research provider")?;
    let answer = provider.search_web(query).context("web search")?;
    Ok(Some(answer))
}
