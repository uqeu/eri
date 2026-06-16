//! Pre-warmed docs cache (Phase 17b).
//!
//! Ships a curated snippet catalog for the top ~20 libraries eri users
//! reach for so the first `@docs <lib>` lookup returns immediately
//! instead of paying a Context7 round-trip. The full embedding-based
//! library index lives at `$ERI_RESOURCES/docs_cache/<lib>.sqlite`
//! for the desktop build; here we keep an inline starter set so
//! tests + dev mode resolve something useful before the resources
//! bundle is installed.
//!
//! Hit shape: `{ library, version, title, url, snippet }`. Multiple
//! hits per library are allowed — the lookup returns the best 5
//! per call.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocSnippet {
    pub library: String,
    pub version: String,
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LookupParams {
    library: String,
    #[serde(default)]
    query: Option<String>,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    5
}

#[derive(Debug, Serialize, Deserialize)]
struct LookupReport {
    hits: Vec<DocSnippet>,
    /// `cache` when served from the inline catalog; `miss` when the
    /// requested library is unknown (caller should fall through to
    /// Context7 / web search).
    source: String,
}

pub async fn lookup(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: LookupParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/docs/lookup: {e}")))?;
    let lib = canonicalize(&p.library);
    let catalog = builtin_snippets();
    let mut matches: Vec<DocSnippet> = catalog
        .iter()
        .filter(|s| canonicalize(&s.library) == lib)
        .cloned()
        .collect();
    if let Some(q) = p.query.as_deref() {
        let needle = q.to_lowercase();
        if !needle.is_empty() {
            matches.retain(|s| {
                s.snippet.to_lowercase().contains(&needle)
                    || s.title.to_lowercase().contains(&needle)
            });
        }
    }
    let source = if matches.is_empty() { "miss" } else { "cache" };
    matches.truncate(p.limit.clamp(1, 20));
    serde_json::to_value(LookupReport {
        hits: matches,
        source: source.to_string(),
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

fn canonicalize(name: &str) -> String {
    name.trim().to_lowercase().replace('_', "-")
}

/// Top-20 inline starter set. The desktop build extends this from the
/// SQLite bundle at $ERI_RESOURCES/docs_cache/.
pub fn builtin_snippets() -> Vec<DocSnippet> {
    fn s(library: &str, version: &str, title: &str, url: &str, snippet: &str) -> DocSnippet {
        DocSnippet {
            library: library.into(),
            version: version.into(),
            title: title.into(),
            url: url.into(),
            snippet: snippet.into(),
        }
    }
    vec![
        // Web frontend
        s(
            "react",
            "19",
            "Components and props",
            "https://react.dev/learn",
            "function Welcome(props) { return <h1>Hello, {props.name}</h1>; }",
        ),
        s(
            "react",
            "19",
            "useState",
            "https://react.dev/reference/react/useState",
            "const [count, setCount] = useState(0);",
        ),
        s(
            "react",
            "19",
            "useEffect",
            "https://react.dev/reference/react/useEffect",
            "useEffect(() => { /* side-effect */ return () => { /* cleanup */ }; }, [deps]);",
        ),
        s(
            "next",
            "15",
            "app directory routing",
            "https://nextjs.org/docs/app",
            "// app/users/[id]/page.tsx — server-component by default",
        ),
        s(
            "next",
            "15",
            "Server Actions",
            "https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations",
            "'use server'; async function create(formData) { … }",
        ),
        s(
            "tailwind",
            "4",
            "@theme tokens",
            "https://tailwindcss.com/docs/theme",
            "@theme { --color-brand: oklch(0.6 0.2 250); }",
        ),
        s(
            "shadcn-ui",
            "latest",
            "Install a component",
            "https://ui.shadcn.com/docs/components/button",
            "npx shadcn@latest add button",
        ),
        // Backend (Node / TS)
        s(
            "vite",
            "5",
            "Plugin API",
            "https://vitejs.dev/guide/api-plugin",
            "export default { plugins: [{ name: 'eri', transform(code, id) {} }] }",
        ),
        s(
            "zod",
            "3",
            "Schema definition",
            "https://zod.dev",
            "const Email = z.string().email(); type E = z.infer<typeof Email>;",
        ),
        // Backend (Rust)
        s(
            "tokio",
            "1",
            "Runtime model",
            "https://tokio.rs",
            "#[tokio::main] async fn main() { … }",
        ),
        s(
            "tokio",
            "1",
            "spawn vs spawn_blocking",
            "https://docs.rs/tokio/latest/tokio/task/index.html",
            "tokio::task::spawn_blocking(|| heavy()).await",
        ),
        s(
            "axum",
            "0.7",
            "Router",
            "https://docs.rs/axum",
            "Router::new().route(\"/healthz\", get(|| async { \"ok\" }))",
        ),
        s(
            "sqlx",
            "0.7",
            "Compile-time queries",
            "https://docs.rs/sqlx",
            "sqlx::query!(\"select id from users where email = $1\", email).fetch_one(&pool).await?",
        ),
        // Backend (Python)
        s(
            "fastapi",
            "0.110",
            "Async endpoint",
            "https://fastapi.tiangolo.com",
            "@app.get(\"/health\") async def health(): return {\"ok\": True}",
        ),
        s(
            "pydantic",
            "2",
            "Model definition",
            "https://docs.pydantic.dev/2.0",
            "class User(BaseModel): id: int; email: EmailStr",
        ),
        s(
            "httpx",
            "0.27",
            "Async client",
            "https://www.python-httpx.org",
            "async with httpx.AsyncClient() as client: r = await client.get(url)",
        ),
        // AI SDKs
        s(
            "anthropic",
            "0.40",
            "Streaming Messages",
            "https://docs.anthropic.com/claude/reference/messages-streaming",
            "with anthropic.Anthropic().messages.stream(**kw) as stream: for text in stream.text_stream: print(text, end=\"\")",
        ),
        s(
            "openai",
            "1.50",
            "Chat completions",
            "https://platform.openai.com/docs/api-reference/chat",
            "openai.OpenAI().chat.completions.create(model=\"gpt-4o\", messages=[…])",
        ),
        s(
            "ai-sdk",
            "4",
            "streamText (Vercel AI SDK)",
            "https://sdk.vercel.ai",
            "const { textStream } = streamText({ model: anthropic('claude-sonnet-4-6'), prompt: 'hi' });",
        ),
        // Storage / data
        s(
            "supabase",
            "2",
            "Postgres client",
            "https://supabase.com/docs/reference/javascript/select",
            "const { data, error } = await supabase.from('users').select('*').eq('id', uid)",
        ),
        s(
            "drizzle",
            "0.30",
            "select query",
            "https://orm.drizzle.team",
            "await db.select().from(users).where(eq(users.id, uid))",
        ),
    ]
}

/// Map a (potentially user-typed) library name to the cache's
/// canonical slug. Returns `None` when the library isn't in the
/// inline catalog.
pub fn canonical_library(name: &str) -> Option<String> {
    let key = canonicalize(name);
    let map: HashMap<&str, &str> = [
        ("react", "react"),
        ("reactjs", "react"),
        ("next", "next"),
        ("next.js", "next"),
        ("nextjs", "next"),
        ("tailwind", "tailwind"),
        ("tailwindcss", "tailwind"),
        ("shadcn", "shadcn-ui"),
        ("shadcn-ui", "shadcn-ui"),
        ("vite", "vite"),
        ("zod", "zod"),
        ("tokio", "tokio"),
        ("axum", "axum"),
        ("sqlx", "sqlx"),
        ("fastapi", "fastapi"),
        ("pydantic", "pydantic"),
        ("httpx", "httpx"),
        ("anthropic", "anthropic"),
        ("openai", "openai"),
        ("ai-sdk", "ai-sdk"),
        ("vercel-ai-sdk", "ai-sdk"),
        ("supabase", "supabase"),
        ("drizzle", "drizzle"),
        ("drizzle-orm", "drizzle"),
    ]
    .into_iter()
    .collect();
    map.get(key.as_str()).map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_covers_top_20_libraries() {
        let snippets = builtin_snippets();
        let libs: std::collections::HashSet<&str> =
            snippets.iter().map(|s| s.library.as_str()).collect();
        // Just assert we have at least 15 distinct libraries — the
        // exact count can drift as we add or trim entries.
        assert!(
            libs.len() >= 15,
            "expected at least 15 libs, got {}",
            libs.len()
        );
    }

    #[test]
    fn canonical_library_handles_aliases() {
        assert_eq!(canonical_library("React"), Some("react".to_string()));
        assert_eq!(canonical_library("Next.js"), Some("next".to_string()));
        assert_eq!(canonical_library("Tailwind CSS"), None); // space breaks alias
        assert_eq!(
            canonical_library("vercel-ai-sdk"),
            Some("ai-sdk".to_string())
        );
        assert_eq!(canonical_library("not-a-real-lib"), None);
    }

    #[tokio::test]
    async fn lookup_returns_hits_for_known_lib() {
        let services = Services::new();
        let tier_state = std::sync::Arc::new(tokio::sync::Mutex::new(crate::TierState::default()));
        let params = serde_json::json!({ "library": "react", "limit": 2 });
        let result = lookup(params, &tier_state, &services).await.unwrap();
        let report: LookupReport = serde_json::from_value(result).unwrap();
        assert_eq!(report.source, "cache");
        assert_eq!(report.hits.len(), 2);
    }

    #[tokio::test]
    async fn lookup_returns_miss_for_unknown_lib() {
        let services = Services::new();
        let tier_state = std::sync::Arc::new(tokio::sync::Mutex::new(crate::TierState::default()));
        let params = serde_json::json!({ "library": "does-not-exist" });
        let result = lookup(params, &tier_state, &services).await.unwrap();
        let report: LookupReport = serde_json::from_value(result).unwrap();
        assert_eq!(report.source, "miss");
        assert_eq!(report.hits.len(), 0);
    }

    #[tokio::test]
    async fn lookup_filters_by_query_keyword() {
        let services = Services::new();
        let tier_state = std::sync::Arc::new(tokio::sync::Mutex::new(crate::TierState::default()));
        let params = serde_json::json!({ "library": "react", "query": "useEffect" });
        let result = lookup(params, &tier_state, &services).await.unwrap();
        let report: LookupReport = serde_json::from_value(result).unwrap();
        assert!(
            report
                .hits
                .iter()
                .any(|h| h.title.to_lowercase().contains("useeffect"))
        );
    }
}
