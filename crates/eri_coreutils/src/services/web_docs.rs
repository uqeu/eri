//! Stubs for `eri/web/search` and `eri/docs/fetch`. The IDE's @-mention
//! resolvers already call these; returning structured stub responses keeps
//! the wire contract stable so the extension never sees "method not found"
//! when a user mentions `@web` or `@docs`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::DispatchError;
use crate::services::Services;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchParams {
    #[allow(dead_code)]
    query: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct DocsFetchParams {
    #[allow(dead_code)]
    url: Option<String>,
    #[allow(dead_code)]
    name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchResult {
    results: Vec<Value>,
    note: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocsFetchResult {
    body: &'static str,
    note: &'static str,
}

pub async fn web_search(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    // Parse to validate shape but otherwise discard — stub.
    let _p: WebSearchParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    serde_json::to_value(WebSearchResult {
        results: Vec::new(),
        note: "Web search not yet wired",
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn docs_fetch(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let _p: DocsFetchParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    serde_json::to_value(DocsFetchResult {
        body: "",
        note: "Docs fetch not yet wired",
    })
    .map_err(|e| DispatchError::Other(e.into()))
}
