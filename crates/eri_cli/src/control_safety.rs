//! Safety layer for the hands-free control loop: **cancellation**, **sensitive-
//! action refusal**, and a **persistable permission allowlist**.
//!
//! Why this is its own module: [`control_agent`](crate::control_agent) drives the
//! plan→act→observe loop; this file holds the *deterministic guarantees* that sit
//! in front of every actuation — the things that must be true regardless of what
//! the model decides. The model can be steered by a prompt; these are enforced in
//! code so they can't be talked around.
//!
//! Three guarantees:
//! 1. **Cancellation** — when the user retracts ("no, stop, forget it"), eri must
//!    drop the command cleanly. It is NOT actuated and NOT folded back into the
//!    reasoning/situation feed as a thing the user "wants."
//! 2. **Refusal** — certain actions are never eri's to take: typing a password,
//!    entering card/bank/SSN/secret data, moving money, solving a CAPTCHA. eri
//!    hands these back to the user with a clear spoken statement.
//! 3. **Permissions** — a Claude-style allowlist the user can extend ("you can do
//!    this next time"). Granted categories skip the per-action confirm; the store
//!    persists so the grant survives restarts.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

// ───────────────────────────── Cancellation ─────────────────────────────

/// Phrases that mean "stop / don't / I take it back." Matched case-insensitively
/// as whole-utterance or leading intent. Kept broad on purpose: the cost of a
/// false stop (eri pauses and re-asks) is far lower than ignoring a real "no."
const STOP_PHRASES: &[&str] = &[
    "stop",
    "stop it",
    "stop that",
    "stop stop",
    "cancel",
    "cancel that",
    "cancel it",
    "never mind",
    "nevermind",
    "forget it",
    "forget that",
    "scratch that",
    "belay that",
    "disregard",
    "disregard that",
    "ignore that",
    "abort",
    "abort that",
    "halt",
    "wait no",
    "no wait",
    "hold on",
    "hold up",
    "actually no",
    "actually don't",
    "actually, no",
    "don't do that",
    "do not do that",
    "dont do that",
    "don't",
    "do not",
    "leave it",
    "leave that",
    "drop it",
    "skip it",
    "skip that",
    "not that",
    "no not that",
    "i changed my mind",
    "changed my mind",
    "undo that",
    "back off",
    "enough",
    "quit it",
];

/// Standalone short utterances that are unambiguous stops on their own.
const STOP_EXACT: &[&str] = &[
    "no", "nope", "nah", "stop", "wait", "halt", "abort", "cancel",
];

/// Does this utterance retract / try to stop the current action?
///
/// True when the (normalized) text *equals* a clear stop word, or *begins with*
/// or *contains* a stop phrase. We accept "contains" for multi-word phrases
/// because real speech wraps them ("uh yeah no actually cancel that one").
pub fn is_cancellation(utterance: &str) -> bool {
    let norm = normalize(utterance);
    if norm.is_empty() {
        return false;
    }
    if STOP_EXACT.contains(&norm.as_str()) {
        return true;
    }
    // Leading "no" / "no, ..." is a retraction even with trailing words.
    if norm == "no" || norm.starts_with("no ") || norm.starts_with("no,") {
        return true;
    }
    STOP_PHRASES.iter().any(|p| norm == *p || norm.contains(p))
}

/// Lowercase, trim, collapse internal whitespace, strip surrounding punctuation.
fn normalize(s: &str) -> String {
    let lowered = s.to_lowercase();
    let collapsed = lowered.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .trim_matches(|c: char| matches!(c, '.' | '!' | '?' | ',' | ';' | ':' | '"' | '\''))
        .to_string()
}

// ───────────────────────────── Refusal ─────────────────────────────

/// A category of action eri must never perform itself. These are handed back to
/// the user — eri states what it won't do and why, and waits for them to do it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefusalKind {
    /// Passwords, passphrases, PINs, 2FA/OTP codes, API keys, secrets.
    Credential,
    /// Card/bank/account numbers, SSN, gov IDs, or moving money.
    Financial,
    /// CAPTCHA / "prove you're human" challenges.
    Captcha,
    /// Changing access controls, sharing, or security settings.
    AccessControl,
}

impl RefusalKind {
    /// What eri says when it refuses — plain, reassuring, and actionable. eri
    /// never frames this as inability; it's a deliberate boundary.
    pub fn handback_message(self) -> &'static str {
        match self {
            RefusalKind::Credential => {
                "I won't type your password or any secret — that's yours to enter. \
                 Go ahead and type it yourself, then tell me to continue."
            }
            RefusalKind::Financial => {
                "I won't enter bank, card, or ID numbers, and I don't move money. \
                 Please do that part yourself; I'll pick the task back up after."
            }
            RefusalKind::Captcha => {
                "I can't complete CAPTCHAs or human-verification checks. \
                 Please solve it, then let me know to keep going."
            }
            RefusalKind::AccessControl => {
                "Changing permissions, sharing, or security settings is yours to \
                 do — I won't touch access controls. Make the change and I'll continue."
            }
        }
    }
}

/// Phrase → kind table for the refusal classifier. Substring, case-insensitive.
const REFUSAL_PATTERNS: &[(&str, RefusalKind)] = &[
    // Credentials / secrets
    ("password", RefusalKind::Credential),
    ("passphrase", RefusalKind::Credential),
    ("passwd", RefusalKind::Credential),
    ("pin number", RefusalKind::Credential),
    ("pin code", RefusalKind::Credential),
    ("2fa", RefusalKind::Credential),
    ("two-factor", RefusalKind::Credential),
    ("one-time code", RefusalKind::Credential),
    ("one time code", RefusalKind::Credential),
    ("otp", RefusalKind::Credential),
    ("verification code", RefusalKind::Credential),
    ("api key", RefusalKind::Credential),
    ("secret key", RefusalKind::Credential),
    ("private key", RefusalKind::Credential),
    ("access token", RefusalKind::Credential),
    ("seed phrase", RefusalKind::Credential),
    ("recovery phrase", RefusalKind::Credential),
    ("mnemonic phrase", RefusalKind::Credential),
    // Financial / identity
    ("credit card", RefusalKind::Financial),
    ("debit card", RefusalKind::Financial),
    ("card number", RefusalKind::Financial),
    ("cvv", RefusalKind::Financial),
    ("cvc", RefusalKind::Financial),
    ("routing number", RefusalKind::Financial),
    ("account number", RefusalKind::Financial),
    ("iban", RefusalKind::Financial),
    ("swift code", RefusalKind::Financial),
    ("sort code", RefusalKind::Financial),
    ("social security", RefusalKind::Financial),
    ("ssn", RefusalKind::Financial),
    ("passport number", RefusalKind::Financial),
    ("wire transfer", RefusalKind::Financial),
    ("send money", RefusalKind::Financial),
    ("transfer funds", RefusalKind::Financial),
    ("buy stock", RefusalKind::Financial),
    ("sell stock", RefusalKind::Financial),
    ("place an order", RefusalKind::Financial),
    // CAPTCHA
    ("captcha", RefusalKind::Captcha),
    ("recaptcha", RefusalKind::Captcha),
    ("i'm not a robot", RefusalKind::Captcha),
    ("im not a robot", RefusalKind::Captcha),
    ("prove you're human", RefusalKind::Captcha),
    // Access control
    ("change permission", RefusalKind::AccessControl),
    ("sharing settings", RefusalKind::AccessControl),
    ("make it public", RefusalKind::AccessControl),
    ("make this public", RefusalKind::AccessControl),
    ("grant access to", RefusalKind::AccessControl),
    ("security settings", RefusalKind::AccessControl),
];

/// Classify text (a typed string, or the user's goal) as a refusal category, if
/// any. Returns the FIRST matching kind. `None` means "nothing sensitive here."
pub fn classify_refusal(text: &str) -> Option<RefusalKind> {
    let t = text.to_lowercase();
    if let Some((_, kind)) = REFUSAL_PATTERNS.iter().find(|(p, _)| t.contains(p)) {
        return Some(*kind);
    }
    // Combined heuristic: "make/set ... public" is an access-control change even
    // with words in between ("make this doc public"). Kept narrow — both tokens
    // must be present — so benign uses of "public" alone don't trip it.
    if t.contains("public") && (t.contains("make ") || t.contains("set ")) {
        return Some(RefusalKind::AccessControl);
    }
    None
}

// ───────────────────────────── Permissions ─────────────────────────────

/// A capability the user can grant once and have eri remember. Granting a
/// capability lets the gate skip the per-action confirmation for that category.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    /// Quit / force-quit applications without re-confirming each time.
    QuitApps,
    /// Run keyboard shortcuts that delete (⌘⌫, etc.).
    DestructiveKeys,
    /// Type commands that look destructive (gated by `looks_destructive`).
    DestructiveCommands,
    /// Open applications (low-risk; here so it can be explicitly managed).
    OpenApps,
}

impl Permission {
    pub fn label(self) -> &'static str {
        match self {
            Permission::QuitApps => "quit applications",
            Permission::DestructiveKeys => "use delete shortcuts",
            Permission::DestructiveCommands => "run destructive commands",
            Permission::OpenApps => "open applications",
        }
    }
}

/// Normalize an app name for denylist comparison: lowercase, trim, drop a
/// trailing `.app`. So "Discord", "discord", and "Discord.app" all match.
pub fn normalize_app_name(name: &str) -> String {
    let lowered = name.trim().to_lowercase();
    lowered
        .strip_suffix(".app")
        .unwrap_or(&lowered)
        .trim()
        .to_string()
}

/// A persistable allowlist of granted permissions plus a per-app **denylist**.
///
/// Refusals (credentials, money, CAPTCHAs, access control) are intentionally NOT
/// representable here — they can never be granted away, by design.
///
/// The app denylist is the user's "don't look at these apps" boundary: any app
/// on it is off-limits to perception (snapshot/capture) and actuation, enforced
/// in the control loop before eri ever reads or touches it.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PermissionStore {
    granted: BTreeSet<Permission>,
    /// Normalized app names eri must not look at or act on. `#[serde(default)]`
    /// so permission files written before this field existed still load.
    #[serde(default)]
    denied_apps: BTreeSet<String>,
    /// P8 (Meta-Policy Reflexion): action descriptions the user has repeatedly
    /// UNDONE — eri learns to ask first next time, even for otherwise-allowed
    /// actions. A persistent policy distilled from the action log, not a one-off.
    #[serde(default)]
    cautions: BTreeSet<String>,
}

impl PermissionStore {
    /// Default on-disk location: `~/.config/eri/control_permissions.json`.
    pub fn default_path() -> Option<PathBuf> {
        dirs_config_dir().map(|d| d.join("eri").join("control_permissions.json"))
    }

    /// Load from `path`; a missing file is an empty store (not an error).
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Persist to `path`, creating parent directories as needed.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into());
        std::fs::write(path, json)
    }

    pub fn grant(&mut self, perm: Permission) {
        self.granted.insert(perm);
    }

    pub fn is_granted(&self, perm: Permission) -> bool {
        self.granted.contains(&perm)
    }

    pub fn granted(&self) -> impl Iterator<Item = &Permission> {
        self.granted.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.granted.is_empty() && self.denied_apps.is_empty() && self.cautions.is_empty()
    }

    // ── P8: learned cautions (meta-policy reflexion over the action log) ──

    /// Mark an action description as cautioned — eri will ask before doing it,
    /// even if it's normally allowed, because the user kept undoing it.
    pub fn add_caution(&mut self, description: &str) {
        let d = description.trim();
        if !d.is_empty() {
            self.cautions.insert(d.to_string());
        }
    }

    /// Fold a batch of learned caution patterns in (from the action log). Returns
    /// how many were newly added, so the caller can persist only when it changed.
    pub fn absorb_cautions<I: IntoIterator<Item = String>>(&mut self, patterns: I) -> usize {
        let before = self.cautions.len();
        for p in patterns {
            self.add_caution(&p);
        }
        self.cautions.len() - before
    }

    /// Should eri ask before this action (a learned caution)? Exact match on the
    /// action description (the same `describe()` text recorded in the log).
    pub fn is_cautioned(&self, description: &str) -> bool {
        self.cautions.contains(description.trim())
    }

    // ── per-app denylist ("don't look at Discord") ──

    /// Add an app to the denylist. Stored normalized so future lookups match
    /// regardless of casing or a `.app` suffix.
    pub fn deny_app(&mut self, app: &str) {
        let norm = normalize_app_name(app);
        if !norm.is_empty() {
            self.denied_apps.insert(norm);
        }
    }

    /// Remove an app from the denylist. Returns true if it was present.
    pub fn allow_app(&mut self, app: &str) -> bool {
        self.denied_apps.remove(&normalize_app_name(app))
    }

    /// Is this app off-limits? Compared on the normalized name, so "Discord",
    /// "discord", and "Discord.app" all resolve to the same denial.
    pub fn is_app_denied(&self, app: &str) -> bool {
        self.denied_apps.contains(&normalize_app_name(app))
    }

    pub fn denied_apps(&self) -> impl Iterator<Item = &String> {
        self.denied_apps.iter()
    }
}

/// Resolve the XDG/macOS config dir without pulling a new dependency: prefer
/// `$XDG_CONFIG_HOME`, else `$HOME/.config`.
fn dirs_config_dir() -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME")
        && !xdg.is_empty()
    {
        return Some(PathBuf::from(xdg));
    }
    std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join(".config"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_plain_stops() {
        for s in [
            "stop",
            "Stop!",
            "  CANCEL  ",
            "no",
            "Nope.",
            "wait",
            "abort",
        ] {
            assert!(is_cancellation(s), "should cancel: {s:?}");
        }
    }

    #[test]
    fn detects_phrasal_retractions() {
        for s in [
            "no wait, don't do that",
            "actually, never mind",
            "uh yeah no actually cancel that one",
            "hold on",
            "scratch that",
            "I changed my mind",
            "forget it",
        ] {
            assert!(is_cancellation(s), "should cancel: {s:?}");
        }
    }

    #[test]
    fn does_not_cancel_normal_commands() {
        for s in [
            "open my email",
            "search youtube for lofi",
            "know what's on my screen",
            "now open the inbox",
            "go to notion",
        ] {
            assert!(!is_cancellation(s), "should NOT cancel: {s:?}");
        }
    }

    #[test]
    fn refuses_credentials_and_money() {
        assert_eq!(
            classify_refusal("type my password hunter2"),
            Some(RefusalKind::Credential)
        );
        assert_eq!(
            classify_refusal("enter the OTP from my phone"),
            Some(RefusalKind::Credential)
        );
        assert_eq!(
            classify_refusal("put in my credit card number"),
            Some(RefusalKind::Financial)
        );
        assert_eq!(
            classify_refusal("wire transfer 500 dollars"),
            Some(RefusalKind::Financial)
        );
        assert_eq!(
            classify_refusal("solve the captcha"),
            Some(RefusalKind::Captcha)
        );
        assert_eq!(
            classify_refusal("make this doc public"),
            Some(RefusalKind::AccessControl)
        );
    }

    #[test]
    fn allows_benign_text() {
        assert_eq!(classify_refusal("type hello world"), None);
        assert_eq!(classify_refusal("click the blue button"), None);
    }

    #[test]
    fn handback_messages_are_nonempty_and_firm() {
        for k in [
            RefusalKind::Credential,
            RefusalKind::Financial,
            RefusalKind::Captcha,
            RefusalKind::AccessControl,
        ] {
            assert!(k.handback_message().len() > 20);
        }
    }

    #[test]
    fn permission_store_roundtrips() {
        let dir = std::env::temp_dir().join(format!("eri_perm_test_{}", std::process::id()));
        let path = dir.join("perms.json");
        let _ = std::fs::remove_dir_all(&dir);

        let mut store = PermissionStore::default();
        assert!(store.is_empty());
        store.grant(Permission::QuitApps);
        store.grant(Permission::OpenApps);
        store.save(&path).unwrap();

        let loaded = PermissionStore::load(&path);
        assert!(loaded.is_granted(Permission::QuitApps));
        assert!(loaded.is_granted(Permission::OpenApps));
        assert!(!loaded.is_granted(Permission::DestructiveKeys));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_permission_file_is_empty_store() {
        let store = PermissionStore::load(Path::new("/nonexistent/eri/perms.json"));
        assert!(store.is_empty());
    }

    #[test]
    fn learned_cautions_absorb_dedupe_and_gate_lookup() {
        let mut store = PermissionStore::default();
        // Two of the same pattern collapse to one new caution (a set).
        let added = store.absorb_cautions(vec!["open Safari".into(), "open Safari".into()]);
        assert_eq!(added, 1);
        assert!(store.is_cautioned("open Safari"));
        assert!(store.is_cautioned("  open Safari  "), "trimmed lookup matches");
        assert!(!store.is_cautioned("open Mail"));
        assert!(!store.is_empty(), "a caution makes the store non-empty");
        // Idempotent: re-absorbing the same one adds nothing.
        assert_eq!(store.absorb_cautions(vec!["open Safari".into()]), 0);
    }

    #[test]
    fn app_denylist_matches_regardless_of_case_or_suffix() {
        let mut store = PermissionStore::default();
        store.deny_app("Discord");
        // Same app, different surface forms all resolve to one denial.
        assert!(store.is_app_denied("discord"));
        assert!(store.is_app_denied("Discord.app"));
        assert!(store.is_app_denied("  DISCORD  "));
        // An app that was never denied is allowed.
        assert!(!store.is_app_denied("Mail"));
        // Adding the same app twice doesn't duplicate it.
        store.deny_app("discord.app");
        assert_eq!(store.denied_apps().count(), 1);
    }

    #[test]
    fn app_denylist_allow_removes_and_reports() {
        let mut store = PermissionStore::default();
        store.deny_app("Slack");
        assert!(store.is_app_denied("slack"));
        assert!(store.allow_app("Slack")); // present → removed
        assert!(!store.is_app_denied("slack"));
        assert!(!store.allow_app("Slack")); // already gone → false
    }

    #[test]
    fn app_denylist_persists_across_save_load() {
        let dir = std::env::temp_dir().join(format!("eri_deny_test_{}", std::process::id()));
        let path = dir.join("perms.json");
        let _ = std::fs::remove_dir_all(&dir);

        let mut store = PermissionStore::default();
        store.grant(Permission::OpenApps);
        store.deny_app("Discord");
        store.deny_app("1Password");
        store.save(&path).unwrap();

        let loaded = PermissionStore::load(&path);
        assert!(loaded.is_granted(Permission::OpenApps));
        assert!(loaded.is_app_denied("discord"));
        assert!(loaded.is_app_denied("1password"));
        assert!(!loaded.is_app_denied("mail"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_permission_file_without_denylist_still_loads() {
        // A file written before the denylist field existed (only `granted`).
        let dir = std::env::temp_dir().join(format!("eri_legacy_test_{}", std::process::id()));
        let path = dir.join("perms.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"{"granted":["quit_apps"]}"#).unwrap();

        let loaded = PermissionStore::load(&path);
        assert!(loaded.is_granted(Permission::QuitApps));
        assert_eq!(loaded.denied_apps().count(), 0); // serde(default) → empty set

        let _ = std::fs::remove_dir_all(&dir);
    }
}
