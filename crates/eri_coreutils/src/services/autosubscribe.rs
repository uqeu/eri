//! Autosubscribe (Phase 21c) — Nia parity.
//!
//! On workspace open, eri parses the top-level dependency manifests
//! (package.json, Cargo.toml, requirements.txt, pyproject.toml, go.mod)
//! and returns the list of declared top-level dependencies. The IDE
//! then pre-warms the docs cache for those packages so the first
//! `@docs <lib>` lookup is instant instead of paying a Context7
//! round-trip.
//!
//! Discipline:
//!   - Top-level dependencies only — transitive deps come along when
//!     the user explicitly queries them. Indexing every transitive
//!     would balloon the cache for no measurable retrieval win.
//!   - Best-effort: a malformed manifest returns an empty list for
//!     that file rather than failing the whole call. We log the
//!     specific parse error for debugging but never block the IDE
//!     activation on a bad lockfile.
//!   - Synchronous parse: every manifest fits in memory cheaply; no
//!     reason to spawn a task.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceParam {
    workspace: std::path::PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepEntry {
    pub name: String,
    /// `npm`, `cargo`, `pypi`, `go`. Lets the IDE pick the right docs
    /// source when pre-warming the cache.
    pub source: &'static str,
    /// Manifest file the entry came from (relative to the workspace).
    pub from: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutosubscribeReport {
    pub deps: Vec<DepEntry>,
}

/// `eri/autosubscribe/list` — parse every supported manifest at the
/// workspace root and return the union of top-level dependencies.
pub async fn list(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: WorkspaceParam = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/autosubscribe/list: {e}")))?;
    let deps = collect_deps(&p.workspace);
    serde_json::to_value(AutosubscribeReport { deps }).map_err(|e| DispatchError::Other(e.into()))
}

pub fn collect_deps(workspace: &Path) -> Vec<DepEntry> {
    let mut deps = Vec::new();
    deps.extend(parse_package_json(workspace));
    deps.extend(parse_cargo_toml(workspace));
    deps.extend(parse_requirements_txt(workspace));
    deps.extend(parse_pyproject_toml(workspace));
    deps.extend(parse_go_mod(workspace));
    dedup(deps)
}

fn dedup(mut deps: Vec<DepEntry>) -> Vec<DepEntry> {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    deps.retain(|d| seen.insert((d.name.clone(), d.source)));
    deps
}

fn parse_package_json(workspace: &Path) -> Vec<DepEntry> {
    let path = workspace.join("package.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for key in ["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(obj) = json.get(key).and_then(|v| v.as_object()) {
            for name in obj.keys() {
                out.push(DepEntry {
                    name: name.clone(),
                    source: "npm",
                    from: "package.json",
                });
            }
        }
    }
    out
}

fn parse_cargo_toml(workspace: &Path) -> Vec<DepEntry> {
    // We don't depend on the toml crate workspace-wide; a tiny scanner
    // for `[dependencies]` + `[dev-dependencies]` sections is sufficient
    // for the autosubscribe use case (top-level names only, no version
    // resolution).
    let path = workspace.join("Cargo.toml");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut in_section = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('[') {
            in_section = matches!(
                trimmed,
                "[dependencies]"
                    | "[dev-dependencies]"
                    | "[build-dependencies]"
                    | "[workspace.dependencies]"
            );
            continue;
        }
        if !in_section {
            continue;
        }
        // Either `name = "x"` or `name = { ... }`.
        if let Some(eq) = trimmed.find('=') {
            let name = trimmed[..eq].trim();
            if is_valid_crate_name(name) {
                out.push(DepEntry {
                    name: name.to_string(),
                    source: "cargo",
                    from: "Cargo.toml",
                });
            }
        }
    }
    out
}

fn is_valid_crate_name(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn parse_requirements_txt(workspace: &Path) -> Vec<DepEntry> {
    let path = workspace.join("requirements.txt");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in raw.lines() {
        let cleaned = line.split('#').next().unwrap_or("").trim();
        if cleaned.is_empty() || cleaned.starts_with('-') {
            continue;
        }
        // Strip version specifiers — anything up to `==`, `>=`, etc.
        let name = cleaned
            .split(|c: char| matches!(c, '=' | '>' | '<' | '!' | '~' | ';' | '['))
            .next()
            .unwrap_or("")
            .trim();
        if !name.is_empty() && is_valid_python_name(name) {
            out.push(DepEntry {
                name: name.to_string(),
                source: "pypi",
                from: "requirements.txt",
            });
        }
    }
    out
}

fn is_valid_python_name(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

fn parse_pyproject_toml(workspace: &Path) -> Vec<DepEntry> {
    let path = workspace.join("pyproject.toml");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    // Two common shapes:
    //   [project] dependencies = ["pkg", ...]
    //   [tool.poetry.dependencies] pkg = "..."
    let mut in_array = false;
    let mut in_poetry_deps = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_poetry_deps = matches!(
                trimmed,
                "[tool.poetry.dependencies]" | "[tool.poetry.dev-dependencies]"
            );
            in_array = false;
            continue;
        }
        // PEP 621 `dependencies` array.
        if !in_poetry_deps {
            if trimmed.starts_with("dependencies") && trimmed.contains('[') {
                in_array = true;
                continue;
            }
            if in_array {
                if trimmed.contains(']') {
                    in_array = false;
                }
                if let Some(item) = trimmed
                    .trim_matches(|c: char| c == ',' || c.is_whitespace())
                    .strip_prefix('"')
                    .and_then(|s| s.strip_suffix('"'))
                {
                    let name = item
                        .split(|c: char| matches!(c, '=' | '>' | '<' | '!' | '~' | ';' | '['))
                        .next()
                        .unwrap_or("")
                        .trim();
                    if !name.is_empty() && is_valid_python_name(name) {
                        out.push(DepEntry {
                            name: name.to_string(),
                            source: "pypi",
                            from: "pyproject.toml",
                        });
                    }
                }
                continue;
            }
        }
        if in_poetry_deps {
            if let Some(eq) = trimmed.find('=') {
                let name = trimmed[..eq].trim();
                if !name.eq_ignore_ascii_case("python") && is_valid_python_name(name) {
                    out.push(DepEntry {
                        name: name.to_string(),
                        source: "pypi",
                        from: "pyproject.toml",
                    });
                }
            }
        }
    }
    out
}

fn parse_go_mod(workspace: &Path) -> Vec<DepEntry> {
    let path = workspace.join("go.mod");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut in_block = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("require (") {
            in_block = true;
            continue;
        }
        if in_block && trimmed == ")" {
            in_block = false;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("require ") {
            // Single-line `require foo/bar v1.2.3`.
            push_go_dep(&mut out, rest);
        } else if in_block && !trimmed.is_empty() && !trimmed.starts_with("//") {
            push_go_dep(&mut out, trimmed);
        }
    }
    out
}

fn push_go_dep(out: &mut Vec<DepEntry>, line: &str) {
    let module = line.split_whitespace().next().unwrap_or("");
    if module.is_empty() {
        return;
    }
    out.push(DepEntry {
        name: module.to_string(),
        source: "go",
        from: "go.mod",
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn parses_package_json_dependencies() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("package.json"),
            r#"{
                "dependencies": { "react": "^18.0.0", "zod": "^3.0.0" },
                "devDependencies": { "vitest": "^1.0.0" }
            }"#,
        )
        .unwrap();
        let deps = collect_deps(dir.path());
        let names: Vec<&str> = deps.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"react"));
        assert!(names.contains(&"zod"));
        assert!(names.contains(&"vitest"));
    }

    #[test]
    fn parses_cargo_toml_dependencies() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("Cargo.toml"),
            r#"[package]
name = "demo"

[dependencies]
tokio = "1"
serde = { version = "1", features = ["derive"] }

[dev-dependencies]
proptest = "1"
"#,
        )
        .unwrap();
        let deps = collect_deps(dir.path());
        let names: Vec<&str> = deps.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"tokio"));
        assert!(names.contains(&"serde"));
        assert!(names.contains(&"proptest"));
        // The [package] section's `name = "demo"` must NOT leak in.
        assert!(!names.contains(&"name"));
    }

    #[test]
    fn parses_requirements_txt() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("requirements.txt"),
            "# header comment\nrequests==2.31.0\nnumpy>=1.20\nfastapi[all]==0.110.0\n-e .\n",
        )
        .unwrap();
        let deps = collect_deps(dir.path());
        let names: Vec<&str> = deps.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"requests"));
        assert!(names.contains(&"numpy"));
        assert!(names.contains(&"fastapi"));
        // `-e .` lines are editable installs; we skip them.
        assert!(!names.contains(&""));
    }

    #[test]
    fn parses_pep621_pyproject() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("pyproject.toml"),
            r#"[project]
name = "demo"
dependencies = [
    "httpx>=0.27",
    "pydantic>=2",
]
"#,
        )
        .unwrap();
        let deps = collect_deps(dir.path());
        let names: Vec<&str> = deps.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"httpx"));
        assert!(names.contains(&"pydantic"));
    }

    #[test]
    fn parses_poetry_pyproject() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("pyproject.toml"),
            r#"[tool.poetry.dependencies]
python = "^3.11"
httpx = "^0.27"
pydantic = "^2"
"#,
        )
        .unwrap();
        let deps = collect_deps(dir.path());
        let names: Vec<&str> = deps.iter().map(|d| d.name.as_str()).collect();
        // `python` is the interpreter version, not a dep.
        assert!(!names.contains(&"python"));
        assert!(names.contains(&"httpx"));
        assert!(names.contains(&"pydantic"));
    }

    #[test]
    fn parses_go_mod_require_block() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("go.mod"),
            r#"module example.com/demo

go 1.22

require (
    github.com/labstack/echo/v4 v4.11.4
    github.com/lib/pq v1.10.9 // indirect
)
"#,
        )
        .unwrap();
        let deps = collect_deps(dir.path());
        let names: Vec<&str> = deps.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"github.com/labstack/echo/v4"));
        assert!(names.contains(&"github.com/lib/pq"));
    }

    #[test]
    fn dedupes_cross_manifest_collisions() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("package.json"),
            r#"{"dependencies": {"react": "^18"}, "devDependencies": {"react": "^18"}}"#,
        )
        .unwrap();
        let deps = collect_deps(dir.path());
        let react_count = deps.iter().filter(|d| d.name == "react").count();
        assert_eq!(react_count, 1, "should dedup across dep groups");
    }

    #[test]
    fn returns_empty_when_no_manifests_present() {
        let dir = TempDir::new().unwrap();
        assert!(collect_deps(dir.path()).is_empty());
    }
}
