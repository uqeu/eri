//! MCP tool definitions exposed by `eri-mcp-server`.
//!
//! Each tool returns a plain-text content block — that's the safest
//! interop shape across MCP clients (Claude Code, Cursor, Cline, etc.).
//! Structured payloads come back as pretty-printed JSON for readability.
//!
//! v1 surface (all read-only OR scoped to the user's local home):
//!   - eri.search       — keyword search the user's local memory store
//!   - eri.recall       — alias for search
//!   - eri.remember     — pin a fact into the user's local memory
//!   - eri.tracer       — placeholder: returns a "use the eri.app"
//!     message; full GitHub-sandbox flow lives in the desktop client
//!     where the filesystem is available
//!   - eri.document     — placeholder: same rationale as tracer

use anyhow::{Context, Result};
use serde_json::{json, Value};

pub fn manifest() -> Value {
    json!([
        {
            "name": "eri.search",
            "description": "Keyword-search the user's local eri memory store. Returns observations ranked by recency. Same backing store the eri.app desktop uses, so what you find here matches what the user sees there.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Keyword or phrase to look up." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
                },
                "required": ["query"]
            }
        },
        {
            "name": "eri.recall",
            "description": "Alias for eri.search — convenience name matching the slash command in eri.app.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
                },
                "required": ["query"]
            }
        },
        {
            "name": "eri.remember",
            "description": "Pin a fact to the user's local memory store so future eri calls (and eri.app) can recall it. Use sparingly — facts persist until /forget.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "The fact to remember." }
                },
                "required": ["text"]
            }
        },
        {
            "name": "eri.tracer",
            "description": "Clone a GitHub/GitLab repo into an ephemeral sandbox, index it, answer a query, and tear the sandbox down. Requires the eri.app desktop client (filesystem + network sandbox).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "git URL of the repo to inspect." },
                    "query": { "type": "string", "description": "Question to answer about the repo." }
                },
                "required": ["url", "query"]
            }
        },
        {
            "name": "eri.document",
            "description": "Extract structured Markdown (with [p. N] citations) from a PDF, paper, or design drawing. Requires the eri.app desktop client.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": { "type": "string", "description": "File path or URL to the document." }
                },
                "required": ["target"]
            }
        }
    ])
}

pub async fn dispatch(name: &str, arguments: Value) -> Result<String> {
    match name {
        "eri.search" | "eri.recall" => handle_search(arguments).await,
        "eri.remember" => handle_remember(arguments).await,
        "eri.tracer" => handle_tracer(arguments).await,
        "eri.document" => handle_document(arguments).await,
        other => Err(anyhow::anyhow!("unknown tool: {other}")),
    }
}

async fn handle_search(arguments: Value) -> Result<String> {
    #[derive(serde::Deserialize)]
    struct Args {
        query: String,
        #[serde(default = "default_limit")]
        limit: usize,
    }
    fn default_limit() -> usize {
        10
    }
    let args: Args = serde_json::from_value(arguments).context("invalid arguments")?;
    let store = eri_inference::memory::MemoryStore::open()
        .context("failed to open eri memory store")?;
    // The MCP server runs outside any workspace; pass `.` so recall
    // falls through to the global facts that aren't workspace-scoped.
    let observations = store.recall(&args.query, std::path::Path::new("."), args.limit);
    if observations.is_empty() {
        return Ok(format!("No observations match `{query}`.", query = args.query));
    }
    let mut out = format!(
        "{n} observation{plural} matching `{query}`:\n",
        n = observations.len(),
        plural = if observations.len() == 1 { "" } else { "s" },
        query = args.query,
    );
    for o in observations {
        out.push_str(&format!(
            "- [{kind}] {body}\n",
            kind = o.kind,
            body = o.body.lines().next().unwrap_or("")
        ));
    }
    Ok(out)
}

async fn handle_remember(arguments: Value) -> Result<String> {
    #[derive(serde::Deserialize)]
    struct Args {
        text: String,
    }
    let args: Args = serde_json::from_value(arguments).context("invalid arguments")?;
    let text = args.text.trim();
    if text.is_empty() {
        return Err(anyhow::anyhow!("text must be non-empty"));
    }
    let mut store = eri_inference::memory::MemoryStore::open()
        .context("failed to open eri memory store")?;
    let pinned = eri_inference::memory::collectors::remember_fact(
        &mut store,
        std::path::Path::new("."),
        text,
    )
    .context("failed to pin fact")?;
    Ok(format!("Remembered (id: {}).", pinned.id))
}

async fn handle_tracer(_arguments: Value) -> Result<String> {
    Ok(
        "Tracer needs the eri.app desktop client for the ephemeral sandbox. \
Install eri.app and run /tracer there, or copy this prompt into eri.app's chat composer."
            .to_string(),
    )
}

async fn handle_document(_arguments: Value) -> Result<String> {
    Ok(
        "Document extraction needs the eri.app desktop client for the file upload + multimodal pass. \
Install eri.app and run /document there."
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_lists_all_five_tools() {
        let m = manifest();
        let arr = m.as_array().expect("array");
        let names: Vec<&str> = arr
            .iter()
            .filter_map(|t| t.get("name").and_then(|n| n.as_str()))
            .collect();
        for needed in [
            "eri.search",
            "eri.recall",
            "eri.remember",
            "eri.tracer",
            "eri.document",
        ] {
            assert!(names.contains(&needed), "missing tool: {needed}");
        }
    }

    #[tokio::test]
    async fn dispatch_unknown_returns_error() {
        let r = dispatch("eri.nope", json!({})).await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn dispatch_tracer_returns_message() {
        let r = dispatch(
            "eri.tracer",
            json!({"url": "https://github.com/foo/bar", "query": "what is x?"}),
        )
        .await
        .unwrap();
        assert!(r.to_lowercase().contains("eri.app"));
    }

    #[tokio::test]
    async fn dispatch_document_returns_message() {
        let r = dispatch("eri.document", json!({"target": "./paper.pdf"}))
            .await
            .unwrap();
        assert!(r.to_lowercase().contains("eri.app"));
    }
}
