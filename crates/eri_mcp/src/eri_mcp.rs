//! Minimal MCP (Model Context Protocol) client for eri.
//!
//! Talks JSON-RPC 2.0 over stdio to user-configured MCP servers and exposes a
//! small surface for listing and invoking their tools. The protocol surface is
//! intentionally narrow — eri only needs `initialize`, `tools/list`, and
//! `tools/call` to act as an MCP host. The full spec lives at
//! <https://modelcontextprotocol.io/specification>.
//!
//! Why a hand-rolled client instead of a crate dependency: the dependency
//! surface stays tiny (just `serde_json` + `thiserror`), and the protocol slice
//! we use is small enough that maintaining ~200 LOC is cheaper than tracking an
//! upstream SDK across breaking changes.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const ERI_HOME_DIR: &str = ".eri";
const MCP_CONFIG_FILENAME: &str = "mcp.json";
const PROTOCOL_VERSION: &str = "2024-11-05";
const CLIENT_NAME: &str = "eri";
const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Separator used to namespace MCP tool names so Mercury can disambiguate
/// `<server>__<tool>` (e.g. `github__list_pull_requests`). Double underscore
/// keeps the result a valid identifier for OpenAI-style tool names while
/// staying visually distinct from the underscores most MCP servers already
/// use inside individual tool names.
pub const NAMESPACE_SEPARATOR: &str = "__";

/// Default per-call timeout for MCP tool invocations dispatched on Mercury's
/// behalf. Failures don't crash Mercury — they surface as a JSON error blob
/// the model sees in the next turn so it can recover or apologize.
pub const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("failed to spawn MCP server {name}: {source}")]
    ProcessSpawn {
        name: String,
        #[source]
        source: std::io::Error,
    },
    #[error("MCP server {name} stdio pipe missing")]
    PipeMissing { name: String },
    #[error("I/O error talking to MCP server: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON-RPC encode/decode error: {0}")]
    JsonRpc(#[from] serde_json::Error),
    #[error("MCP protocol error: {0}")]
    ProtocolError(String),
    #[error("MCP server returned error {code}: {message}")]
    ServerError { code: i64, message: String },
    #[error("timed out waiting for MCP server response")]
    Timeout,
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
    #[error("no $HOME — cannot locate ~/.eri/mcp.json")]
    NoHome,
}

/// A single MCP server entry as it appears in `~/.eri/mcp.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct McpConfigFile {
    #[serde(default)]
    servers: Vec<McpServerConfig>,
}

/// A tool exposed by an MCP server. Shape mirrors OpenAI / Anthropic tool-call
/// specs so we can hand `parameters` straight to Mercury's tool API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpToolSpec {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// JSON Schema describing the tool's input arguments.
    #[serde(default = "default_schema")]
    pub parameters: Value,
}

fn default_schema() -> Value {
    json!({"type": "object", "properties": {}})
}

/// Transport abstraction so tests can drive the JSON-RPC framing without
/// actually spawning a child process. Production code uses `StdioTransport`,
/// which wraps the spawned server's stdin/stdout.
pub trait McpTransport {
    fn send_line(&mut self, line: &str) -> Result<(), McpError>;
    fn recv_line(&mut self) -> Result<String, McpError>;
}

pub struct StdioTransport {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl StdioTransport {
    fn new(stdin: ChildStdin, stdout: ChildStdout) -> Self {
        Self {
            stdin,
            stdout: BufReader::new(stdout),
        }
    }
}

impl McpTransport for StdioTransport {
    fn send_line(&mut self, line: &str) -> Result<(), McpError> {
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;
        Ok(())
    }

    fn recv_line(&mut self) -> Result<String, McpError> {
        let mut buf = String::new();
        let n = self.stdout.read_line(&mut buf)?;
        if n == 0 {
            return Err(McpError::ProtocolError(
                "MCP server closed stdout unexpectedly".into(),
            ));
        }
        Ok(buf)
    }
}

/// JSON-RPC envelope. We send notifications (no id) for `initialized` and
/// regular requests (with id) for everything else.
#[derive(Debug, Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<u64>,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<u64>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

pub struct McpClient {
    name: String,
    next_id: AtomicU64,
    transport: Box<dyn McpTransport + Send>,
    // Holding the child keeps the process alive; dropping it sends SIGKILL on
    // Unix. We only take this on the launch() path; `with_transport` (test
    // helper) leaves it None.
    child: Option<Child>,
}

impl McpClient {
    /// Spawn an MCP server subprocess and complete the `initialize` handshake.
    pub fn launch(config: &McpServerConfig) -> Result<Self, McpError> {
        let mut command = Command::new(&config.command);
        command
            .args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Inherit stderr so the user sees server crash output in the
            // terminal — the MCP servers themselves log diagnostics there.
            .stderr(Stdio::inherit());

        let mut child = command
            .spawn()
            .map_err(|source| McpError::ProcessSpawn {
                name: config.name.clone(),
                source,
            })?;

        let stdin = child.stdin.take().ok_or_else(|| McpError::PipeMissing {
            name: config.name.clone(),
        })?;
        let stdout = child.stdout.take().ok_or_else(|| McpError::PipeMissing {
            name: config.name.clone(),
        })?;

        let transport: Box<dyn McpTransport + Send> = Box::new(StdioTransport::new(stdin, stdout));
        let mut client = Self {
            name: config.name.clone(),
            next_id: AtomicU64::new(1),
            transport,
            child: Some(child),
        };
        client.initialize()?;
        Ok(client)
    }

    /// Test seam: build a client from a pre-made transport, skipping the
    /// `initialize` handshake so unit tests can exercise framing in isolation.
    pub fn with_transport(name: impl Into<String>, transport: Box<dyn McpTransport + Send>) -> Self {
        Self {
            name: name.into(),
            next_id: AtomicU64::new(1),
            transport,
            child: None,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    fn initialize(&mut self) -> Result<(), McpError> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {
                "name": CLIENT_NAME,
                "version": CLIENT_VERSION,
            }
        });
        let _ = self.request("initialize", Some(params))?;
        // MCP requires a follow-up `notifications/initialized` notification
        // (no id, no response expected) before any other call is valid.
        self.notify("notifications/initialized", None)?;
        Ok(())
    }

    pub fn list_tools(&mut self) -> Result<Vec<McpToolSpec>, McpError> {
        let result = self.request("tools/list", None)?;
        let tools = result
            .get("tools")
            .ok_or_else(|| McpError::ProtocolError("tools/list missing 'tools' field".into()))?;
        let parsed: Vec<McpToolSpec> = serde_json::from_value(tools.clone())?;
        Ok(parsed)
    }

    pub fn call_tool(&mut self, tool_name: &str, args: Value) -> Result<Value, McpError> {
        let params = json!({
            "name": tool_name,
            "arguments": args,
        });
        self.request("tools/call", Some(params))
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    fn request(&mut self, method: &str, params: Option<Value>) -> Result<Value, McpError> {
        let id = self.next_id();
        let envelope = JsonRpcRequest {
            jsonrpc: "2.0",
            id: Some(id),
            method,
            params,
        };
        let line = serde_json::to_string(&envelope)?;
        self.transport.send_line(&line)?;

        // MCP servers may emit unrelated notifications or log lines on stdout;
        // skip anything that isn't a response to our id. We bound the search so
        // a chatty server can't wedge us forever.
        for _ in 0..64 {
            let raw = self.transport.recv_line()?;
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let response: JsonRpcResponse = serde_json::from_str(trimmed)?;
            if response.id != Some(id) {
                continue;
            }
            if let Some(err) = response.error {
                return Err(McpError::ServerError {
                    code: err.code,
                    message: err.message,
                });
            }
            return Ok(response.result.unwrap_or(Value::Null));
        }
        Err(McpError::Timeout)
    }

    fn notify(&mut self, method: &str, params: Option<Value>) -> Result<(), McpError> {
        let envelope = JsonRpcRequest {
            jsonrpc: "2.0",
            id: None,
            method,
            params,
        };
        let line = serde_json::to_string(&envelope)?;
        self.transport.send_line(&line)
    }

    /// Send `shutdown`, then kill the child if it doesn't exit promptly. Always
    /// consumes `self`; resource cleanup is unconditional.
    pub fn shutdown(mut self) {
        // Best-effort graceful shutdown. Ignore errors — we're tearing down.
        let _ = self.notify("shutdown", None);
        if let Some(mut child) = self.child.take() {
            // Give it a brief window to exit on its own, then kill.
            std::thread::sleep(Duration::from_millis(50));
            match child.try_wait() {
                Ok(Some(_)) => {}
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Resolve `~/.eri/mcp.json`. Returns `None` only if `$HOME` is unset.
pub fn config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(ERI_HOME_DIR).join(MCP_CONFIG_FILENAME))
}

/// Read `~/.eri/mcp.json`. If it doesn't exist, write a commented default
/// scaffold and return an empty server list — first-run UX is "the file
/// appears, with examples, ready for the user to uncomment".
pub fn load_user_config() -> Result<Vec<McpServerConfig>, McpError> {
    let path = config_path().ok_or(McpError::NoHome)?;
    load_config_from(&path)
}

/// Same as `load_user_config` but for a specific path — used by tests and the
/// `list_tools` example.
pub fn load_config_from(path: &std::path::Path) -> Result<Vec<McpServerConfig>, McpError> {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|source| McpError::ConfigRead {
                path: path.to_path_buf(),
                source,
            })?;
        }
        std::fs::write(path, DEFAULT_CONFIG_SCAFFOLD).map_err(|source| McpError::ConfigRead {
            path: path.to_path_buf(),
            source,
        })?;
        return Ok(Vec::new());
    }

    let raw = std::fs::read_to_string(path).map_err(|source| McpError::ConfigRead {
        path: path.to_path_buf(),
        source,
    })?;
    parse_config(&raw, path)
}

fn parse_config(raw: &str, path: &std::path::Path) -> Result<Vec<McpServerConfig>, McpError> {
    let stripped = strip_json_comments(raw);
    // Treat empty / whitespace-only files (and files that are all comments)
    // as "no servers configured" rather than a parse error.
    if stripped.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parsed: McpConfigFile =
        serde_json::from_str(&stripped).map_err(|source| McpError::ConfigParse {
            path: path.to_path_buf(),
            source,
        })?;
    Ok(parsed.servers)
}

/// Strip `/* ... */` and `// ...` JSON comments so the scaffold file (which has
/// commented-out example servers) parses cleanly. Naive scanner — does not
/// understand comment markers inside string literals, which is fine for the
/// shapes we accept here (no MCP server name realistically contains `/*` or
/// `//`).
fn strip_json_comments(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    let mut in_string = false;
    let mut escape = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            out.push(b as char);
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if b == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }
        if b == b'/' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'/' => {
                    while i < bytes.len() && bytes[i] != b'\n' {
                        i += 1;
                    }
                    continue;
                }
                b'*' => {
                    i += 2;
                    while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                        i += 1;
                    }
                    i = (i + 2).min(bytes.len());
                    continue;
                }
                _ => {}
            }
        }
        out.push(b as char);
        i += 1;
    }
    out
}

const DEFAULT_CONFIG_SCAFFOLD: &str = r#"{
  "servers": [
    /* {"name": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": {"GITHUB_TOKEN": "..."}}, */
    /* {"name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Desktop"], "env": {}} */
  ]
}
"#;

/// Fully-namespaced tool spec — what Mercury sees in the `tools` array.
/// The `name` is `<server>__<tool>` so the dispatch path can split on
/// [`NAMESPACE_SEPARATOR`] and route the call back to the originating server
/// without re-running `tools/list`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NamespacedTool {
    pub name: String,
    pub server: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_schema")]
    pub parameters: Value,
}

impl NamespacedTool {
    /// Split a namespaced tool name back into `(server, tool)`. Returns
    /// `None` if the name doesn't carry the expected `<server>__<tool>`
    /// shape — callers treat that as "not an MCP tool" and fall through to
    /// whatever local tool handler matches (e.g. `edit_html`).
    pub fn split_name(namespaced: &str) -> Option<(&str, &str)> {
        let separator = NAMESPACE_SEPARATOR;
        let idx = namespaced.find(separator)?;
        let server = &namespaced[..idx];
        let tool = &namespaced[idx + separator.len()..];
        if server.is_empty() || tool.is_empty() {
            return None;
        }
        Some((server, tool))
    }

    /// Compose `<server>__<tool>` without allocating intermediates.
    pub fn make_name(server: &str, tool: &str) -> String {
        format!("{server}{NAMESPACE_SEPARATOR}{tool}")
    }
}

/// Factory for creating fresh `McpClient` instances from a config. Lifted to
/// a trait so unit tests can inject mock clients without spawning real
/// subprocesses. Production code uses [`SpawnLauncher`].
pub trait McpLauncher: Send + Sync {
    fn launch(&self, config: &McpServerConfig) -> Result<McpClient, McpError>;
}

pub struct SpawnLauncher;

impl McpLauncher for SpawnLauncher {
    fn launch(&self, config: &McpServerConfig) -> Result<McpClient, McpError> {
        McpClient::launch(config)
    }
}

/// Lazy-launching pool of MCP clients. One subprocess per configured server,
/// spawned on first call. Holds `list_tools` results in memory so Mercury's
/// payload builder can splat them into `tools` without round-tripping.
///
/// The pool is intentionally synchronous: MCP transport is line-oriented JSON
/// on a child's stdio pipe, and eri's caller wraps the whole call in
/// `cx.background_spawn` so blocking is fine.
pub struct McpClientPool {
    configs: Vec<McpServerConfig>,
    clients: HashMap<String, McpClient>,
    cached_tools: HashMap<String, Vec<McpToolSpec>>,
    launcher: Box<dyn McpLauncher>,
}

impl std::fmt::Debug for McpClientPool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpClientPool")
            .field("configs", &self.configs.iter().map(|c| &c.name).collect::<Vec<_>>())
            .field("connected", &self.clients.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl McpClientPool {
    /// Build a pool from the user's `~/.eri/mcp.json`. Returns an empty pool
    /// (no error) when the config has no servers; the caller renders that as
    /// "no MCP tools available" rather than failing.
    pub fn from_user_config() -> Result<Self, McpError> {
        let configs = load_user_config()?;
        Ok(Self::from_configs(configs))
    }

    pub fn from_configs(configs: Vec<McpServerConfig>) -> Self {
        Self {
            configs,
            clients: HashMap::new(),
            cached_tools: HashMap::new(),
            launcher: Box::new(SpawnLauncher),
        }
    }

    /// Test seam: swap in a launcher that fabricates `McpClient`s from mock
    /// transports so the pool can be exercised without spawning subprocesses.
    pub fn with_launcher(mut self, launcher: Box<dyn McpLauncher>) -> Self {
        self.launcher = launcher;
        self
    }

    pub fn server_names(&self) -> Vec<String> {
        self.configs.iter().map(|c| c.name.clone()).collect()
    }

    fn ensure_client(&mut self, server: &str) -> Result<&mut McpClient, McpError> {
        if !self.clients.contains_key(server) {
            let config = self
                .configs
                .iter()
                .find(|c| c.name == server)
                .ok_or_else(|| {
                    McpError::ProtocolError(format!("no MCP server named {server} in config"))
                })?
                .clone();
            let client = self.launcher.launch(&config)?;
            self.clients.insert(server.to_string(), client);
        }
        self.clients
            .get_mut(server)
            .ok_or_else(|| McpError::ProtocolError(format!("client {server} disappeared")))
    }

    fn list_tools_cached(&mut self, server: &str) -> Result<Vec<McpToolSpec>, McpError> {
        if let Some(cached) = self.cached_tools.get(server) {
            return Ok(cached.clone());
        }
        let client = self.ensure_client(server)?;
        let tools = client.list_tools()?;
        self.cached_tools.insert(server.to_string(), tools.clone());
        Ok(tools)
    }

    /// Collect every configured server's tools into a single flat list, with
    /// each tool's name rewritten to `<server>__<tool>`. Errors on one server
    /// are logged and skipped — partial availability is still better than
    /// nothing, and Mercury never sees a tool that won't actually dispatch.
    pub fn all_tools(&mut self) -> Vec<NamespacedTool> {
        let mut out = Vec::new();
        let names = self.server_names();
        for server in &names {
            match self.list_tools_cached(server) {
                Ok(tools) => {
                    for tool in tools {
                        out.push(NamespacedTool {
                            name: NamespacedTool::make_name(server, &tool.name),
                            server: server.clone(),
                            description: tool.description,
                            parameters: tool.parameters,
                        });
                    }
                }
                Err(error) => {
                    log::warn!(
                        "[eri.mcp] list_tools failed for server {server}: {error} — \
                         skipping this server's tools for this fire"
                    );
                }
            }
        }
        out
    }

    /// Dispatch a Mercury-issued tool call. `namespaced_name` is the full
    /// `<server>__<tool>` string Mercury emitted; `args` are the tool-call
    /// arguments as Mercury serialized them. Always returns SOME value —
    /// failures are wrapped as `{"error": "..."}` so Mercury can read the
    /// error in its next turn and recover instead of stalling.
    pub fn call(&mut self, namespaced_name: &str, args: Value) -> Value {
        let Some((server, tool)) = NamespacedTool::split_name(namespaced_name) else {
            return error_value(format!(
                "tool name {namespaced_name:?} is not in <server>__<tool> form"
            ));
        };
        let server = server.to_string();
        let tool = tool.to_string();
        match self.ensure_client(&server) {
            Ok(client) => match client.call_tool(&tool, args) {
                Ok(value) => value,
                Err(error) => error_value(format!("MCP call {namespaced_name}: {error}")),
            },
            Err(error) => error_value(format!("MCP server {server}: {error}")),
        }
    }

    /// Tear down every connected client. Called when the panel is dropped or
    /// when the user issues `ReloadMcpConfig` so the next fire reconnects.
    pub fn shutdown_all(&mut self) {
        let clients = std::mem::take(&mut self.clients);
        for (_, client) in clients {
            client.shutdown();
        }
        self.cached_tools.clear();
    }
}

impl Drop for McpClientPool {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

fn error_value(message: impl Into<String>) -> Value {
    json!({ "error": message.into() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    #[derive(Default, Clone)]
    struct MockTransport {
        sent: Arc<Mutex<Vec<String>>>,
        recv_queue: Arc<Mutex<VecDeque<String>>>,
    }

    impl MockTransport {
        fn push_response(&self, line: impl Into<String>) {
            self.recv_queue.lock().unwrap().push_back(line.into());
        }

        fn sent_lines(&self) -> Vec<String> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl McpTransport for MockTransport {
        fn send_line(&mut self, line: &str) -> Result<(), McpError> {
            self.sent.lock().unwrap().push(line.to_string());
            Ok(())
        }

        fn recv_line(&mut self) -> Result<String, McpError> {
            self.recv_queue
                .lock()
                .unwrap()
                .pop_front()
                .map(|line| {
                    let mut line = line;
                    if !line.ends_with('\n') {
                        line.push('\n');
                    }
                    line
                })
                .ok_or_else(|| McpError::ProtocolError("mock: no more responses queued".into()))
        }
    }

    #[test]
    fn json_rpc_request_framing_includes_id_and_method() {
        let transport = MockTransport::default();
        transport.push_response(r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#);
        let mut client = McpClient::with_transport("test", Box::new(transport.clone()));

        let tools = client.list_tools().expect("list_tools should succeed");
        assert!(tools.is_empty());

        let sent = transport.sent_lines();
        assert_eq!(sent.len(), 1, "expected exactly one outbound JSON-RPC line");
        let parsed: Value = serde_json::from_str(sent[0].trim()).expect("valid JSON envelope");
        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["method"], "tools/list");
        assert!(parsed["id"].is_u64(), "request must carry numeric id");
    }

    #[test]
    fn list_tools_parses_response_into_tool_specs() {
        let transport = MockTransport::default();
        transport.push_response(
            r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[
                {"name":"create_issue","description":"Open a GitHub issue","inputSchema":{"type":"object"}},
                {"name":"list_repos","description":"List repos","parameters":{"type":"object","properties":{"org":{"type":"string"}}}}
            ]}}"#,
        );
        let mut client = McpClient::with_transport("github", Box::new(transport));
        let tools = client.list_tools().expect("parses");

        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "create_issue");
        assert_eq!(tools[0].description, "Open a GitHub issue");
        assert_eq!(tools[1].name, "list_repos");
        // Tools that omit `parameters` fall back to the empty-object schema so
        // Mercury never sees a missing field.
        assert_eq!(tools[0].parameters, default_schema());
    }

    #[test]
    fn call_tool_propagates_server_error() {
        let transport = MockTransport::default();
        transport.push_response(
            r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}"#,
        );
        let mut client = McpClient::with_transport("test", Box::new(transport));
        let err = client
            .call_tool("unknown", json!({}))
            .expect_err("server error should propagate");
        match err {
            McpError::ServerError { code, message } => {
                assert_eq!(code, -32601);
                assert_eq!(message, "method not found");
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn unrelated_responses_are_skipped_until_matching_id() {
        let transport = MockTransport::default();
        // Server emits a stray notification (no id) and a response to an older
        // id before the one we're waiting for. Both should be skipped.
        transport.push_response(r#"{"jsonrpc":"2.0","method":"log/message","params":{"text":"hi"}}"#);
        transport.push_response(r#"{"jsonrpc":"2.0","id":999,"result":{}}"#);
        transport.push_response(r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#);
        let mut client = McpClient::with_transport("test", Box::new(transport));
        let tools = client.list_tools().expect("should skip noise");
        assert!(tools.is_empty());
    }

    #[test]
    fn parse_config_reads_documented_schema() {
        let raw = r#"{
            "servers": [
                {
                    "name": "github",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {"GITHUB_TOKEN": "abc"}
                },
                {
                    "name": "filesystem",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
                }
            ]
        }"#;
        let servers = parse_config(raw, std::path::Path::new("test.json")).expect("parses");
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "github");
        assert_eq!(servers[0].command, "npx");
        assert_eq!(servers[0].env.get("GITHUB_TOKEN"), Some(&"abc".to_string()));
        assert_eq!(servers[1].name, "filesystem");
        // `env` defaulted to empty map when omitted.
        assert!(servers[1].env.is_empty());
    }

    #[test]
    fn parse_config_strips_json_comments_in_scaffold() {
        let servers = parse_config(DEFAULT_CONFIG_SCAFFOLD, std::path::Path::new("scaffold.json"))
            .expect("scaffold parses");
        assert!(
            servers.is_empty(),
            "scaffold comments-out every entry; should parse as empty"
        );
    }

    #[test]
    fn server_config_round_trips_through_serde() {
        let config = McpServerConfig {
            name: "linear".into(),
            command: "node".into(),
            args: vec!["server.js".into()],
            env: HashMap::from([("LINEAR_KEY".to_string(), "k".to_string())]),
        };
        let json = serde_json::to_string(&config).unwrap();
        let back: McpServerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, back);
    }

    #[test]
    fn load_config_from_creates_scaffold_when_missing() {
        let tmp = tempdir_in_target();
        let path = tmp.join("mcp.json");
        assert!(!path.exists());

        let servers = load_config_from(&path).expect("creates scaffold");
        assert!(servers.is_empty());
        assert!(path.exists(), "scaffold should be written on first read");

        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("\"servers\""));
        // Cleanup.
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(tmp);
    }

    fn tempdir_in_target() -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("eri_mcp_test_{}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    /// A launcher that hands out pre-canned `MockTransport`s so the pool can
    /// be tested without spawning subprocesses. Each call to `launch` pops
    /// the next mock transport off the queue and returns a fresh
    /// `McpClient` wrapping it.
    struct MockLauncher {
        next: Arc<Mutex<VecDeque<MockTransport>>>,
    }

    impl MockLauncher {
        fn new() -> Self {
            Self {
                next: Arc::new(Mutex::new(VecDeque::new())),
            }
        }

        fn enqueue(&self, transport: MockTransport) {
            self.next.lock().unwrap().push_back(transport);
        }
    }

    impl McpLauncher for MockLauncher {
        fn launch(&self, config: &McpServerConfig) -> Result<McpClient, McpError> {
            let transport = self
                .next
                .lock()
                .unwrap()
                .pop_front()
                .ok_or_else(|| McpError::ProtocolError("mock launcher exhausted".into()))?;
            Ok(McpClient::with_transport(config.name.clone(), Box::new(transport)))
        }
    }

    fn make_pool_with_two_mock_servers() -> McpClientPool {
        // Two configured servers: `github` (returns one tool: `list_prs`) and
        // `filesystem` (returns one tool: `read_file`). Each mock transport is
        // primed with one `tools/list` response.
        let github = MockTransport::default();
        github.push_response(
            r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[
                {"name":"list_prs","description":"List open PRs","inputSchema":{"type":"object"}}
            ]}}"#,
        );
        let filesystem = MockTransport::default();
        filesystem.push_response(
            r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[
                {"name":"read_file","description":"Read a file","inputSchema":{"type":"object"}}
            ]}}"#,
        );
        let launcher = MockLauncher::new();
        launcher.enqueue(github);
        launcher.enqueue(filesystem);

        let configs = vec![
            McpServerConfig {
                name: "github".into(),
                command: "_".into(),
                args: vec![],
                env: HashMap::new(),
            },
            McpServerConfig {
                name: "filesystem".into(),
                command: "_".into(),
                args: vec![],
                env: HashMap::new(),
            },
        ];
        McpClientPool::from_configs(configs).with_launcher(Box::new(launcher))
    }

    #[test]
    fn mcp_tools_are_namespaced_with_server_prefix() {
        let mut pool = make_pool_with_two_mock_servers();
        let tools = pool.all_tools();

        assert_eq!(tools.len(), 2, "expected two tools, one per server");
        // Tools are flattened in server order so callers can rely on stable
        // payload ordering when Mercury sees the array.
        assert_eq!(tools[0].name, "github__list_prs");
        assert_eq!(tools[0].server, "github");
        assert_eq!(tools[1].name, "filesystem__read_file");
        assert_eq!(tools[1].server, "filesystem");
    }

    #[test]
    fn namespaced_split_round_trips_through_double_underscore() {
        let name = NamespacedTool::make_name("github", "list_pull_requests");
        assert_eq!(name, "github__list_pull_requests");
        let (server, tool) = NamespacedTool::split_name(&name).expect("splits");
        assert_eq!(server, "github");
        assert_eq!(tool, "list_pull_requests");
    }

    #[test]
    fn split_rejects_names_without_namespace_separator() {
        assert!(NamespacedTool::split_name("edit_html").is_none());
        // An empty server (`__foo`) or an empty tool (`foo__`) is also not a
        // valid namespaced reference.
        assert!(NamespacedTool::split_name("__list_prs").is_none());
        assert!(NamespacedTool::split_name("github__").is_none());
    }

    #[test]
    fn pool_call_returns_error_blob_when_server_missing() {
        let mut pool = McpClientPool::from_configs(Vec::new());
        let value = pool.call("ghost__do_thing", json!({}));
        assert!(
            value.get("error").is_some(),
            "missing server must surface as JSON error blob, not a crash"
        );
    }

    #[test]
    fn pool_call_returns_error_blob_when_name_is_not_namespaced() {
        let mut pool = McpClientPool::from_configs(Vec::new());
        let value = pool.call("not_namespaced", json!({}));
        assert!(value.get("error").is_some());
    }
}
