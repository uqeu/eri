//! Templates (Phase 23a) — curated starting points for `/new <slug>`.
//!
//! The IDE consumes `eri/templates/list` to render a picker; the
//! actual scaffold (clone-or-extract bundle + customise to user's
//! preferences) lives client-side because the IDE owns the workspace
//! filesystem and the user-facing confirmation flow.
//!
//! Eight starter templates ship inline. A future revision will load
//! additional ZIP bundles from `$ERI_RESOURCES/templates/` and a
//! remote catalog at `https://tryeri.ca/api/v1/templates/list`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::Services;
use crate::{DispatchError, SharedTierState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateEntry {
    pub slug: String,
    pub display_name: String,
    pub description: String,
    /// One of: `next`, `vite-react`, `astro`, `axum`, `fastapi`,
    /// `expo`, `chrome-ext`, `eri-workbench`.
    pub family: String,
    /// Concrete stack labels surfaced in the picker (e.g.
    /// `["Next.js 15", "Tailwind", "shadcn/ui", "Stripe", "Supabase"]`).
    pub stack: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListReport {
    templates: Vec<TemplateEntry>,
}

pub async fn list(
    _params: Value,
    _tier_state: &SharedTierState,
    _services: &std::sync::Arc<Services>,
) -> Result<Value, DispatchError> {
    serde_json::to_value(ListReport {
        templates: builtin_templates(),
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

pub fn builtin_templates() -> Vec<TemplateEntry> {
    vec![
        TemplateEntry {
            slug: "saas-next".into(),
            display_name: "SaaS — Next.js".into(),
            description:
                "Full-stack SaaS starter with auth, billing, and DB ready out of the box.".into(),
            family: "next".into(),
            stack: vec![
                "Next.js 15".into(),
                "Tailwind".into(),
                "shadcn/ui".into(),
                "Stripe".into(),
                "Supabase".into(),
                "Vercel".into(),
            ],
        },
        TemplateEntry {
            slug: "spa-vite".into(),
            display_name: "SPA — Vite + React".into(),
            description: "Single-page app starter with file-based routing and Tailwind.".into(),
            family: "vite-react".into(),
            stack: vec![
                "Vite".into(),
                "React".into(),
                "TanStack Router".into(),
                "Tailwind".into(),
            ],
        },
        TemplateEntry {
            slug: "content-astro".into(),
            display_name: "Content — Astro + MDX".into(),
            description: "Marketing / blog / docs starter with MDX and Decap CMS.".into(),
            family: "astro".into(),
            stack: vec![
                "Astro".into(),
                "MDX".into(),
                "Tailwind".into(),
                "Decap CMS".into(),
            ],
        },
        TemplateEntry {
            slug: "api-rust".into(),
            display_name: "API — Rust (axum)".into(),
            description: "Async REST API with sqlx + Postgres + tokio + docker.".into(),
            family: "axum".into(),
            stack: vec![
                "axum".into(),
                "sqlx".into(),
                "Postgres".into(),
                "tokio".into(),
                "docker".into(),
            ],
        },
        TemplateEntry {
            slug: "api-python".into(),
            display_name: "API — Python (FastAPI)".into(),
            description: "FastAPI with Pydantic v2, SQLAlchemy 2.0, uv, and ruff.".into(),
            family: "fastapi".into(),
            stack: vec![
                "FastAPI".into(),
                "Pydantic v2".into(),
                "SQLAlchemy 2.0".into(),
                "uv".into(),
                "ruff".into(),
            ],
        },
        TemplateEntry {
            slug: "mobile-expo".into(),
            display_name: "Mobile — Expo".into(),
            description: "Cross-platform mobile app with Expo, Tamagui, and Supabase.".into(),
            family: "expo".into(),
            stack: vec![
                "Expo".into(),
                "React Native".into(),
                "Tamagui".into(),
                "Supabase".into(),
            ],
        },
        TemplateEntry {
            slug: "chrome-ext".into(),
            display_name: "Chrome extension".into(),
            description: "Manifest V3 extension with Vite + React + TypeScript.".into(),
            family: "chrome-ext".into(),
            stack: vec![
                "Manifest V3".into(),
                "Vite".into(),
                "React".into(),
                "TypeScript".into(),
            ],
        },
        TemplateEntry {
            slug: "eri-workbench-ext".into(),
            display_name: "Eri workbench extension".into(),
            description: "Agent surface extension with a typed command bridge.".into(),
            family: "eri-workbench".into(),
            stack: vec!["Agent surface".into(), "TypeScript".into(), "esbuild".into()],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_templates_cover_eight_starter_families() {
        let templates = builtin_templates();
        assert_eq!(templates.len(), 8);
        let families: std::collections::HashSet<&str> =
            templates.iter().map(|t| t.family.as_str()).collect();
        for needed in [
            "next",
            "vite-react",
            "astro",
            "axum",
            "fastapi",
            "expo",
            "chrome-ext",
            "eri-workbench",
        ] {
            assert!(families.contains(needed), "missing family {needed}");
        }
    }

    #[test]
    fn each_template_has_at_least_one_stack_label() {
        for t in builtin_templates() {
            assert!(!t.stack.is_empty(), "template {} has empty stack", t.slug);
        }
    }

    #[test]
    fn builtin_templates_do_not_expose_competitor_shell_names() {
        let forbidden = [
            "mercury",
            "sonnet",
            "haiku",
            "gemini",
            "openai",
            "anthropic",
            "vscode",
            "vscodium",
            "visual studio code",
            "claude",
            "cursor",
            "antigravity",
        ];
        for template in builtin_templates() {
            let public_text = format!(
                "{}\n{}\n{}\n{}\n{}",
                template.slug,
                template.display_name,
                template.description,
                template.family,
                template.stack.join("\n")
            )
            .to_lowercase();
            assert!(
                !forbidden.iter().any(|term| public_text.contains(term)),
                "template {} exposes a forbidden shell/provider name",
                template.slug
            );
        }
    }
}
