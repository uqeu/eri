//! MCP server configuration loader.
//!
//! Format mirrors Claude Desktop and Cursor's `mcp.json` so users can paste
//! the same blob across tools. We accept both the canonical `mcpServers`
//! object and the older `servers` array shape — the former is what every
//! ecosystem doc points at in 2025+.
//!
//! Lookup order:
//!   1. `<workspace>/.eri/mcp.json` — project-scoped, takes precedence
//!   2. `~/.eri/mcp.json` — user-global
//!
//! When both exist, project entries override global entries by server name.
//! Disabled entries (`"disabled": true`) are kept in the parsed result so the
//! UI can show them but [`active_servers`] filters them out for the client.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::McpError;

pub const ERI_DIR: &str = ".eri";
pub const CONFIG_FILE: &str = "mcp.json";

/// Transport selector. Stdio is the default since most public MCP servers
/// ship as npm/pip executables that talk over a child's stdio pipe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TransportKind {
    #[default]
    Stdio,
    /// Streamable HTTP — POST JSON-RPC, receive SSE.
    Http,
}

/// A single MCP server entry. Field set is the union of Claude Desktop and
/// Cursor schemas so an existing `mcp.json` from either tool loads as-is.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ServerConfig {
    /// Server name, used to namespace tools and surface status in the UI.
    /// Populated from the surrounding object key when the config uses the
    /// `mcpServers` map shape.
    #[serde(default)]
    pub name: String,

    /// Stdio: executable to spawn (`npx`, `node`, `uvx`, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,

    /// Stdio: arguments to the executable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,

    /// Stdio: environment variables passed to the child.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,

    /// HTTP: endpoint URL. Presence here implies HTTP transport unless
    /// [`transport`] explicitly says otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// HTTP: extra headers (auth tokens, etc).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,

    /// Explicit transport override. If absent we infer from `url` vs `command`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<TransportKind>,

    /// Per-server kill switch. Skipped when launching the pool, but kept in
    /// listings so the UI can render a disabled badge.
    #[serde(default)]
    pub disabled: bool,
}

impl ServerConfig {
    /// Resolve which transport this entry wants, after defaults are applied.
    pub fn resolved_transport(&self) -> TransportKind {
        if let Some(t) = self.transport {
            return t;
        }
        if self.url.is_some() {
            TransportKind::Http
        } else {
            TransportKind::Stdio
        }
    }

    /// Expand `${VAR}` references in `url`, `headers`, `env`, `args`, and
    /// `command` against `vars` first, then the process environment. Returns a
    /// **new** config (immutable) — the on-disk one keeps the `${…}` placeholders.
    ///
    /// This is what lets a remote MCP server reference secrets + per-user values
    /// without writing them to disk: e.g. Composio's URL
    /// `…/v3/mcp/${COMPOSIO_SERVER_ID}?user_id=${ERI_USER_ID}` and header
    /// `x-api-key: ${COMPOSIO_API_KEY}` — the api key comes from the environment,
    /// the per-user id is injected at launch via `vars`.
    ///
    /// **Fail-closed:** a referenced variable with no value is an error, never a
    /// silently-passed literal `${…}` (which would leak the placeholder or send a
    /// broken credential).
    pub fn expand(&self, vars: &BTreeMap<String, String>) -> Result<ServerConfig, McpError> {
        let lookup = |name: &str| -> Option<String> {
            vars.get(name)
                .cloned()
                .or_else(|| std::env::var(name).ok())
        };
        let exp = |s: &str| expand_vars(s, &self.name, &lookup);

        let command = self.command.as_deref().map(exp).transpose()?;
        let url = self.url.as_deref().map(exp).transpose()?;
        let args = self.args.iter().map(|a| exp(a)).collect::<Result<_, _>>()?;
        let env = self
            .env
            .iter()
            .map(|(k, v)| Ok((k.clone(), exp(v)?)))
            .collect::<Result<_, McpError>>()?;
        let headers = self
            .headers
            .iter()
            .map(|(k, v)| Ok((k.clone(), exp(v)?)))
            .collect::<Result<_, McpError>>()?;

        Ok(ServerConfig {
            name: self.name.clone(),
            command,
            args,
            env,
            url,
            headers,
            transport: self.transport,
            disabled: self.disabled,
        })
    }
}

/// Substitute every `${VAR}` in `s` using `lookup`, leaving all other text
/// (including a lone `$` or `${` with no closing brace) untouched. `server` names
/// the config for a clear error. Pure — the env/vars source is the closure.
pub(crate) fn expand_vars(
    s: &str,
    server: &str,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Result<String, McpError> {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                let name = &after[..end];
                let value = lookup(name).ok_or_else(|| McpError::UnsetVariable {
                    server: server.to_string(),
                    name: name.to_string(),
                })?;
                out.push_str(&value);
                rest = &after[end + 1..];
            }
            // No closing brace — emit the literal "${" and continue past it so we
            // don't loop forever on a malformed string.
            None => {
                out.push_str("${");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}

/// On-disk shapes we accept. Both Claude Desktop and Cursor use the
/// `mcpServers` object map; the array form is legacy from eri's first cut and
/// some community tools still emit it.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ConfigFile {
    #[serde(rename = "mcpServers")]
    mcp_servers: BTreeMap<String, ServerConfig>,
    /// Legacy array shape: `{"servers": [{"name": "..."}, ...]}`.
    servers: Vec<ServerConfig>,
}

/// Read `<workspace>/.eri/mcp.json` (if any) and `~/.eri/mcp.json` (if any),
/// merging with the project file taking precedence on name collisions.
/// Returns an empty list — never an error — when neither file exists.
pub fn load(workspace: &Path) -> Result<Vec<ServerConfig>, McpError> {
    let mut merged: BTreeMap<String, ServerConfig> = BTreeMap::new();

    if let Some(global_path) = global_path()
        && global_path.exists()
    {
        for server in load_file(&global_path)? {
            merged.insert(server.name.clone(), server);
        }
    }

    // Plugin-bundled servers: `<workspace>/.eri/plugins/<name>/mcp.json`. Sit
    // between global and project precedence so a project file still wins.
    for plugin_cfg in plugin_config_files(workspace) {
        for server in load_file(&plugin_cfg)? {
            merged.insert(server.name.clone(), server);
        }
    }

    let project_path = workspace.join(ERI_DIR).join(CONFIG_FILE);
    if project_path.exists() {
        for server in load_file(&project_path)? {
            merged.insert(server.name.clone(), server);
        }
    }

    Ok(merged.into_values().collect())
}

/// `mcp.json` files bundled by plugins, sorted by plugin name for determinism:
/// `<workspace>/.eri/plugins/<name>/mcp.json`.
fn plugin_config_files(workspace: &Path) -> Vec<PathBuf> {
    let plugins_dir = workspace.join(ERI_DIR).join("plugins");
    let Ok(rd) = std::fs::read_dir(&plugins_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = rd
        .filter_map(std::result::Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .map(|p| p.join(CONFIG_FILE))
        .filter(|p| p.is_file())
        .collect();
    files.sort();
    files
}

/// Filter to enabled entries only. The `Mcp` client uses this; the UI uses
/// the full list returned by [`load`].
pub fn active_servers(all: &[ServerConfig]) -> Vec<ServerConfig> {
    all.iter().filter(|s| !s.disabled).cloned().collect()
}

/// Path of the user-global config under `$HOME/.eri/mcp.json`.
pub fn global_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(ERI_DIR).join(CONFIG_FILE))
}

fn load_file(path: &Path) -> Result<Vec<ServerConfig>, McpError> {
    let raw = std::fs::read_to_string(path).map_err(|source| McpError::ConfigRead {
        path: path.to_path_buf(),
        source,
    })?;
    parse(&raw, path)
}

pub(crate) fn parse(raw: &str, path: &Path) -> Result<Vec<ServerConfig>, McpError> {
    let stripped = strip_json_comments(raw);
    if stripped.trim().is_empty() {
        return Ok(Vec::new());
    }
    let file: ConfigFile =
        serde_json::from_str(&stripped).map_err(|source| McpError::ConfigParse {
            path: path.to_path_buf(),
            source,
        })?;

    let mut out: Vec<ServerConfig> =
        Vec::with_capacity(file.mcp_servers.len() + file.servers.len());

    // Populate name from the map key, preserving any explicit name set in the
    // value (the map key wins on disagreement — that's the visible identity).
    for (name, mut server) in file.mcp_servers {
        server.name = name;
        out.push(server);
    }
    for server in file.servers {
        if server.name.is_empty() {
            return Err(McpError::ConfigParse {
                path: path.to_path_buf(),
                source: serde::de::Error::custom(
                    "entries in legacy `servers` array require a `name` field",
                ),
            });
        }
        out.push(server);
    }
    Ok(out)
}

/// Strip `//` line and `/* */` block comments. JSON spec doesn't allow them
/// but every editor mcp.json in the wild has them, and Claude Desktop tolerates
/// the syntax too. Naive scanner — doesn't track comment markers inside
/// strings, which is fine for these shapes.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name: &str| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        }
    }

    #[test]
    fn expand_vars_substitutes_and_preserves_literals() {
        let l = lookup(&[("A", "x"), ("B", "y")]);
        assert_eq!(expand_vars("${A}/${B}", "s", &l).unwrap(), "x/y");
        assert_eq!(expand_vars("no vars here", "s", &l).unwrap(), "no vars here");
        // A lone "${" with no closing brace is left literal, not an infinite loop.
        assert_eq!(expand_vars("cost is $5 and ${A", "s", &l).unwrap(), "cost is $5 and ${A");
    }

    #[test]
    fn expand_vars_fails_closed_on_unset_variable() {
        let l = lookup(&[]);
        match expand_vars("key=${MISSING}", "srv", &l) {
            Err(McpError::UnsetVariable { server, name }) => {
                assert_eq!(server, "srv");
                assert_eq!(name, "MISSING");
            }
            other => panic!("expected UnsetVariable, got {other:?}"),
        }
    }

    #[test]
    fn expand_resolves_a_composio_shaped_server() {
        // The motivating case: a remote MCP whose URL carries a server id + the
        // per-user id, and whose api key lives only in the environment — none of
        // it written to disk.
        let mut headers = BTreeMap::new();
        headers.insert("x-api-key".to_string(), "${COMPOSIO_API_KEY}".to_string());
        let cfg = ServerConfig {
            name: "composio".into(),
            url: Some(
                "https://backend.composio.dev/v3/mcp/${COMPOSIO_SERVER_ID}?user_id=${ERI_USER_ID}"
                    .into(),
            ),
            headers,
            ..Default::default()
        };
        let mut vars = BTreeMap::new();
        vars.insert("COMPOSIO_SERVER_ID".to_string(), "srv_123".to_string());
        vars.insert("ERI_USER_ID".to_string(), "user_abc".to_string());
        vars.insert("COMPOSIO_API_KEY".to_string(), "ak_secret".to_string());

        let resolved = cfg.expand(&vars).expect("expands");
        assert_eq!(
            resolved.url.as_deref(),
            Some("https://backend.composio.dev/v3/mcp/srv_123?user_id=user_abc")
        );
        assert_eq!(resolved.headers.get("x-api-key").map(String::as_str), Some("ak_secret"));
        // The on-disk config is untouched — placeholders stay for the next launch.
        assert!(cfg.url.as_deref().unwrap().contains("${COMPOSIO_SERVER_ID}"));
    }

    #[test]
    fn expand_errors_when_a_referenced_var_is_missing() {
        let cfg = ServerConfig {
            name: "composio".into(),
            url: Some("https://x/${COMPOSIO_SERVER_ID}".into()),
            ..Default::default()
        };
        // Empty vars + (assumed) unset env → fail-closed.
        assert!(matches!(
            cfg.expand(&BTreeMap::new()),
            Err(McpError::UnsetVariable { .. })
        ));
    }

    #[test]
    fn parses_mcp_servers_object_shape() {
        // Canonical Claude Desktop / Cursor shape.
        let raw = r#"{
            "mcpServers": {
                "linear": {
                    "command": "npx",
                    "args": ["@modelcontextprotocol/server-linear"],
                    "env": {"LINEAR_API_KEY": "REPLACE_ME"}
                },
                "github": {
                    "url": "https://mcp.github.com/v1",
                    "transport": "http"
                }
            }
        }"#;
        let mut servers = parse(raw, Path::new("test.json")).expect("parses");
        servers.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "github");
        assert_eq!(servers[0].resolved_transport(), TransportKind::Http);
        assert_eq!(servers[1].name, "linear");
        assert_eq!(servers[1].resolved_transport(), TransportKind::Stdio);
        assert_eq!(servers[1].command.as_deref(), Some("npx"));
        assert_eq!(
            servers[1].env.get("LINEAR_API_KEY").map(String::as_str),
            Some("REPLACE_ME")
        );
    }

    #[test]
    fn url_without_explicit_transport_infers_http() {
        let raw = r#"{
            "mcpServers": {
                "remote": {"url": "https://example.com/mcp"}
            }
        }"#;
        let servers = parse(raw, Path::new("t.json")).unwrap();
        assert_eq!(servers[0].resolved_transport(), TransportKind::Http);
    }

    #[test]
    fn legacy_servers_array_still_loads() {
        let raw = r#"{
            "servers": [
                {"name": "fs", "command": "node", "args": ["server.js"]}
            ]
        }"#;
        let servers = parse(raw, Path::new("t.json")).unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "fs");
    }

    #[test]
    fn comments_are_stripped_before_parse() {
        let raw = r#"{
            // top-level comment
            "mcpServers": {
                /* block comment */
                "fs": {"command": "node"}
            }
        }"#;
        let servers = parse(raw, Path::new("t.json")).unwrap();
        assert_eq!(servers.len(), 1);
    }

    #[test]
    fn empty_or_whitespace_is_not_an_error() {
        assert!(parse("", Path::new("t.json")).unwrap().is_empty());
        assert!(parse("   \n  ", Path::new("t.json")).unwrap().is_empty());
    }

    #[test]
    fn legacy_entry_missing_name_errors() {
        let raw = r#"{"servers": [{"command": "node"}]}"#;
        let err = parse(raw, Path::new("t.json")).unwrap_err();
        matches!(err, McpError::ConfigParse { .. });
    }

    #[test]
    fn project_overrides_global_when_names_collide() {
        // Serialize with other HOME-mutating tests in this binary.
        let _env = crate::HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Two separate temp dirs so the project and global files don't
        // resolve to the same path.
        let workspace_dir = tempfile::tempdir().unwrap();
        let home_dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(workspace_dir.path().join(".eri")).unwrap();
        std::fs::write(
            workspace_dir.path().join(".eri/mcp.json"),
            r#"{"mcpServers":{"shared":{"command":"project-cmd"}}}"#,
        )
        .unwrap();

        // Point $HOME at the second tempdir so the global lookup resolves
        // there instead of the developer's real home.
        // SAFETY: setting an env var is `unsafe` in 2024 edition; tests in
        // this module exercise the env one at a time.
        let prev_home = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", home_dir.path());
        }
        std::fs::create_dir_all(home_dir.path().join(".eri")).unwrap();
        std::fs::write(
            home_dir.path().join(".eri/mcp.json"),
            r#"{"mcpServers":{"shared":{"command":"global-cmd"},"only-global":{"command":"g"}}}"#,
        )
        .unwrap();

        let servers = load(workspace_dir.path()).unwrap();

        // Restore HOME before assertions so a panic doesn't poison the env.
        unsafe {
            match prev_home {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }

        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        // Both global-only and the overridden entry should appear, and the
        // overridden one must carry the project command.
        assert_eq!(by_name.len(), 2);
        assert_eq!(
            by_name["shared"].command.as_deref(),
            Some("project-cmd"),
            "project file must win over global on name collisions"
        );
        assert_eq!(by_name["only-global"].command.as_deref(), Some("g"));
    }

    #[test]
    fn plugin_servers_load_between_global_and_project() {
        // Serialize with other HOME-mutating tests in this binary.
        let _env = crate::HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let ws = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap(); // empty -> no global config

        // A plugin contributes one unique server + one that the project shadows.
        let plugin = ws.path().join(".eri/plugins/acme");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(
            plugin.join("mcp.json"),
            r#"{"mcpServers":{"acme-only":{"command":"plug"},"shared":{"command":"plugin-cmd"}}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(ws.path().join(".eri")).unwrap();
        std::fs::write(
            ws.path().join(".eri/mcp.json"),
            r#"{"mcpServers":{"shared":{"command":"project-cmd"}}}"#,
        )
        .unwrap();

        let prev = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", home.path());
        }
        let servers = load(ws.path()).unwrap();
        unsafe {
            match prev {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }

        let by: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by.len(), 2);
        assert_eq!(by["acme-only"].command.as_deref(), Some("plug"));
        // Project file wins over the plugin on a name collision.
        assert_eq!(by["shared"].command.as_deref(), Some("project-cmd"));
    }

    #[test]
    fn active_servers_filters_disabled() {
        let all = vec![
            ServerConfig {
                name: "a".into(),
                disabled: false,
                ..Default::default()
            },
            ServerConfig {
                name: "b".into(),
                disabled: true,
                ..Default::default()
            },
        ];
        let active = active_servers(&all);
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].name, "a");
    }
}
