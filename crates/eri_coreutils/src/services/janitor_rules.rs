//! Event-triggered Janitor rules (Phase 17a).
//!
//! A workspace can opt into automatic actions by dropping a
//! `.eri/janitor.json` file at its root:
//!
//! ```json
//! {
//!   "rules": [
//!     { "id": "test-db",  "on": "save:**/*.sql", "run": "/test --path=tests/db" },
//!     { "id": "lint-ts",  "on": "save:**/*.ts",  "run": "/refactor --lint" }
//!   ]
//! }
//! ```
//!
//! The sidecar parses + validates the file; the IDE watches the
//! workspace for save events and fires the `run` command of any rule
//! whose `on` glob matches the saved path. Triggers fire at most once
//! per second per rule (debounced upstream).
//!
//! Today only `save:<glob>` is recognised; later phases will add
//! `idle:`, `branch-change:`, and `pr-opened:` triggers using the
//! same envelope.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// One rule entry from `<workspace>/.eri/janitor.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JanitorRule {
    /// Stable id used by the IDE to debounce repeated fires.
    pub id: String,
    /// Trigger of the form `<kind>:<pattern>`. v1: `save:<glob>`.
    pub on: String,
    /// Slash-command to dispatch when the trigger matches.
    pub run: String,
    /// Optional human-readable description shown in the audit log.
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JanitorRulesFile {
    #[serde(default)]
    pub rules: Vec<JanitorRule>,
}

/// Reads `<workspace>/.eri/janitor.json` and returns the parsed rule
/// set. Missing file → empty rule set; malformed JSON → error.
pub fn load_rules(workspace: &Path) -> Result<JanitorRulesFile, String> {
    let path = workspace.join(".eri").join("janitor.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(JanitorRulesFile::default());
        }
        Err(err) => return Err(format!("read {}: {err}", path.display())),
    };
    serde_json::from_str(&raw).map_err(|e| format!("parse {}: {e}", path.display()))
}

/// Pre-parsed trigger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trigger {
    Save { pattern: String },
    Unknown(String),
}

pub fn parse_trigger(on: &str) -> Trigger {
    if let Some(rest) = on.strip_prefix("save:") {
        return Trigger::Save {
            pattern: rest.to_string(),
        };
    }
    Trigger::Unknown(on.to_string())
}

/// Match a saved file path against a rule glob. Supports the same `**`,
/// `*`, and `?` semantics as gitignore — leading `**/` matches any
/// prefix, trailing `/**` matches any suffix.
///
/// Returns `false` for `Trigger::Unknown` so unsupported kinds never
/// accidentally fire.
pub fn trigger_matches(trigger: &Trigger, saved_relpath: &str) -> bool {
    match trigger {
        Trigger::Save { pattern } => glob_match(pattern, saved_relpath),
        Trigger::Unknown(_) => false,
    }
}

/// Tiny gitignore-style glob matcher. Implements `**`, `*`, `?`. We
/// roll our own (instead of pulling `globset`) because the patterns
/// are tiny + we never trust them as security boundaries.
fn glob_match(pattern: &str, input: &str) -> bool {
    // Anchor by walking both sides in lockstep.
    let pat_chars: Vec<char> = pattern.chars().collect();
    let in_chars: Vec<char> = input.chars().collect();
    matches_at(&pat_chars, 0, &in_chars, 0)
}

fn matches_at(pat: &[char], pi: usize, input: &[char], ii: usize) -> bool {
    // End of pattern → must also be end of input.
    if pi >= pat.len() {
        return ii >= input.len();
    }
    // `**` → match any sequence (including '/').
    if pi + 1 < pat.len() && pat[pi] == '*' && pat[pi + 1] == '*' {
        // Skip optional trailing slash after `**`.
        let next = if pi + 2 < pat.len() && pat[pi + 2] == '/' {
            pi + 3
        } else {
            pi + 2
        };
        // Try matching zero or more characters of input.
        for advance in 0..=(input.len() - ii) {
            if matches_at(pat, next, input, ii + advance) {
                return true;
            }
        }
        return false;
    }
    // `*` → match any sequence except '/'.
    if pat[pi] == '*' {
        for advance in 0..=(input.len() - ii) {
            // Block crossing path separators with single `*`.
            if advance > 0 && input[ii + advance - 1] == '/' {
                return false;
            }
            if matches_at(pat, pi + 1, input, ii + advance) {
                return true;
            }
        }
        return false;
    }
    // `?` → match exactly one non-slash character.
    if pat[pi] == '?' {
        if ii >= input.len() || input[ii] == '/' {
            return false;
        }
        return matches_at(pat, pi + 1, input, ii + 1);
    }
    // Literal char.
    if ii < input.len() && pat[pi] == input[ii] {
        return matches_at(pat, pi + 1, input, ii + 1);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_rules_returns_empty_when_file_missing() {
        let dir = TempDir::new().unwrap();
        let rules = load_rules(dir.path()).unwrap();
        assert!(rules.rules.is_empty());
    }

    #[test]
    fn load_rules_parses_well_formed_file() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".eri")).unwrap();
        std::fs::write(
            dir.path().join(".eri").join("janitor.json"),
            r#"{
                "rules": [
                    { "id": "test-db", "on": "save:**/*.sql", "run": "/test --path=tests/db" }
                ]
            }"#,
        )
        .unwrap();
        let rules = load_rules(dir.path()).unwrap();
        assert_eq!(rules.rules.len(), 1);
        assert_eq!(rules.rules[0].id, "test-db");
        assert_eq!(rules.rules[0].on, "save:**/*.sql");
        assert_eq!(rules.rules[0].run, "/test --path=tests/db");
    }

    #[test]
    fn load_rules_propagates_malformed_json() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join(".eri")).unwrap();
        std::fs::write(dir.path().join(".eri").join("janitor.json"), "not json").unwrap();
        assert!(load_rules(dir.path()).is_err());
    }

    #[test]
    fn parse_trigger_recognises_save_prefix() {
        assert_eq!(
            parse_trigger("save:**/*.sql"),
            Trigger::Save {
                pattern: "**/*.sql".into()
            }
        );
        assert_eq!(
            parse_trigger("idle:5m"),
            Trigger::Unknown("idle:5m".into())
        );
    }

    #[test]
    fn glob_match_handles_double_star() {
        assert!(glob_match("**/*.sql", "migrations/001.sql"));
        assert!(glob_match("**/*.sql", "001.sql"));
        assert!(!glob_match("**/*.sql", "001.ts"));
    }

    #[test]
    fn glob_match_blocks_slash_with_single_star() {
        assert!(glob_match("src/*.ts", "src/foo.ts"));
        assert!(!glob_match("src/*.ts", "src/sub/foo.ts"));
    }

    #[test]
    fn trigger_matches_save_glob() {
        let trigger = parse_trigger("save:**/*.sql");
        assert!(trigger_matches(&trigger, "supabase/migrations/0007.sql"));
        assert!(!trigger_matches(&trigger, "src/foo.ts"));
    }

    #[test]
    fn unknown_trigger_never_fires() {
        let trigger = parse_trigger("unknown-kind:foo");
        assert!(!trigger_matches(&trigger, "anything"));
    }
}
