//! `eri research <query>` — one-shot web research via Claude's server-side web
//! search. Honest by construction: it needs a real Claude key (BYOK via
//! `ANTHROPIC_API_KEY`), surfaces real API errors, and never fabricates an
//! answer. When no key is present it says so plainly instead of pretending.

use anyhow::{Context, Result};
use eri_inference::providers::anthropic::AnthropicProvider;

/// Anthropic wire model id eri uses for Sonnet (matches the rest of the stack).
const WIRE_MODEL: &str = "claude-sonnet-4-6";

pub fn research(query: &str) -> Result<()> {
    let query = query.trim();
    if query.is_empty() {
        anyhow::bail!("research needs a question, e.g. eri research \"what is pgvector?\"");
    }

    let Some(key) = anthropic_key() else {
        println!(
            "eri research searches the live web, so it needs a provider key.\n\
             Set it and try again:\n\
             \n  export ANTHROPIC_API_KEY=sk-ant-...\n  eri research \"{query}\"\n\
             \n(Cloud research for signed-in users is coming; for now it's bring-your-own-key.)"
        );
        return Ok(());
    };

    let provider =
        AnthropicProvider::for_model_with_key(WIRE_MODEL, key).context("build Claude provider")?;

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

/// BYOK key from the environment. Trimmed; empty is treated as absent.
fn anthropic_key() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
