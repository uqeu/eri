//! Error types shared across the MCP crate. One enum for all of: config IO,
//! transport IO, JSON-RPC framing, and server-side JSON-RPC errors. Callers
//! that need to discriminate use `match`; most just bubble via `?`.

use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("failed to spawn MCP server {name}: {source}")]
    ProcessSpawn {
        name: String,
        #[source]
        source: std::io::Error,
    },

    #[error("MCP server {name}: stdio pipe missing")]
    PipeMissing { name: String },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP transport error: {0}")]
    Http(String),

    #[error("JSON encode/decode error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("MCP protocol error: {0}")]
    Protocol(String),

    #[error("MCP server returned error {code}: {message}")]
    ServerError {
        code: i64,
        message: String,
        data: Option<serde_json::Value>,
    },

    #[error("timed out after {0:?} waiting for MCP server response")]
    Timeout(Duration),

    #[error("MCP server {name}: not connected (state={state})")]
    NotConnected { name: String, state: String },

    #[error("could not read MCP config at {path}: {source}")]
    ConfigRead {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("could not parse MCP config at {path}: {source}")]
    ConfigParse {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("unknown handle: {0}")]
    UnknownHandle(String),
}

impl From<reqwest::Error> for McpError {
    fn from(value: reqwest::Error) -> Self {
        McpError::Http(value.to_string())
    }
}
