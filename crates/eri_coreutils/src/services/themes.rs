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
    Some(
        std::path::PathBuf::from(home)
            .join(".eri")
            .join("theme.json"),
    )
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
    .into_iter()
    .chain(extended_catalog())
    .collect()
}

/// 68 additional themes (37 brand + 30 movement + 14 shadcn + 29 daisyUI
/// per the plan, minus the 12 already in the primary catalog above).
/// Kept in a second function so the diff stays readable and the primary
/// catalog can be authored at full verbosity while the long tail uses
/// the compact `extended` helper.
fn extended_catalog() -> Vec<ThemeSpec> {
    #[allow(clippy::too_many_arguments)]
    fn ex(
        slug: &str,
        family: &str,
        display: &str,
        desc: &str,
        mode: &str,
        bg: &str,
        fg: &str,
        accent: &str,
        radius: &str,
    ) -> ThemeSpec {
        let mut tokens = serde_json::Map::new();
        let mut pal = serde_json::Map::new();
        pal.insert("bg".into(), Value::String(bg.into()));
        pal.insert("fg".into(), Value::String(fg.into()));
        pal.insert("accent".into(), Value::String(accent.into()));
        tokens.insert("palette".into(), Value::Object(pal));
        tokens.insert("radius".into(), Value::String(radius.into()));
        ThemeSpec {
            slug: slug.into(),
            family: family.into(),
            display_name: display.into(),
            description: desc.into(),
            mode: mode.into(),
            tokens,
        }
    }
    vec![
        // --- brand (extend the 4 already in the primary catalog) ---
        ex(
            "apple",
            "brand",
            "Apple",
            "SF Pro, glass cards, spacious motion.",
            "adaptive",
            "#F5F5F7",
            "#1D1D1F",
            "#0071E3",
            "lg",
        ),
        ex(
            "notion",
            "brand",
            "Notion",
            "Cream, soft shadows, Inter, comfortable.",
            "light",
            "#F7F6F3",
            "#37352F",
            "#37352F",
            "sm",
        ),
        ex(
            "github",
            "brand",
            "GitHub",
            "Dark dimmed, Mona Sans + mono, conservative.",
            "dark",
            "#0D1117",
            "#C9D1D9",
            "#58A6FF",
            "sm",
        ),
        ex(
            "figma",
            "brand",
            "Figma",
            "Mid-purple, soft cards, Inter, lively motion.",
            "light",
            "#FFFFFF",
            "#1E1E1E",
            "#A259FF",
            "md",
        ),
        ex(
            "arc",
            "brand",
            "Arc",
            "Warm orange, glass + gradient, lively.",
            "light",
            "#FFF7F2",
            "#1B1B1B",
            "#F78166",
            "lg",
        ),
        ex(
            "raycast",
            "brand",
            "Raycast",
            "Dark, accent red, mono blocks.",
            "dark",
            "#0F0F12",
            "#EDEDED",
            "#FF6363",
            "md",
        ),
        ex(
            "loom",
            "brand",
            "Loom",
            "Purple, large play affordances, comfortable.",
            "light",
            "#FAFAFC",
            "#101012",
            "#625DF5",
            "md",
        ),
        ex(
            "superhuman",
            "brand",
            "Superhuman",
            "Mono-first, white, fast, minimal chrome.",
            "light",
            "#FFFFFF",
            "#0F0F0F",
            "#FF1A4D",
            "sm",
        ),
        ex(
            "cron",
            "brand",
            "Cron",
            "Clean light, indigo accent, Inter, mono ratios.",
            "light",
            "#FFFFFF",
            "#11151C",
            "#4F46E5",
            "md",
        ),
        ex(
            "cal-com",
            "brand",
            "Cal.com",
            "System + accent customisation, comfortable.",
            "adaptive",
            "#FFFFFF",
            "#1A1A1A",
            "#3B82F6",
            "md",
        ),
        ex(
            "plausible",
            "brand",
            "Plausible",
            "White, lime accent, sans, dense data tables.",
            "light",
            "#FFFFFF",
            "#15191F",
            "#5BAB42",
            "sm",
        ),
        ex(
            "tailscale",
            "brand",
            "Tailscale",
            "Warm orange on cream, soft, friendly.",
            "light",
            "#FDF6EE",
            "#1A1A1A",
            "#5E5CE6",
            "lg",
        ),
        ex(
            "posthog",
            "brand",
            "PostHog",
            "Orange, playful, mono accents, dense.",
            "light",
            "#FFF7E6",
            "#1D1F27",
            "#FFBA00",
            "md",
        ),
        ex(
            "sentry",
            "brand",
            "Sentry",
            "Purple, mono blocks, error-aware dark.",
            "dark",
            "#181225",
            "#E6E6F0",
            "#6A5ACD",
            "md",
        ),
        ex(
            "replit",
            "brand",
            "Replit",
            "Orange/red playground, sans, kid-friendly.",
            "light",
            "#FFFFFF",
            "#1D1F26",
            "#F26207",
            "md",
        ),
        ex(
            "spotify",
            "brand",
            "Spotify",
            "Dark, green accent, sans, music-first.",
            "dark",
            "#121212",
            "#FFFFFF",
            "#1DB954",
            "md",
        ),
        ex(
            "discord",
            "brand",
            "Discord",
            "Blurple on dark, generous, friendly.",
            "dark",
            "#36393F",
            "#FFFFFF",
            "#5865F2",
            "md",
        ),
        ex(
            "slack",
            "brand",
            "Slack",
            "Aubergine + accents, dense, conversational.",
            "light",
            "#FFFFFF",
            "#1D1C1D",
            "#4A154B",
            "sm",
        ),
        ex(
            "x-twitter",
            "brand",
            "X (Twitter)",
            "Sharp, mono accents, dense, dark by default.",
            "dark",
            "#000000",
            "#E7E9EA",
            "#1D9BF0",
            "lg",
        ),
        ex(
            "microsoft-fluent",
            "brand",
            "Microsoft Fluent",
            "Acrylic + reveal, Segoe UI, depth.",
            "adaptive",
            "#FAFAFA",
            "#1B1B1B",
            "#0078D4",
            "md",
        ),
        ex(
            "material-design-3",
            "brand",
            "Material Design 3",
            "Dynamic colour, Roboto, expressive motion.",
            "adaptive",
            "#FEF7FF",
            "#1D1B20",
            "#6750A4",
            "lg",
        ),
        ex(
            "ibm-carbon",
            "brand",
            "IBM Carbon",
            "Dark Plex, sharp grid, industrial.",
            "dark",
            "#161616",
            "#F4F4F4",
            "#0F62FE",
            "none",
        ),
        ex(
            "google-workspace",
            "brand",
            "Google Workspace",
            "White + Google Sans, soft pills, friendly.",
            "light",
            "#FFFFFF",
            "#202124",
            "#1A73E8",
            "lg",
        ),
        ex(
            "coca-cola",
            "brand",
            "Coca-Cola",
            "Red + cream, large display serif, bold.",
            "light",
            "#F8F4E3",
            "#1A0E0B",
            "#F40009",
            "lg",
        ),
        ex(
            "nike",
            "brand",
            "Nike",
            "B/W + neon accent, Futura, kinetic motion.",
            "light",
            "#FFFFFF",
            "#111111",
            "#FA5400",
            "sm",
        ),
        ex(
            "airbnb",
            "brand",
            "Airbnb",
            "Red + cream, Cereal sans, welcoming.",
            "light",
            "#FFFFFF",
            "#222222",
            "#FF5A5F",
            "lg",
        ),
        ex(
            "lovable",
            "brand",
            "Lovable",
            "Rainbow gradient, sans, playful agent vibe.",
            "light",
            "#FFFFFF",
            "#0F0F23",
            "#FF49A1",
            "lg",
        ),
        ex(
            "v0",
            "brand",
            "v0",
            "B/W, Geist, sharp dashboards.",
            "dark",
            "#000000",
            "#FAFAFA",
            "#FAFAFA",
            "none",
        ),
        ex(
            "bolt",
            "brand",
            "Bolt",
            "Yellow accent on dark, dense, electric.",
            "dark",
            "#0B0B0F",
            "#FAFAFA",
            "#FACC15",
            "md",
        ),
        ex(
            "cursor",
            "brand",
            "Cursor",
            "Mono-purple, dark, dense, IDE-native.",
            "dark",
            "#0B0B11",
            "#E6E6F0",
            "#8A6BFF",
            "md",
        ),
        ex(
            "claude-app",
            "brand",
            "Claude (app)",
            "Warm cream, gallant + tiempos, conversational.",
            "light",
            "#F1EEE6",
            "#1A1311",
            "#D97706",
            "md",
        ),
        ex(
            "chatgpt",
            "brand",
            "ChatGPT",
            "Minimal black/white, sans, conversational.",
            "adaptive",
            "#FFFFFF",
            "#1A1A1A",
            "#10A37F",
            "md",
        ),
        ex(
            "gemini-app",
            "brand",
            "Gemini (app)",
            "Google Sans + accent blue, lively.",
            "light",
            "#FFFFFF",
            "#1F1F1F",
            "#1A73E8",
            "lg",
        ),
        ex(
            "geist-store",
            "brand",
            "Geist store",
            "B/W, Geist, sharp commerce.",
            "light",
            "#FFFFFF",
            "#000000",
            "#000000",
            "none",
        ),
        // --- movement (extend the 4 already in the primary catalog) ---
        ex(
            "bauhaus",
            "movement",
            "Bauhaus",
            "Primary colours, geometric shapes, asymmetric grid.",
            "light",
            "#FBFBF6",
            "#161616",
            "#E5253C",
            "none",
        ),
        ex(
            "swiss-international",
            "movement",
            "Swiss / International",
            "Helvetica, mathematical grid, white space.",
            "light",
            "#FFFFFF",
            "#000000",
            "#FF1F1F",
            "none",
        ),
        ex(
            "memphis",
            "movement",
            "Memphis",
            "80s pop, squiggles + geometric, playful.",
            "light",
            "#FFE5EC",
            "#0D0D0D",
            "#FFD300",
            "md",
        ),
        ex(
            "y2k",
            "movement",
            "Y2K",
            "Chrome gradients, glass, frutiger, pastel sparkle.",
            "light",
            "#E0EAFF",
            "#15193A",
            "#82B8FF",
            "lg",
        ),
        ex(
            "vaporwave",
            "movement",
            "Vaporwave",
            "Pastel pink/teal, retro grid, palm shadows.",
            "dark",
            "#160431",
            "#F5C5FF",
            "#3FF3FF",
            "md",
        ),
        ex(
            "synthwave",
            "movement",
            "Synthwave",
            "Pink/purple/cyan grid, neon outline, retro-future.",
            "dark",
            "#160426",
            "#FF7AD9",
            "#39CCCC",
            "md",
        ),
        ex(
            "maximalism",
            "movement",
            "Maximalism",
            "Bold, layered, multiple typefaces, dense imagery.",
            "light",
            "#FFF5C2",
            "#1A1A1A",
            "#E11D48",
            "lg",
        ),
        ex(
            "glassmorphism",
            "movement",
            "Glassmorphism",
            "Frosted glass, blur, soft pastels, subtle borders.",
            "light",
            "#F5F7FA",
            "#0F1115",
            "#3B82F6",
            "lg",
        ),
        ex(
            "neumorphism",
            "movement",
            "Neumorphism",
            "Soft 3D shadows (inset + outset), monochrome.",
            "light",
            "#E0E5EC",
            "#2D2D2D",
            "#7B61FF",
            "lg",
        ),
        ex(
            "skeumorphism",
            "movement",
            "Skeumorphism",
            "Textured, realistic shadows, stitched feel.",
            "light",
            "#FAF7F0",
            "#231F1A",
            "#8B5E3C",
            "lg",
        ),
        ex(
            "solarpunk",
            "movement",
            "Solarpunk",
            "Warm earth tones, organic shapes, hand-drawn.",
            "light",
            "#F2F0E3",
            "#1F2D17",
            "#7A9B4B",
            "lg",
        ),
        ex(
            "documentation",
            "movement",
            "Documentation",
            "Stripe-docs feel, dense ToC + body, code-first.",
            "light",
            "#FFFFFF",
            "#0A2540",
            "#635BFF",
            "md",
        ),
        ex(
            "dashboard-modern",
            "movement",
            "Dashboard / Modern",
            "Linear/Vercel-style data-density, tight type.",
            "dark",
            "#0B0B11",
            "#EDEDF2",
            "#7C7DFC",
            "md",
        ),
        ex(
            "pastel-cute",
            "movement",
            "Pastel cute",
            "Soft pastels, rounded everything, playful icons.",
            "light",
            "#FFF7FB",
            "#3A2E45",
            "#FFB1D4",
            "lg",
        ),
        ex(
            "game-ui",
            "movement",
            "Game UI",
            "HUD-style overlays, mono, glowing accents.",
            "dark",
            "#0A0E18",
            "#E0F7FF",
            "#39FF14",
            "sm",
        ),
        ex(
            "cyberbrutalist",
            "movement",
            "Cyberbrutalist",
            "Mono + neon, hard edges, terminal aesthetic.",
            "dark",
            "#000000",
            "#A8FF60",
            "#FF00C8",
            "none",
        ),
        ex(
            "liquid-glass",
            "movement",
            "Liquid Glass",
            "Apple WWDC25-style translucent depth.",
            "adaptive",
            "#F0F3F8",
            "#0F141C",
            "#0073E6",
            "lg",
        ),
        ex(
            "claymorphism",
            "movement",
            "Claymorphism",
            "Clay-like 3D, soft pastels, friendly.",
            "light",
            "#FDF6FF",
            "#2D2440",
            "#A78BFA",
            "lg",
        ),
        ex(
            "flat-2014",
            "movement",
            "Flat 2014",
            "Original iOS 7 / Material flat, vivid accents.",
            "light",
            "#FFFFFF",
            "#222222",
            "#3498DB",
            "sm",
        ),
        ex(
            "paper",
            "movement",
            "Paper",
            "Paper textures, deckled edges, warm ink tones.",
            "light",
            "#FAF6EC",
            "#1A1614",
            "#7F4A3B",
            "sm",
        ),
        ex(
            "terminal-tui",
            "movement",
            "Terminal / TUI",
            "Monospace everything, ANSI palette, no images.",
            "dark",
            "#000000",
            "#00FF00",
            "#FFFF00",
            "none",
        ),
        ex(
            "mid-century",
            "movement",
            "Mid-century",
            "Warm muted palette, serif + sans mix, geometric.",
            "light",
            "#EAE3D2",
            "#1F1A12",
            "#E2725B",
            "md",
        ),
        ex(
            "art-deco",
            "movement",
            "Art Deco",
            "Gold + black + cream, geometric, ornate borders.",
            "light",
            "#1A1A1A",
            "#F0E6CC",
            "#CFA84B",
            "sm",
        ),
        ex(
            "risograph",
            "movement",
            "Risograph",
            "Pink/teal/yellow overprint, grainy textures.",
            "light",
            "#FFFCEB",
            "#1A1A1A",
            "#FF407D",
            "sm",
        ),
        ex(
            "zine",
            "movement",
            "Zine",
            "DIY photocopy aesthetic, hand-drawn, asymmetric.",
            "light",
            "#F2EFE7",
            "#000000",
            "#000000",
            "none",
        ),
        ex(
            "data-vis",
            "movement",
            "Data viz",
            "High-contrast for charts, mono labels, ColorBrewer palettes.",
            "light",
            "#FFFFFF",
            "#0F172A",
            "#2563EB",
            "sm",
        ),
        // --- shadcn (extend the 3 already in the primary catalog) ---
        ex(
            "shadcn-new-york",
            "shadcn",
            "shadcn / New York",
            "Tighter spacing, sharper borders.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#2563EB",
            "sm",
        ),
        ex(
            "shadcn-slate",
            "shadcn",
            "shadcn / Slate",
            "Slate cool greys.",
            "adaptive",
            "#020617",
            "#F8FAFC",
            "#2563EB",
            "md",
        ),
        ex(
            "shadcn-stone",
            "shadcn",
            "shadcn / Stone",
            "Warm stone greys.",
            "adaptive",
            "#0C0A09",
            "#FAFAF9",
            "#2563EB",
            "md",
        ),
        ex(
            "shadcn-gray",
            "shadcn",
            "shadcn / Gray",
            "True gray.",
            "adaptive",
            "#030712",
            "#F9FAFB",
            "#2563EB",
            "md",
        ),
        ex(
            "shadcn-neutral",
            "shadcn",
            "shadcn / Neutral",
            "Neutral palette.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#2563EB",
            "md",
        ),
        ex(
            "shadcn-red",
            "shadcn",
            "shadcn / Red",
            "Red accent variant.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#DC2626",
            "md",
        ),
        ex(
            "shadcn-orange",
            "shadcn",
            "shadcn / Orange",
            "Orange accent.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#EA580C",
            "md",
        ),
        ex(
            "shadcn-green",
            "shadcn",
            "shadcn / Green",
            "Green accent.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#16A34A",
            "md",
        ),
        ex(
            "shadcn-blue",
            "shadcn",
            "shadcn / Blue",
            "Blue accent.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#2563EB",
            "md",
        ),
        ex(
            "shadcn-yellow",
            "shadcn",
            "shadcn / Yellow",
            "Yellow accent.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#EAB308",
            "md",
        ),
        ex(
            "shadcn-violet",
            "shadcn",
            "shadcn / Violet",
            "Violet accent.",
            "adaptive",
            "#0A0A0A",
            "#FAFAFA",
            "#7C3AED",
            "md",
        ),
        // --- daisyUI (extend the 1 already in the primary catalog) ---
        ex(
            "daisy-light",
            "daisyui",
            "daisyUI / Light",
            "Light defaults.",
            "light",
            "#FFFFFF",
            "#1F2937",
            "#570DF8",
            "md",
        ),
        ex(
            "daisy-dark",
            "daisyui",
            "daisyUI / Dark",
            "Dark defaults.",
            "dark",
            "#1D232A",
            "#A6ADBA",
            "#661AE6",
            "md",
        ),
        ex(
            "daisy-cupcake",
            "daisyui",
            "daisyUI / Cupcake",
            "Soft pink.",
            "light",
            "#FAF7F5",
            "#291334",
            "#65C3C8",
            "md",
        ),
        ex(
            "daisy-bumblebee",
            "daisyui",
            "daisyUI / Bumblebee",
            "Yellow + black.",
            "light",
            "#FFFFFF",
            "#181830",
            "#F9D72F",
            "md",
        ),
        ex(
            "daisy-emerald",
            "daisyui",
            "daisyUI / Emerald",
            "Emerald green.",
            "light",
            "#FFFFFF",
            "#333C4D",
            "#66CC8A",
            "md",
        ),
        ex(
            "daisy-corporate",
            "daisyui",
            "daisyUI / Corporate",
            "Corporate blue + gray.",
            "light",
            "#FFFFFF",
            "#181A2A",
            "#4B6BFB",
            "md",
        ),
        ex(
            "daisy-synthwave",
            "daisyui",
            "daisyUI / Synthwave",
            "Synthwave pink/purple.",
            "dark",
            "#2D1B69",
            "#F9F7FD",
            "#E779C1",
            "md",
        ),
        ex(
            "daisy-retro",
            "daisyui",
            "daisyUI / Retro",
            "Retro orange/cream.",
            "light",
            "#E4D8B4",
            "#2E282A",
            "#EF9995",
            "md",
        ),
        ex(
            "daisy-cyberpunk",
            "daisyui",
            "daisyUI / Cyberpunk",
            "Yellow/pink.",
            "light",
            "#FFEE00",
            "#11091A",
            "#FF7598",
            "none",
        ),
        ex(
            "daisy-valentine",
            "daisyui",
            "daisyUI / Valentine",
            "Soft pink.",
            "light",
            "#F0D6E8",
            "#632C3B",
            "#E96D7B",
            "md",
        ),
        ex(
            "daisy-halloween",
            "daisyui",
            "daisyUI / Halloween",
            "Orange/black.",
            "dark",
            "#212121",
            "#F1F2F4",
            "#F28C18",
            "md",
        ),
        ex(
            "daisy-garden",
            "daisyui",
            "daisyUI / Garden",
            "Green/cream.",
            "light",
            "#E9E7E7",
            "#100F10",
            "#5C7F67",
            "md",
        ),
        ex(
            "daisy-forest",
            "daisyui",
            "daisyUI / Forest",
            "Dark green.",
            "dark",
            "#171212",
            "#E6E6E6",
            "#1EB854",
            "md",
        ),
        ex(
            "daisy-aqua",
            "daisyui",
            "daisyUI / Aqua",
            "Teal/cyan.",
            "dark",
            "#345DA7",
            "#F8D766",
            "#09ECF3",
            "md",
        ),
        ex(
            "daisy-lofi",
            "daisyui",
            "daisyUI / Lofi",
            "Muted.",
            "light",
            "#FFFFFF",
            "#0D0D0D",
            "#0D0D0D",
            "sm",
        ),
        ex(
            "daisy-pastel",
            "daisyui",
            "daisyUI / Pastel",
            "Soft pastels.",
            "light",
            "#FFFFFF",
            "#454754",
            "#D1C1D7",
            "md",
        ),
        ex(
            "daisy-fantasy",
            "daisyui",
            "daisyUI / Fantasy",
            "Purple.",
            "light",
            "#FFFFFF",
            "#1F2937",
            "#6E0B75",
            "md",
        ),
        ex(
            "daisy-wireframe",
            "daisyui",
            "daisyUI / Wireframe",
            "Outline-only.",
            "light",
            "#FFFFFF",
            "#000000",
            "#B8B8B8",
            "none",
        ),
        ex(
            "daisy-black",
            "daisyui",
            "daisyUI / Black",
            "Pure black.",
            "dark",
            "#000000",
            "#FFFFFF",
            "#373737",
            "none",
        ),
        ex(
            "daisy-luxury",
            "daisyui",
            "daisyUI / Luxury",
            "Black/gold.",
            "dark",
            "#171618",
            "#DCA54C",
            "#FFFFFF",
            "md",
        ),
        ex(
            "daisy-cmyk",
            "daisyui",
            "daisyUI / CMYK",
            "CMYK primaries.",
            "light",
            "#FFFFFF",
            "#1F2937",
            "#45AEEE",
            "md",
        ),
        ex(
            "daisy-autumn",
            "daisyui",
            "daisyUI / Autumn",
            "Warm autumn.",
            "light",
            "#F1F1F1",
            "#1F2937",
            "#8C0327",
            "md",
        ),
        ex(
            "daisy-business",
            "daisyui",
            "daisyUI / Business",
            "Business neutral.",
            "dark",
            "#202020",
            "#F2F2F2",
            "#1C4E80",
            "sm",
        ),
        ex(
            "daisy-acid",
            "daisyui",
            "daisyUI / Acid",
            "Acid bright green.",
            "light",
            "#FAFAFA",
            "#000000",
            "#FF00F4",
            "md",
        ),
        ex(
            "daisy-lemonade",
            "daisyui",
            "daisyUI / Lemonade",
            "Yellow/pink.",
            "light",
            "#F9FFE9",
            "#1F1F1F",
            "#519903",
            "md",
        ),
        ex(
            "daisy-night",
            "daisyui",
            "daisyUI / Night",
            "Dark blue.",
            "dark",
            "#0F172A",
            "#B6C5D1",
            "#38BDF8",
            "md",
        ),
        ex(
            "daisy-coffee",
            "daisyui",
            "daisyUI / Coffee",
            "Coffee brown.",
            "dark",
            "#20161F",
            "#D8C7B2",
            "#DB924B",
            "md",
        ),
        ex(
            "daisy-winter",
            "daisyui",
            "daisyUI / Winter",
            "Cool blue.",
            "light",
            "#FFFFFF",
            "#394E6A",
            "#047AFF",
            "md",
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
    fn catalog_ships_at_least_80_themes() {
        let cat = builtin_catalog();
        assert!(
            cat.len() >= 80,
            "expected ≥80 themes per plan; have {}",
            cat.len()
        );
    }

    #[test]
    fn catalog_has_no_duplicate_slugs() {
        let cat = builtin_catalog();
        let mut seen = std::collections::HashSet::new();
        for theme in &cat {
            assert!(
                seen.insert(theme.slug.clone()),
                "duplicate slug: {}",
                theme.slug
            );
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
