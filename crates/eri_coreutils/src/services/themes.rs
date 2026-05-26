//! Themes (Phase 23b) — design-style presets that get injected into
//! the model's system prompt so generated UI matches the user's vibe
//! from the first turn.
//!
//! Three sources of themes, in precedence order:
//!   1. `<workspace>/.eri/theme.json`  — per-project override
//!   2. `~/.eri/theme.json`            — per-user default
//!   3. Built-in catalog by slug       — selected via `/theme <slug>`
//!
//! The active theme is persisted by writing `{ "active": "<slug>" }`
//! to one of the JSON files above; downstream prompt-building reads
//! the resolved theme spec and emits a `system:theme` BudgetPart.
//!
//! The full 80-theme catalog from the plan ships as data files under
//! `$ERI_RESOURCES/themes/`. Here we ship a starter set inline so the
//! sidecar can resolve a theme even when the resources bundle isn't
//! installed (e.g. tests, dev mode, lazy resource fetching).

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThemeSpec {
    pub slug: String,
    pub family: String,
    pub display_name: String,
    pub description: String,
    pub mode: String,
    /// Free-form palette + typography keys so we can ship new tokens
    /// without a schema migration. Keys mirror the plan's spec
    /// (`bg`, `fg`, `accent`, `sans`, `mono`, …).
    pub tokens: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListParams {
    /// Optional family filter (`brand`, `movement`, `shadcn`, `daisyui`).
    #[serde(default)]
    family: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListReport {
    themes: Vec<ThemeSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetParams {
    workspace: std::path::PathBuf,
    slug: String,
}

pub async fn list(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: ListParams = serde_json::from_value(params).unwrap_or(ListParams { family: None });
    let mut themes = builtin_catalog();
    if let Some(family) = p.family.as_deref() {
        themes.retain(|t| t.family == family);
    }
    serde_json::to_value(ListReport { themes }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn set_active(
    params: Value,
    _tier_state: &SharedTierState,
    _services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    let p: SetParams = serde_json::from_value(params)
        .map_err(|e| DispatchError::BadParams(format!("eri/themes/setActive: {e}")))?;
    let slug = p.slug.trim();
    if slug.is_empty() {
        return Err(DispatchError::BadParams("slug must be non-empty".into()));
    }
    if resolve_theme(slug).is_none() {
        return Err(DispatchError::BadParams(format!("unknown theme: {slug}")));
    }
    let path = workspace_theme_path(&p.workspace);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DispatchError::Other(e.into()))?;
    }
    std::fs::write(&path, format!("{{\n  \"active\": \"{slug}\"\n}}\n"))
        .map_err(|e| DispatchError::Other(e.into()))?;
    Ok(serde_json::json!({ "ok": true, "active": slug }))
}

/// Resolve the active theme for a workspace by consulting the
/// per-project file first, then the per-user file. Returns `None`
/// when the resolved slug doesn't match any catalog entry.
pub fn active_theme(workspace: &Path) -> Option<ThemeSpec> {
    let slug = read_active_slug(workspace)?;
    resolve_theme(&slug)
}

/// Format the active theme as a `## Design tokens` Markdown block for
/// system-prompt injection. Returns `None` when no theme is set.
pub fn format_theme_block(theme: &ThemeSpec) -> String {
    let mut out = format!(
        "## Design tokens — {} ({}, {})\n{}\n",
        theme.display_name, theme.family, theme.mode, theme.description
    );
    let mut keys: Vec<&String> = theme.tokens.keys().collect();
    keys.sort();
    for key in keys {
        if let Some(v) = theme.tokens.get(key) {
            let formatted = match v {
                Value::String(s) => s.clone(),
                Value::Object(obj) => {
                    let mut pairs: Vec<String> = obj
                        .iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| format!("{k}={s}")))
                        .collect();
                    pairs.sort();
                    pairs.join(", ")
                }
                other => other.to_string(),
            };
            out.push_str(&format!("- {key}: {formatted}\n"));
        }
    }
    out
}

fn workspace_theme_path(workspace: &Path) -> std::path::PathBuf {
    workspace.join(".eri").join("theme.json")
}

fn user_theme_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())?;
    Some(std::path::PathBuf::from(home).join(".eri").join("theme.json"))
}

fn read_active_slug(workspace: &Path) -> Option<String> {
    if let Some(slug) = read_active_slug_from(&workspace_theme_path(workspace)) {
        return Some(slug);
    }
    if let Some(path) = user_theme_path() {
        if let Some(slug) = read_active_slug_from(&path) {
            return Some(slug);
        }
    }
    None
}

fn read_active_slug_from(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    v.get("active")?.as_str().map(|s| s.to_string())
}

/// Look up a theme by slug from the built-in catalog. The full
/// 80-theme catalog ships as separate data files; we keep an
/// inline starter set here so the sidecar resolves something even
/// when the resources bundle isn't installed.
pub fn resolve_theme(slug: &str) -> Option<ThemeSpec> {
    builtin_catalog().into_iter().find(|t| t.slug == slug)
}

/// Inline starter set covering 12 of the 80-theme plan: 4 from each
/// of the three main families (brand / movement / shadcn) plus 1
/// daisyUI exemplar. Enough to exercise the surface; the full
/// 80-theme bundle lives in `$ERI_RESOURCES/themes/`.
pub fn builtin_catalog() -> Vec<ThemeSpec> {
    fn entry(
        slug: &str,
        family: &str,
        display: &str,
        desc: &str,
        mode: &str,
        tokens: &[(&str, Value)],
    ) -> ThemeSpec {
        let mut map = serde_json::Map::new();
        for (k, v) in tokens {
            map.insert((*k).to_string(), v.clone());
        }
        ThemeSpec {
            slug: slug.to_string(),
            family: family.to_string(),
            display_name: display.to_string(),
            description: desc.to_string(),
            mode: mode.to_string(),
            tokens: map,
        }
    }
    fn s(s: &str) -> Value {
        Value::String(s.to_string())
    }
    fn pal(bg: &str, fg: &str, accent: &str) -> Value {
        Value::Object(
            [("bg", bg), ("fg", fg), ("accent", accent)]
                .into_iter()
                .map(|(k, v)| (k.to_string(), Value::String(v.to_string())))
                .collect(),
        )
    }
    vec![
        // brand
        entry(
            "anthropic",
            "brand",
            "Anthropic",
            "Dark cream, accent lime, Funnel Display headings, minimal.",
            "dark",
            &[
                ("palette", pal("#0B0B0B", "#F2EBDF", "#E0FF4F")),
                ("sans", s("Funnel Display, ui-sans-serif")),
                ("radius", s("md")),
                ("spacing", s("spacious")),
            ],
        ),
        entry(
            "linear",
            "brand",
            "Linear",
            "Dark, electric purple + magenta, IBM Plex Mono blocks, sharp.",
            "dark",
            &[
                ("palette", pal("#0F0F1A", "#E8E8FA", "#5E6AD2")),
                ("sans", s("Inter")),
                ("mono", s("IBM Plex Mono")),
                ("radius", s("sm")),
                ("shadow", s("sharp")),
            ],
        ),
        entry(
            "stripe",
            "brand",
            "Stripe",
            "Light, indigo gradient, Sohne sans, rounded-lg, soft shadows.",
            "light",
            &[
                ("palette", pal("#FFFFFF", "#0A2540", "#635BFF")),
                ("sans", s("Sohne, ui-sans-serif")),
                ("radius", s("lg")),
                ("shadow", s("soft")),
            ],
        ),
        entry(
            "vercel",
            "brand",
            "Vercel",
            "B/W, Geist Sans, zero radius primary, sharp lines.",
            "dark",
            &[
                ("palette", pal("#000000", "#FFFFFF", "#FFFFFF")),
                ("sans", s("Geist")),
                ("mono", s("Geist Mono")),
                ("radius", s("none")),
                ("shadow", s("none")),
            ],
        ),
        // movement
        entry(
            "minimalism",
            "movement",
            "Minimalism",
            "White, mono, max whitespace, single accent.",
            "light",
            &[
                ("palette", pal("#FFFFFF", "#111111", "#FF3B30")),
                ("sans", s("Inter")),
                ("radius", s("none")),
                ("spacing", s("spacious")),
            ],
        ),
        entry(
            "neobrutalism",
            "movement",
            "Neobrutalism",
            "High contrast, bold borders, hard shadows, primary colours.",
            "light",
            &[
                ("palette", pal("#FFE21D", "#000000", "#FF4444")),
                ("sans", s("Space Grotesk")),
                ("radius", s("sm")),
                ("shadow", s("sharp")),
            ],
        ),
        entry(
            "cyberpunk",
            "movement",
            "Cyberpunk",
            "Neon on dark, glitch fonts, scan lines, magenta + cyan.",
            "dark",
            &[
                ("palette", pal("#0A0014", "#F5F5FF", "#F0F")),
                ("sans", s("Space Mono")),
                ("mono", s("JetBrains Mono")),
                ("radius", s("none")),
                ("shadow", s("glow")),
            ],
        ),
        entry(
            "editorial",
            "movement",
            "Editorial",
            "Serif headlines, columns, asymmetric grids, magazine feel.",
            "light",
            &[
                ("palette", pal("#FAF8F4", "#1A1A1A", "#B4322B")),
                ("sans", s("Inter")),
                ("serif", s("Fraunces")),
                ("radius", s("none")),
                ("spacing", s("spacious")),
            ],
        ),
        // shadcn
        entry(
            "shadcn-default",
            "shadcn",
            "shadcn / Default",
            "shadcn/ui defaults — neutral greys with accent blue.",
            "adaptive",
            &[
                ("palette", pal("#0A0A0A", "#FAFAFA", "#2563EB")),
                ("radius", s("md")),
            ],
        ),
        entry(
            "shadcn-zinc",
            "shadcn",
            "shadcn / Zinc",
            "Zinc-greys variant of the shadcn defaults.",
            "adaptive",
            &[
                ("palette", pal("#18181B", "#FAFAFA", "#2563EB")),
                ("radius", s("md")),
            ],
        ),
        entry(
            "shadcn-rose",
            "shadcn",
            "shadcn / Rose",
            "Rose accent variant.",
            "adaptive",
            &[
                ("palette", pal("#FFF1F2", "#0A0A0A", "#E11D48")),
                ("radius", s("md")),
            ],
        ),
        // daisyUI
        entry(
            "daisy-dracula",
            "daisyui",
            "daisyUI / Dracula",
            "Dracula dark purple — daisyUI flavour.",
            "dark",
            &[
                ("palette", pal("#282A36", "#F8F8F2", "#FF79C6")),
                ("radius", s("md")),
            ],
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn catalog_has_all_four_families_represented() {
        let cat = builtin_catalog();
        let families: std::collections::HashSet<&str> =
            cat.iter().map(|t| t.family.as_str()).collect();
        for needed in ["brand", "movement", "shadcn", "daisyui"] {
            assert!(families.contains(needed), "missing family: {needed}");
        }
    }

    #[test]
    fn resolve_theme_finds_known_slug() {
        let theme = resolve_theme("anthropic").expect("anthropic theme");
        assert_eq!(theme.family, "brand");
        assert_eq!(theme.mode, "dark");
    }

    #[test]
    fn resolve_theme_returns_none_for_unknown() {
        assert!(resolve_theme("does-not-exist").is_none());
    }

    #[test]
    fn format_theme_block_includes_display_and_tokens() {
        let theme = resolve_theme("linear").unwrap();
        let block = format_theme_block(&theme);
        assert!(block.contains("Linear"));
        assert!(block.contains("palette"));
        assert!(block.contains("mono"));
    }

    #[test]
    fn workspace_theme_file_takes_priority_over_user() {
        let home = TempDir::new().unwrap();
        std::fs::create_dir_all(home.path().join(".eri")).unwrap();
        std::fs::write(
            home.path().join(".eri").join("theme.json"),
            r#"{"active":"vercel"}"#,
        )
        .unwrap();
        let _g = guard_home(home.path());
        let ws = TempDir::new().unwrap();
        std::fs::create_dir_all(ws.path().join(".eri")).unwrap();
        std::fs::write(
            ws.path().join(".eri").join("theme.json"),
            r#"{"active":"linear"}"#,
        )
        .unwrap();
        let theme = active_theme(ws.path()).expect("resolved");
        assert_eq!(theme.slug, "linear");
    }

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
