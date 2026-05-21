//! JSON-RPC 2.0 envelope plus the slice of MCP message types this crate
//! consumes (initialize, tools/list, tools/call, resources/list,
//! resources/read, ping). We deliberately stay loose with `serde_json::Value`
//! for payload fields the IDE doesn't need to interpret — that way a server
//! returning extra spec fields still parses.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const JSONRPC_VERSION: &str = "2.0";
/// MCP protocol revision we advertise. Spec is versioned by date string.
pub const PROTOCOL_VERSION: &str = "2025-03-26";
pub const CLIENT_NAME: &str = "eri";
pub const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A JSON-RPC message arriving from the server. Could be a response to one
/// of our requests, a request from the server (sampling/roots queries), or
/// a notification (progress, logs).
///
/// We can't use `#[serde(untagged)]` here — both Response and Request carry
/// an `id`, and untagged variants are tried in declaration order with the
/// first successful parse winning, so a Request-shaped frame would be
/// misclassified as a Response (`result`/`error` are Option so they don't
/// disambiguate). Instead we route on the presence of `method`.
#[derive(Debug)]
pub enum IncomingMessage {
    Response(JsonRpcResponse),
    Request(JsonRpcRequest),
    Notification(JsonRpcNotification),
}

impl<'de> Deserialize<'de> for IncomingMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let has_method = value.get("method").is_some();
        let has_id = value.get("id").is_some();
        if has_method && has_id {
            JsonRpcRequest::deserialize(value)
                .map(IncomingMessage::Request)
                .map_err(serde::de::Error::custom)
        } else if has_method {
            JsonRpcNotification::deserialize(value)
                .map(IncomingMessage::Notification)
                .map_err(serde::de::Error::custom)
        } else {
            JsonRpcResponse::deserialize(value)
                .map(IncomingMessage::Response)
                .map_err(serde::de::Error::custom)
        }
    }
}

/// Generic outbound envelope used for both requests and notifications. We
/// keep `id` optional: present for requests, omitted for notifications.
#[derive(Debug, Serialize)]
pub struct OutgoingMessage<'a> {
    pub jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    pub method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl<'a> OutgoingMessage<'a> {
    pub fn request(id: u64, method: &'a str, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION,
            id: Some(id),
            method,
            params,
        }
    }

    pub fn notification(method: &'a str, params: Option<Value>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION,
            id: None,
            method,
            params,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcResponse {
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    pub id: Value,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<JsonRpcErrorPayload>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcRequest {
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcNotification {
    #[allow(dead_code)]
    pub jsonrpc: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcErrorPayload {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

// ---------- MCP-specific payloads ----------

/// Capabilities we advertise to servers during `initialize`. Conservative
/// defaults — we don't expose roots or sampling yet. Expanding this only
/// requires populating the relevant struct field, no protocol surgery.
#[derive(Debug, Clone, Serialize, Default)]
pub struct ClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<RootsCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experimental: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct RootsCapability {
    #[serde(rename = "listChanged")]
    pub list_changed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientInfo {
    pub name: &'static str,
    pub version: &'static str,
}

impl Default for ClientInfo {
    fn default() -> Self {
        Self {
            name: CLIENT_NAME,
            version: CLIENT_VERSION,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: &'static str,
    pub capabilities: ClientCapabilities,
    #[serde(rename = "clientInfo")]
    pub client_info: ClientInfo,
}

impl Default for InitializeParams {
    fn default() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            capabilities: ClientCapabilities::default(),
            client_info: ClientInfo::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct InitializeResult {
    #[serde(default, rename = "protocolVersion")]
    pub protocol_version: Option<String>,
    #[serde(default)]
    pub capabilities: Value,
    #[serde(default, rename = "serverInfo")]
    pub server_info: Option<ServerInfo>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ServerInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ListToolsResult {
    #[serde(default)]
    pub tools: Vec<ToolDefinition>,
    #[serde(default, rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ToolDefinition {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// JSON Schema for the tool's arguments. Servers spell this either as
    /// `inputSchema` (spec-correct) or `parameters` (older Anthropic SDKs).
    /// We accept both.
    #[serde(default, rename = "inputSchema", alias = "parameters")]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ListResourcesResult {
    #[serde(default)]
    pub resources: Vec<ResourceDefinition>,
    #[serde(default, rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ResourceDefinition {
    pub uri: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "mimeType")]
    pub mime_type: Option<String>,
}

/// Content block returned in either `tools/call` results or `resources/read`
/// payloads. We keep the JSON shape — UI code rendering this only needs to
/// inspect `type` and pick text/image/resource accordingly.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
    Resource {
        resource: Value,
    },
    /// Forward-compatible fallback so unknown content kinds don't crash the
    /// parser; the raw JSON is preserved for callers that want to render it.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct CallToolResult {
    #[serde(default)]
    pub content: Vec<ContentBlock>,
    /// Spec field: server signals tool-level (not transport) failure. JSON-RPC
    /// `error` is reserved for transport / protocol problems.
    #[serde(default, rename = "isError")]
    pub is_error: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ReadResourceResult {
    #[serde(default)]
    pub contents: Vec<ResourceContentBlock>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ResourceContentBlock {
    pub uri: String,
    #[serde(default, rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    /// Base64-encoded binary content for non-text resources.
    #[serde(default)]
    pub blob: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outgoing_request_omits_id_for_notifications() {
        let req = OutgoingMessage::request(1, "tools/list", None);
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["jsonrpc"], "2.0");
        assert_eq!(json["id"], 1);

        let note = OutgoingMessage::notification("notifications/initialized", None);
        let json = serde_json::to_value(&note).unwrap();
        assert!(json.get("id").is_none(), "notifications must not carry id");
    }

    #[test]
    fn incoming_message_routes_response_vs_request_vs_notification() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        match serde_json::from_str::<IncomingMessage>(raw).unwrap() {
            IncomingMessage::Response(_) => {}
            _ => panic!("expected Response variant"),
        }

        let raw = r#"{"jsonrpc":"2.0","id":2,"method":"sampling/createMessage","params":{}}"#;
        match serde_json::from_str::<IncomingMessage>(raw).unwrap() {
            IncomingMessage::Request(_) => {}
            _ => panic!("expected Request variant"),
        }

        let raw = r#"{"jsonrpc":"2.0","method":"notifications/progress","params":{}}"#;
        match serde_json::from_str::<IncomingMessage>(raw).unwrap() {
            IncomingMessage::Notification(_) => {}
            _ => panic!("expected Notification variant"),
        }
    }

    #[test]
    fn tool_definition_accepts_input_schema_or_parameters_alias() {
        let raw = r#"{"name":"a","description":"d","inputSchema":{"type":"object"}}"#;
        let parsed: ToolDefinition = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.name, "a");
        assert_eq!(parsed.input_schema["type"], "object");

        let raw = r#"{"name":"b","parameters":{"type":"object"}}"#;
        let parsed: ToolDefinition = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.input_schema["type"], "object");
    }

    #[test]
    fn content_block_deserializes_text_and_image() {
        let raw = r#"[{"type":"text","text":"hi"},{"type":"image","data":"AAA","mimeType":"image/png"}]"#;
        let parsed: Vec<ContentBlock> = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.len(), 2);
        match &parsed[0] {
            ContentBlock::Text { text } => assert_eq!(text, "hi"),
            _ => panic!("expected Text"),
        }
        match &parsed[1] {
            ContentBlock::Image { mime_type, .. } => assert_eq!(mime_type, "image/png"),
            _ => panic!("expected Image"),
        }
    }
}
