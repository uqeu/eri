//! Preferences (Phase 23c) — durable per-user build style.
//!
//! Reads `~/.eri/preferences.json` (per-user) and
//! `<workspace>/.eri/preferences.json` (per-project override). Merges
//! them workspace-on-top so a project pinning `packageManager: "pnpm"`
//! beats the user's default `"npm"`.
//!
//! The full schema lives in the plan (Phase 23c) and totals ~110
//! optional fields across 14 categories. Here we treat the file
//! opaquely as a `serde_json::Value` so the schema can evolve without
//! sidecar changes — the IDE-side editor enforces the shape via
//! generated TypeScript types.
//!
//! Output: a single merged JSON document the brain's prompt builder
//! injects as the `system:preferences` BudgetPart.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadParams {
    workspace: std::path::PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadReport {
    merged: Value,
    /// Provenance: which file each top-level key came from. Lets the
    /// IDE-side editor visualise overrides.
    sources: serde_json::Map<String, Value>,
}

pub async fn load(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: LoadParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/preferences/load: {e}")))?;
    let (merged, sources) = merge_preferences(&p.workspace);
    serde_json::to_value(LoadReport { merged, sources }).map_err(|e| DispatchError::Other(e.into()))
}

/// Read user-wide + workspace-scoped preferences and merge them.
/// Workspace keys win on collision (shallow merge — nested objects
/// from each layer are NOT recursively combined; the workspace
/// object replaces the user one outright for that key). Returns
/// `(merged, sources)` where `sources[key] = "user" | "workspace"`.
pub fn merge_preferences(workspace: &Path) -> (Value, serde_json::Map<String, Value>) {
    let user = read_user_file();
    let project = read_workspace_file(workspace);
    let mut merged = serde_json::Map::new();
    let mut sources = serde_json::Map::new();
    if let Some(obj) = user.as_object() {
        for (k, v) in obj {
            merged.insert(k.clone(), v.clone());
            sources.insert(k.clone(), Value::String("user".to_string()));
        }
    }
    if let Some(obj) = project.as_object() {
        for (k, v) in obj {
            merged.insert(k.clone(), v.clone());
            sources.insert(k.clone(), Value::String("workspace".to_string()));
        }
    }
    (Value::Object(merged), sources)
}

fn read_user_file() -> Value {
    let Some(home) = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
    else {
        return Value::Null;
    };
    read_json_file(&Path::new(&home).join(".eri").join("preferences.json"))
}

fn read_workspace_file(workspace: &Path) -> Value {
    read_json_file(&workspace.join(".eri").join("preferences.json"))
}

fn read_json_file(path: &Path) -> Value {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Value::Null;
    };
    serde_json::from_str(&raw).unwrap_or(Value::Null)
}

/// Format the merged preferences as a `## Build preferences` Markdown
/// block ready for system-prompt injection. Returns `None` when the
/// merged document is empty so the caller drops the part rather than
/// wasting tokens on an empty header.
///
/// Capped at ~600 tokens worth of output (~2400 bytes) so a
/// 110-field document doesn't blow the prompt budget. Surface keys
/// most-likely to matter first (stack → naming → testing → …).
pub fn format_preferences_block(merged: &Value) -> Option<String> {
    let obj = merged.as_object()?;
    if obj.is_empty() {
        return None;
    }
    const PRIORITY: &[&str] = &[
        "stack",
        "ui",
        "fonts",
        "codeStyle",
        "naming",
        "testing",
        "fileOrg",
        "git",
        "models",
        "workflow",
        "a11y",
        "performance",
        "security",
        "i18n",
        "docs",
        "comments",
    ];
    let mut out = String::from("## Build preferences\n");
    let mut bytes = out.len();
    let mut surfaced = std::collections::HashSet::new();
    for key in PRIORITY {
        if let Some(v) = obj.get(*key) {
            let line = format_pref_line(key, v);
            if bytes + line.len() > 2400 {
                break;
            }
            out.push_str(&line);
            bytes += line.len();
            surfaced.insert((*key).to_string());
        }
    }
    // Catch any user-defined keys not in the priority list.
    for (k, v) in obj {
        if surfaced.contains(k) {
            continue;
        }
        let line = format_pref_line(k, v);
        if bytes + line.len() > 2400 {
            break;
        }
        out.push_str(&line);
        bytes += line.len();
    }
    Some(out)
}

fn format_pref_line(key: &str, value: &Value) -> String {
    match value {
        Value::String(s) => format!("- {key}: {s}\n"),
        Value::Bool(b) => format!("- {key}: {b}\n"),
        Value::Number(n) => format!("- {key}: {n}\n"),
        Value::Object(obj) => {
            let mut pairs: Vec<String> = obj
                .iter()
                .filter_map(|(k, v)| match v {
                    Value::String(s) => Some(format!("{k}={s}")),
                    Value::Bool(b) => Some(format!("{k}={b}")),
                    Value::Number(n) => Some(format!("{k}={n}")),
                    _ => None,
                })
                .collect();
            pairs.sort();
            format!("- {key}: {{ {} }}\n", pairs.join(", "))
        }
        _ => format!("- {key}: (complex)\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn merge_returns_empty_when_no_files_exist() {
        let dir = TempDir::new().unwrap();
        let _guard = guard_home(dir.path());
        let other = TempDir::new().unwrap();
        let (merged, sources) = merge_preferences(other.path());
        assert!(merged.as_object().unwrap().is_empty());
        assert!(sources.is_empty());
    }

    #[test]
    fn workspace_overrides_user_on_key_collision() {
        let home = TempDir::new().unwrap();
        std::fs::create_dir_all(home.path().join(".eri")).unwrap();
        std::fs::write(
            home.path().join(".eri").join("preferences.json"),
            r#"{"stack": {"packageManager": "npm"}}"#,
        )
        .unwrap();
        let _guard = guard_home(home.path());
        let ws = TempDir::new().unwrap();
        std::fs::create_dir_all(ws.path().join(".eri")).unwrap();
        std::fs::write(
            ws.path().join(".eri").join("preferences.json"),
            r#"{"stack": {"packageManager": "pnpm"}}"#,
        )
        .unwrap();
        let (merged, sources) = merge_preferences(ws.path());
        assert_eq!(
            merged.pointer("/stack/packageManager"),
            Some(&Value::String("pnpm".to_string()))
        );
        assert_eq!(sources["stack"], Value::String("workspace".to_string()));
    }

    #[test]
    fn format_block_emits_priority_keys_first() {
        let merged = serde_json::json!({
            "naming": { "files": "kebab-case" },
            "stack":  { "frontend": "next" },
        });
        let block = format_preferences_block(&merged).expect("non-empty");
        let stack_idx = block.find("- stack:").unwrap();
        let naming_idx = block.find("- naming:").unwrap();
        assert!(stack_idx < naming_idx, "stack should come before naming");
    }

    #[test]
    fn format_block_returns_none_when_empty() {
        let merged = serde_json::json!({});
        assert!(format_preferences_block(&merged).is_none());
    }

    // SAFETY: HOME-mutating tests serialise on this mutex.
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    struct HomeGuard {
        prev: Option<String>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }
    impl Drop for HomeGuard {
        fn drop(&mut self) {
            unsafe {
                match self.prev.as_deref() {
                    Some(v) => std::env::set_var("HOME", v),
                    None => std::env::remove_var("HOME"),
                }
            }
        }
    }
    fn guard_home(p: &Path) -> HomeGuard {
        let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", p);
        }
        HomeGuard { prev, _lock: lock }
    }
}
