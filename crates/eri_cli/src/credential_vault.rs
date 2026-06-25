//! The credential vault — eri signs you into a saved site **without ever seeing
//! the secret**. Aside's one real gap, closed: the model gets a *capability*
//! ("fill the saved password here"), never the *value*.
//!
//! This upgrades the control loop's behavior from "eri refuses to type your
//! password" → "eri signs you in and never sees the secret," which is strictly
//! better and on-brand for visible trust. It is an **additive** path beside the
//! existing refusal boundary ([`crate::control_safety::classify_refusal`]): a
//! model-dictated `Type("hunter2")` is still refused; the ONLY way a secret is
//! entered is an explicit, origin-matched, approved [`CredentialVault::fill`].
//!
//! ## The non-negotiable invariant
//! A saved secret value NEVER reaches: the model's context/prompt, the
//! [`ActionLog`] description, any log line, stdout, or the control-server stream.
//! It travels exactly one path: **Keychain → bridge fill → OS input field.**
//! Everything else sees only a *reference* (`vault:github.com/password`). The
//! [`Secret`] newtype enforces this in the type system — it does not print, does
//! not serialize, and is zeroized on drop.
//!
//! ## No hand-rolled crypto
//! Secrets live in the **macOS Keychain (Secure Enclave-backed)** via
//! [`KeychainStore`]; [`zeroize`] wipes the in-memory copy. We never implement
//! our own hashing/encryption — the OS keystore is the root of trust.

use std::path::Path;
use std::sync::{Arc, Mutex};
// Test-only: the in-memory store's map + read counter.
#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::action_log::ActionLog;
use crate::control_agent::ControlBridge;
use crate::control_safety::{PermissionStore, normalize_origin};

// ───────────────────────────── Secret ─────────────────────────────

/// A secret value that **never prints, never serializes, and is zeroized on
/// drop**. The compiler is the enforcement: there is no `Serialize` impl (by
/// omission), and `Debug`/`Display` render `Secret(***)`. The only way to read
/// the value is [`Secret::expose_secret`], whose sole caller is the bridge's
/// `fill_secret` — the OS-field actuator at the end of the one allowed path.
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(Zeroizing::new(value.into()))
    }

    /// Read the raw secret to actually fill it into the OS field. **Deliberately
    /// named** so every call site is auditable: the ONLY legitimate caller is a
    /// bridge's `fill_secret`. Never log, serialize, return up the stack, or send
    /// over the control-server stream.
    pub fn expose_secret(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl std::fmt::Display for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(***)")
    }
}

// NOTE: `Secret` deliberately has NO `Serialize`/`Deserialize` impl. Adding one
// would let a secret leak into JSON (an ActionLog, a wire message). Keep it off.

// ───────────────────────── Credential field ─────────────────────────

/// Which field of a saved login eri is filling.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialField {
    Username,
    Password,
    /// Time-based one-time code (P1 — seed stays in the keystore, code generated
    /// there, still never shown to the model). Carried here so the type is total.
    Totp,
}

impl CredentialField {
    /// Human label for the approval prompt + audit line ("password").
    pub fn label(self) -> &'static str {
        match self {
            CredentialField::Username => "username",
            CredentialField::Password => "password",
            CredentialField::Totp => "one-time code",
        }
    }

    /// Stable wire/parse token.
    pub fn as_wire(self) -> &'static str {
        match self {
            CredentialField::Username => "username",
            CredentialField::Password => "password",
            CredentialField::Totp => "totp",
        }
    }

    /// Parse a wire/tool token back to a field.
    pub fn from_wire(token: &str) -> Option<Self> {
        match token.trim().to_lowercase().as_str() {
            "username" | "user" | "email" => Some(CredentialField::Username),
            "password" | "pass" => Some(CredentialField::Password),
            "totp" | "otp" | "2fa" => Some(CredentialField::Totp),
            _ => None,
        }
    }
}

// ───────────────────────────── SecretStore ─────────────────────────────

/// Where secrets actually live — the **repository pattern** so tests use an
/// in-memory fake and prod uses the macOS Keychain. The store only ever returns
/// a [`Secret`]; callers can't get a plain `String` out of it.
pub trait SecretStore: Send + Sync {
    fn get(&self, secret_ref: &str) -> Result<Secret>;
    /// Write a secret (the `eri vault add` path). Never logs the value.
    fn put(&self, secret_ref: &str, secret: Secret) -> Result<()>;
    /// Remove a secret (the `eri vault forget` path).
    fn delete(&self, secret_ref: &str) -> Result<()>;
}

/// In-memory secret store — **tests only** (gated to test builds). Counts reads
/// so a test can assert "no store read happened" (an origin mismatch must never
/// touch the store).
#[cfg(test)]
pub struct InMemoryStore {
    inner: Mutex<HashMap<String, Zeroizing<String>>>,
    reads: AtomicUsize,
}

#[cfg(test)]
impl InMemoryStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            reads: AtomicUsize::new(0),
        }
    }

    /// How many times `get` was called — lets a test prove the store was never
    /// read on the refusal paths.
    pub fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
impl Default for InMemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl SecretStore for InMemoryStore {
    fn get(&self, secret_ref: &str) -> Result<Secret> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let inner = self.inner.lock().expect("InMemoryStore poisoned");
        inner
            .get(secret_ref)
            .map(|z| Secret::new(z.as_str()))
            .with_context(|| format!("no secret stored for {secret_ref}"))
    }

    fn put(&self, secret_ref: &str, secret: Secret) -> Result<()> {
        let mut inner = self.inner.lock().expect("InMemoryStore poisoned");
        inner.insert(
            secret_ref.to_string(),
            Zeroizing::new(secret.expose_secret().to_string()),
        );
        Ok(())
    }

    fn delete(&self, secret_ref: &str) -> Result<()> {
        let mut inner = self.inner.lock().expect("InMemoryStore poisoned");
        inner.remove(secret_ref);
        Ok(())
    }
}

/// The macOS Keychain service all eri vault secrets are filed under. The
/// per-credential `secret_ref` is the Keychain *account*.
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "eri.credential-vault";

/// macOS Keychain secret store (Secure Enclave-backed). **No hand-rolled
/// crypto** — `security-framework` talks to the OS keystore. The secret bytes
/// come back as a [`Secret`] and never as a plain `String` to any caller.
#[cfg(target_os = "macos")]
pub struct KeychainStore {
    service: String,
}

#[cfg(target_os = "macos")]
impl KeychainStore {
    pub fn new() -> Self {
        Self {
            service: KEYCHAIN_SERVICE.to_string(),
        }
    }
}

#[cfg(target_os = "macos")]
impl Default for KeychainStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
impl SecretStore for KeychainStore {
    fn get(&self, secret_ref: &str) -> Result<Secret> {
        let bytes = security_framework::passwords::get_generic_password(&self.service, secret_ref)
            .with_context(|| format!("reading {secret_ref} from the Keychain"))?;
        let value = String::from_utf8(bytes).map_err(|_| {
            anyhow::anyhow!("stored credential for {secret_ref} is not valid UTF-8")
        })?;
        Ok(Secret::new(value))
    }

    fn put(&self, secret_ref: &str, secret: Secret) -> Result<()> {
        security_framework::passwords::set_generic_password(
            &self.service,
            secret_ref,
            secret.expose_secret().as_bytes(),
        )
        .with_context(|| format!("writing {secret_ref} to the Keychain"))
    }

    fn delete(&self, secret_ref: &str) -> Result<()> {
        security_framework::passwords::delete_generic_password(&self.service, secret_ref)
            .with_context(|| format!("deleting {secret_ref} from the Keychain"))
    }
}

// ───────────────────────── Vault metadata ─────────────────────────

/// Vault metadata — **NO secret values**. This is the only thing persisted to
/// disk. The actual secret lives in the [`SecretStore`] under `secret_ref`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialEntry {
    pub id: String,
    /// "github.com" or a native bundle id. Compared via [`normalize_origin`].
    pub origin: String,
    /// Not secret; shown in the approval prompt ("sign you in as you@email").
    pub username: String,
    /// Keychain key for the PASSWORD, e.g. "eri/vault/github.com". Never a value.
    pub secret_ref: String,
    /// Keychain key for the TOTP **seed**, if 2FA is configured for this site.
    /// `None` = no TOTP. `#[serde(default)]` so pre-TOTP metadata still loads.
    /// The seed never leaves the keystore; eri derives the code locally.
    #[serde(default)]
    pub totp_ref: Option<String>,
    pub created: String,
    pub last_used: Option<String>,
}

impl CredentialEntry {
    /// Build a metadata entry (password only). The secret itself is stored
    /// separately via the [`SecretStore`]; nothing here is sensitive. Attach 2FA
    /// later with [`with_totp_ref`](Self::with_totp_ref).
    pub fn new(
        id: impl Into<String>,
        origin: impl Into<String>,
        username: impl Into<String>,
        secret_ref: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            origin: origin.into(),
            username: username.into(),
            secret_ref: secret_ref.into(),
            totp_ref: None,
            created: String::new(),
            last_used: None,
        }
    }
}

/// What a fill produced — the value never travels in any variant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FillOutcome {
    /// The value went Keychain → bridge → OS field; never returned up.
    Filled,
    /// First use on this origin — the user must approve. Carries the prompt.
    NeedsApproval(String),
    /// The frontmost origin ≠ any saved entry's origin → refuse (anti-phishing).
    OriginMismatch,
    /// No saved credential here at all → fall through to the existing hand-back.
    NoMatch,
}

/// The pure, side-effect-free decision of resolving an origin against the vault.
/// The gate reads this to decide auto-fill vs. ask vs. refuse **without filling**
/// (so the unattended-remote channel can bounce a credential fill to confirm).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FillPlan {
    /// A saved login matches this origin. `granted` = the user already said
    /// "always" for it. `origin`/`username` populate the approval prompt.
    Match {
        origin: String,
        username: String,
        granted: bool,
    },
    OriginMismatch,
    NoMatch,
}

/// Internal origin resolution — index into `entries` or a refusal reason.
enum Resolved {
    Match(usize),
    OriginMismatch,
    NoMatch,
}

/// Open the live credential vault for the control loop: metadata loaded from
/// `path`, secrets in the macOS Keychain (Secure Enclave), and fills audited
/// into the shared `audit` log (the same `--history` trail). Returns `None`
/// where there's no OS keystore (non-macOS) — a `FillCredential` then hands back,
/// so nothing regresses. A missing metadata file is an empty vault (every fill →
/// `NoMatch`), which is the common case until credentials are added.
pub fn open_vault(path: &Path, audit: Arc<Mutex<ActionLog>>) -> Option<Arc<CredentialVault>> {
    #[cfg(target_os = "macos")]
    {
        Some(Arc::new(CredentialVault::load(
            path,
            Box::new(KeychainStore::new()),
            audit,
        )))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, audit);
        None
    }
}

/// The approval prompt shown on first sign-in to an origin. Value-free.
pub fn approval_prompt(origin: &str, username: &str, field: CredentialField) -> String {
    format!(
        "Sign you into {origin} as {username} with your saved {}? [y / always for this site / N]",
        field.label()
    )
}

// ───────────────────────────── Vault ─────────────────────────────

/// The credential vault: origin-keyed metadata + a [`SecretStore`] + the shared
/// [`ActionLog`] every access is audited into (origin + field, never the value).
pub struct CredentialVault {
    entries: Vec<CredentialEntry>,
    store: Box<dyn SecretStore>,
    audit: Arc<Mutex<ActionLog>>,
}

impl std::fmt::Debug for CredentialVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print entries' refs/usernames or the store — just the shape.
        f.debug_struct("CredentialVault")
            .field("entries", &self.entries.len())
            .finish()
    }
}

impl CredentialVault {
    // ── construction + management (write side) ──
    // Exercised by tests + the P2 `eri vault` (add/list) surface. The P0 binary
    // builds the vault via [`load`](Self::load) and only reads (fills), so these
    // have no live caller yet — kept for interface completeness.

    /// Build a vault over a secret store and the shared audit log. Start empty;
    /// add entries with [`add_entry`](Self::add_entry) or [`load`](Self::load).
    #[allow(dead_code)]
    pub fn new(store: Box<dyn SecretStore>, audit: Arc<Mutex<ActionLog>>) -> Self {
        Self {
            entries: Vec::new(),
            store,
            audit,
        }
    }

    /// Add a metadata entry (the secret is stored separately via the store).
    #[allow(dead_code)]
    pub fn add_entry(&mut self, entry: CredentialEntry) {
        self.entries.push(entry);
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The saved entries — metadata only (origins + usernames, never secrets).
    /// What `eri vault list` prints.
    pub fn entries(&self) -> &[CredentialEntry] {
        &self.entries
    }

    /// Save a login: write the secret to the keystore, then record (or update)
    /// the metadata entry for its origin. The [`Secret`] is consumed; nothing
    /// here prints or returns it. Re-saving an existing origin updates it in
    /// place rather than duplicating (one login per origin for P0).
    pub fn add(&mut self, entry: CredentialEntry, secret: Secret) -> Result<()> {
        self.store
            .put(&entry.secret_ref, secret)
            .with_context(|| format!("storing the credential for {}", entry.origin))?;
        let norm = normalize_origin(&entry.origin);
        match self
            .entries
            .iter_mut()
            .find(|e| normalize_origin(&e.origin) == norm)
        {
            Some(existing) => *existing = entry,
            None => self.entries.push(entry),
        }
        Ok(())
    }

    /// Forget a saved login by origin: delete the keystore secret and drop the
    /// metadata entry. Returns true if something was removed. Deleting an absent
    /// keystore item is not surfaced as an error (the user's intent is met).
    pub fn forget(&mut self, origin: &str) -> Result<bool> {
        let norm = normalize_origin(origin);
        let Some(idx) = self
            .entries
            .iter()
            .position(|e| normalize_origin(&e.origin) == norm)
        else {
            return Ok(false);
        };
        let entry = self.entries.remove(idx);
        let _ = self.store.delete(&entry.secret_ref);
        if let Some(totp_ref) = &entry.totp_ref {
            let _ = self.store.delete(totp_ref);
        }
        Ok(true)
    }

    /// Attach (or replace) the TOTP 2FA seed for an already-saved origin. The
    /// seed is written to the keystore and the entry's `totp_ref` is set. Returns
    /// false if there's no saved login for the origin yet (add one first).
    pub fn set_totp(&mut self, origin: &str, seed: Secret) -> Result<bool> {
        let norm = normalize_origin(origin);
        if !self
            .entries
            .iter()
            .any(|e| normalize_origin(&e.origin) == norm)
        {
            return Ok(false);
        }
        let totp_ref = format!("eri/vault/{norm}/totp");
        self.store
            .put(&totp_ref, seed)
            .with_context(|| format!("storing the TOTP seed for {norm}"))?;
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| normalize_origin(&e.origin) == norm)
        {
            entry.totp_ref = Some(totp_ref);
        }
        Ok(true)
    }

    /// Load metadata (a JSON array of [`CredentialEntry`]) from disk. A missing
    /// file is an empty vault, not an error — so nothing breaks on a fresh
    /// machine and a no-entry vault simply yields [`FillOutcome::NoMatch`].
    pub fn load(path: &Path, store: Box<dyn SecretStore>, audit: Arc<Mutex<ActionLog>>) -> Self {
        let entries = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<CredentialEntry>>(&s).ok())
            .unwrap_or_default();
        Self {
            entries,
            store,
            audit,
        }
    }

    /// Persist the metadata (NO secrets) to `path`, creating parent dirs.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&self.entries)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
    }

    /// Resolve a live origin against saved entries. Pure, no store read.
    ///
    /// - exact normalized match → [`Resolved::Match`].
    /// - no match but the vault HAS saved logins → [`Resolved::OriginMismatch`]
    ///   (anti-phishing: creds exist, but not for *this* site — refuse, don't
    ///   silently use another site's login on a look-alike page).
    /// - no match and the vault is empty → [`Resolved::NoMatch`] (fall through to
    ///   the existing hand-back).
    fn resolve(&self, origin: &str) -> Resolved {
        let norm = normalize_origin(origin);
        if norm.is_empty() {
            return if self.entries.is_empty() {
                Resolved::NoMatch
            } else {
                Resolved::OriginMismatch
            };
        }
        match self
            .entries
            .iter()
            .position(|e| normalize_origin(&e.origin) == norm)
        {
            Some(idx) => Resolved::Match(idx),
            None if self.entries.is_empty() => Resolved::NoMatch,
            None => Resolved::OriginMismatch,
        }
    }

    /// The pure decision for an origin (auto-fill / ask / refuse) **without
    /// filling**. The gate uses this for the unattended-remote channel, where a
    /// credential fill must always bounce to confirm even on an "always" origin.
    pub fn plan(&self, origin: &str, permissions: &PermissionStore) -> FillPlan {
        match self.resolve(origin) {
            Resolved::Match(idx) => {
                let e = &self.entries[idx];
                FillPlan::Match {
                    origin: e.origin.clone(),
                    username: e.username.clone(),
                    granted: permissions.is_credential_origin_allowed(&e.origin),
                }
            }
            Resolved::OriginMismatch => FillPlan::OriginMismatch,
            Resolved::NoMatch => FillPlan::NoMatch,
        }
    }

    /// The attended local path: fill if the origin is approved, else ask. Refuses
    /// a look-alike origin (anti-phishing) and falls through ([`NoMatch`]) when
    /// nothing is saved here.
    pub async fn fill(
        &self,
        origin: &str,
        field: CredentialField,
        permissions: &PermissionStore,
        bridge: &dyn ControlBridge,
    ) -> Result<FillOutcome> {
        match self.resolve(origin) {
            Resolved::Match(idx) => {
                if permissions.is_credential_origin_allowed(&self.entries[idx].origin) {
                    self.fill_ready(idx, field, bridge).await
                } else {
                    let e = &self.entries[idx];
                    Ok(FillOutcome::NeedsApproval(approval_prompt(
                        &e.origin,
                        &e.username,
                        field,
                    )))
                }
            }
            Resolved::OriginMismatch => Ok(FillOutcome::OriginMismatch),
            Resolved::NoMatch => Ok(FillOutcome::NoMatch),
        }
    }

    /// Fill after the user explicitly approved this prompt — skips the persisted
    /// per-origin grant check, but STILL enforces the origin match (approval
    /// never defeats the anti-phishing guard).
    pub async fn fill_approved(
        &self,
        origin: &str,
        field: CredentialField,
        bridge: &dyn ControlBridge,
    ) -> Result<FillOutcome> {
        match self.resolve(origin) {
            Resolved::Match(idx) => self.fill_ready(idx, field, bridge).await,
            Resolved::OriginMismatch => Ok(FillOutcome::OriginMismatch),
            Resolved::NoMatch => Ok(FillOutcome::NoMatch),
        }
    }

    /// Resolve the value for `field` and hand it to the bridge — the ONLY place a
    /// value moves. Field-aware:
    /// - **Username** → the (non-secret) saved username.
    /// - **Password** → the keystore secret at `secret_ref`.
    /// - **Totp** → the current code, derived LOCALLY from the keystore seed at
    ///   `totp_ref` (the seed never leaves; the model sees neither seed nor code).
    ///   No TOTP configured for this site → [`NoMatch`] (hand back).
    ///
    /// The [`Secret`] is consumed inside `fill_secret` and dropped (zeroized); it
    /// is never returned, logged, or stringified. The access is audited by origin
    /// + field, never the value.
    async fn fill_ready(
        &self,
        idx: usize,
        field: CredentialField,
        bridge: &dyn ControlBridge,
    ) -> Result<FillOutcome> {
        let (origin, value) = {
            let e = &self.entries[idx];
            let value = match field {
                CredentialField::Username => Secret::new(e.username.clone()),
                CredentialField::Password => self
                    .store
                    .get(&e.secret_ref)
                    .with_context(|| format!("reading the saved password for {}", e.origin))?,
                CredentialField::Totp => {
                    let Some(totp_ref) = e.totp_ref.as_deref() else {
                        // No 2FA saved here → fall through to the hand-back.
                        return Ok(FillOutcome::NoMatch);
                    };
                    let seed = self
                        .store
                        .get(totp_ref)
                        .with_context(|| format!("reading the TOTP seed for {}", e.origin))?;
                    let code = crate::totp::totp_now(seed.expose_secret()).with_context(|| {
                        format!("generating the one-time code for {}", e.origin)
                    })?;
                    Secret::new(code) // the seed Secret drops (zeroized) here
                }
            };
            (e.origin.clone(), value)
        };
        // Keychain → bridge → OS field. `value` is moved in and never comes back.
        bridge
            .fill_secret(field, value)
            .await
            .with_context(|| format!("filling the saved {} for {origin}", field.label()))?;
        if let Ok(mut log) = self.audit.lock() {
            log.record_credential_fill(&origin, field);
        }
        Ok(FillOutcome::Filled)
    }
}

// ───────────────────────────── `eri vault` CLI ─────────────────────────────
// Save / list / forget the logins eri can fill hands-free. Values are NEVER
// printed: `add` reads the password without echo straight into the Keychain,
// `list` shows only origins + usernames, `forget` deletes the secret + grant.

/// Default on-disk path for the vault metadata (NO secrets):
/// `~/.config/eri/credential-vault.json`, beside the permission file. The single
/// source of truth for both the CLI and the live control loop.
pub fn default_metadata_path() -> Option<std::path::PathBuf> {
    PermissionStore::default_path().map(|p| p.with_file_name("credential-vault.json"))
}

/// Open the on-disk vault for a CLI mutation (metadata + Keychain). No fills
/// happen here, so a throwaway audit log is fine.
#[cfg(target_os = "macos")]
fn cli_vault() -> Result<(std::path::PathBuf, CredentialVault)> {
    let path = default_metadata_path()
        .ok_or_else(|| anyhow::anyhow!("can't resolve the vault path (no HOME?)"))?;
    let audit = Arc::new(Mutex::new(ActionLog::default()));
    let vault = CredentialVault::load(&path, Box::new(KeychainStore::new()), audit);
    Ok((path, vault))
}

/// `eri vault list` — print saved origins + usernames. Never the secret.
pub fn cli_list() -> Result<()> {
    #[cfg(not(target_os = "macos"))]
    {
        anyhow::bail!("the credential vault needs the macOS Keychain");
    }
    #[cfg(target_os = "macos")]
    {
        let (_, vault) = cli_vault()?;
        if vault.is_empty() {
            println!("No saved logins yet. Add one with `eri vault add <site> --username <you>`.");
            return Ok(());
        }
        println!("Saved logins (eri fills these without ever showing the secret):");
        for e in vault.entries() {
            println!("  {}  —  {}", e.origin, e.username);
        }
        Ok(())
    }
}

/// `eri vault add <origin> --username <u>` — save a login. The password is read
/// WITHOUT echo and goes straight to the Keychain; it is never printed or logged.
pub fn cli_add(origin: &str, username: &str) -> Result<()> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (origin, username);
        anyhow::bail!("the credential vault needs the macOS Keychain");
    }
    #[cfg(target_os = "macos")]
    {
        let origin_norm = normalize_origin(origin);
        if origin_norm.is_empty() {
            anyhow::bail!(
                "a site origin is required, e.g. `eri vault add github.com --username you@email.com`"
            );
        }
        let secret = read_secret_no_echo(&format!("Password for {username} on {origin_norm}: "))?;
        if secret.expose_secret().is_empty() {
            anyhow::bail!("no password entered — nothing saved");
        }
        let (path, mut vault) = cli_vault()?;
        let secret_ref = format!("eri/vault/{origin_norm}");
        let entry = CredentialEntry::new(&origin_norm, &origin_norm, username, &secret_ref);
        vault.add(entry, secret)?;
        vault.save(&path)?;
        println!(
            "Saved. eri can now sign you into {origin_norm} as {username} — it'll ask the first time."
        );
        Ok(())
    }
}

/// `eri vault forget <origin>` — remove a saved login, its Keychain secret, and
/// any "always sign in here" grant.
pub fn cli_forget(origin: &str) -> Result<()> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = origin;
        anyhow::bail!("the credential vault needs the macOS Keychain");
    }
    #[cfg(target_os = "macos")]
    {
        let (path, mut vault) = cli_vault()?;
        let removed = vault.forget(origin)?;
        if removed {
            vault.save(&path)?;
        }
        // Drop any per-origin "always" grant too, so a re-add asks again.
        if let Some(pp) = PermissionStore::default_path() {
            let mut perms = PermissionStore::load(&pp);
            if perms.forget_credential_origin(origin) {
                let _ = perms.save(&pp);
            }
        }
        let origin_norm = normalize_origin(origin);
        if removed {
            println!("Forgot the saved login for {origin_norm}.");
        } else {
            println!("No saved login for {origin_norm}.");
        }
        Ok(())
    }
}

/// `eri vault totp <origin>` — attach a 2FA seed to a saved login. The base32
/// seed is read WITHOUT echo, validated, and stored in the Keychain; eri then
/// generates the current code locally at sign-in. The seed is never printed.
pub fn cli_set_totp(origin: &str) -> Result<()> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = origin;
        anyhow::bail!("the credential vault needs the macOS Keychain");
    }
    #[cfg(target_os = "macos")]
    {
        let origin_norm = normalize_origin(origin);
        let seed = read_secret_no_echo(&format!("2FA seed (base32) for {origin_norm}: "))?;
        if seed.expose_secret().is_empty() {
            anyhow::bail!("no seed entered — nothing saved");
        }
        // Validate before storing so a typo'd seed is caught now, not at sign-in.
        crate::totp::totp_now(seed.expose_secret())
            .context("that doesn't look like a valid base32 TOTP seed")?;
        let (path, mut vault) = cli_vault()?;
        if !vault.set_totp(origin, seed)? {
            anyhow::bail!(
                "no saved login for {origin_norm} yet — add it first with `eri vault add {origin_norm} --username <you>`"
            );
        }
        vault.save(&path)?;
        println!("Saved 2FA for {origin_norm}. eri will fill the current code when you sign in.");
        Ok(())
    }
}

/// Read a secret from the terminal WITHOUT echo (or, when input is piped, one
/// line of stdin). The value goes straight into a [`Secret`] — it never touches
/// the screen or a log. The keystroke buffer is itself zeroized on drop.
#[cfg(target_os = "macos")]
fn read_secret_no_echo(prompt: &str) -> Result<Secret> {
    use std::io::{IsTerminal, Write};
    if !std::io::stdin().is_terminal() {
        // Piped: `printf '%s' "$pw" | eri vault add …`. Read a single line.
        let mut line = Zeroizing::new(String::new());
        std::io::stdin().read_line(&mut line)?;
        let trimmed = line.trim_end_matches(['\n', '\r']);
        return Ok(Secret::new(trimmed));
    }
    print!("{prompt}");
    std::io::stdout().flush().ok();
    crossterm::terminal::enable_raw_mode()?;
    let mut buf = Zeroizing::new(String::new());
    let outcome = (|| -> Result<()> {
        use crossterm::event::{self, Event, KeyCode, KeyModifiers};
        loop {
            if let Event::Key(k) = event::read()? {
                match k.code {
                    KeyCode::Enter => break,
                    KeyCode::Esc => anyhow::bail!("cancelled"),
                    // Raw mode disables SIGINT, so Ctrl-C arrives as a keypress.
                    KeyCode::Char('c') if k.modifiers.contains(KeyModifiers::CONTROL) => {
                        anyhow::bail!("cancelled");
                    }
                    KeyCode::Char(c) => buf.push(c),
                    KeyCode::Backspace => {
                        buf.pop();
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    })();
    let _ = crossterm::terminal::disable_raw_mode();
    println!();
    outcome?;
    Ok(Secret::new(buf.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_agent::{ClickTarget, ControlBridge, ScreenGraph};
    use async_trait::async_trait;

    /// A test bridge that captures what `fill_secret` received (to prove the
    /// fill happened and with the right value) and reports a configurable origin.
    /// All other [`ControlBridge`] methods are unreachable in these tests.
    struct FakeBridge {
        origin: Option<String>,
        filled: Mutex<Option<(CredentialField, String)>>,
    }

    impl FakeBridge {
        fn at(origin: &str) -> Self {
            Self {
                origin: Some(origin.to_string()),
                filled: Mutex::new(None),
            }
        }
        fn filled_value(&self) -> Option<String> {
            self.filled.lock().unwrap().clone().map(|(_, v)| v)
        }
    }

    #[async_trait]
    impl ControlBridge for FakeBridge {
        async fn snapshot(&self) -> Result<ScreenGraph> {
            unimplemented!("snapshot not used in vault tests")
        }
        async fn capture(&self) -> Result<String> {
            unimplemented!("capture not used in vault tests")
        }
        async fn click(&self, _t: &ClickTarget) -> Result<String> {
            unimplemented!("click not used in vault tests")
        }
        async fn type_text(&self, _text: &str) -> Result<String> {
            unimplemented!("type_text not used in vault tests")
        }
        async fn key(&self, _combo: &str) -> Result<String> {
            unimplemented!("key not used in vault tests")
        }
        async fn open_app(&self, _name: &str) -> Result<String> {
            unimplemented!("open_app not used in vault tests")
        }
        async fn quit_app(&self, _name: &str) -> Result<String> {
            unimplemented!("quit_app not used in vault tests")
        }
        async fn current_origin(&self) -> Option<String> {
            self.origin.clone()
        }
        async fn fill_secret(&self, field: CredentialField, secret: Secret) -> Result<String> {
            // The bridge is the OS-field actuator; reading the value here is the
            // one legitimate `expose_secret`. We stash it to assert the right
            // value arrived — the audit assertions prove it never escapes.
            *self.filled.lock().unwrap() = Some((field, secret.expose_secret().to_string()));
            Ok("filled".into())
        }
    }

    fn vault_with_github() -> (CredentialVault, Arc<Mutex<ActionLog>>) {
        let store = InMemoryStore::new();
        store
            .put("eri/vault/github.com", Secret::new("hunter2"))
            .unwrap();
        let audit = Arc::new(Mutex::new(ActionLog::default()));
        let mut vault = CredentialVault::new(Box::new(store), audit.clone());
        vault.add_entry(CredentialEntry::new(
            "gh",
            "github.com",
            "you@email.com",
            "eri/vault/github.com",
        ));
        (vault, audit)
    }

    #[test]
    fn secret_never_prints_or_serializes() {
        let s = Secret::new("hunter2");
        // Debug + Display both redact; the value never appears in a format string.
        assert_eq!(format!("{s:?}"), "Secret(***)");
        assert_eq!(format!("{s}"), "Secret(***)");
        assert!(!format!("{s:?}").contains("hunter2"));
        // The value is only reachable through the deliberately-named accessor.
        assert_eq!(s.expose_secret(), "hunter2");
        // NOTE: `Secret` has no `Serialize` impl (by omission) — there is no way
        // to serde it into a log/wire payload. (Enforced by the type, not a test.)
    }

    #[tokio::test]
    async fn fill_requires_origin_match() {
        let store = InMemoryStore::new();
        store
            .put("eri/vault/github.com", Secret::new("hunter2"))
            .unwrap();
        // Keep a handle to assert the store is never read on a mismatch.
        let store_reads = {
            let audit = Arc::new(Mutex::new(ActionLog::default()));
            let mut vault = CredentialVault::new(Box::new(store), audit);
            vault.add_entry(CredentialEntry::new(
                "gh",
                "github.com",
                "you@email.com",
                "eri/vault/github.com",
            ));
            // A look-alike page asks to fill the github login → refuse.
            let bridge = FakeBridge::at("evil.com");
            let perms = {
                let mut p = PermissionStore::default();
                p.allow_credential_origin("github.com"); // even granted, origin guards
                p
            };
            let outcome = vault
                .fill("evil.com", CredentialField::Password, &perms, &bridge)
                .await
                .unwrap();
            assert_eq!(outcome, FillOutcome::OriginMismatch);
            assert!(bridge.filled_value().is_none(), "nothing was filled");
            vault
        };
        // (The store handle is owned by the vault; re-deriving its read count
        // requires the InMemoryStore directly — covered by the dedicated test.)
        let _ = store_reads;
    }

    #[tokio::test]
    async fn origin_mismatch_does_not_read_the_store() {
        let store = InMemoryStore::new();
        store
            .put("eri/vault/github.com", Secret::new("hunter2"))
            .unwrap();
        let reads_store = Arc::new(store);
        // Build a vault that shares the same counting store via a thin adapter.
        let audit = Arc::new(Mutex::new(ActionLog::default()));
        let mut vault = CredentialVault::new(Box::new(SharedStore(reads_store.clone())), audit);
        vault.add_entry(CredentialEntry::new(
            "gh",
            "github.com",
            "you@email.com",
            "eri/vault/github.com",
        ));
        let bridge = FakeBridge::at("evil.com");
        let perms = PermissionStore::default();
        let outcome = vault
            .fill("evil.com", CredentialField::Password, &perms, &bridge)
            .await
            .unwrap();
        assert_eq!(outcome, FillOutcome::OriginMismatch);
        assert_eq!(
            reads_store.reads(),
            0,
            "the store must not be read on mismatch"
        );
    }

    /// An `Arc<InMemoryStore>` as a `SecretStore`, so a test can keep the store
    /// to inspect its read counter after handing a box to the vault.
    struct SharedStore(Arc<InMemoryStore>);
    impl SecretStore for SharedStore {
        fn get(&self, secret_ref: &str) -> Result<Secret> {
            self.0.get(secret_ref)
        }
        fn put(&self, secret_ref: &str, secret: Secret) -> Result<()> {
            self.0.put(secret_ref, secret)
        }
        fn delete(&self, secret_ref: &str) -> Result<()> {
            self.0.delete(secret_ref)
        }
    }

    #[tokio::test]
    async fn first_use_needs_approval_then_persists() {
        let (vault, _audit) = vault_with_github();
        let bridge = FakeBridge::at("github.com");

        // First use on this origin: not yet approved → NeedsApproval, no fill.
        let mut perms = PermissionStore::default();
        let outcome = vault
            .fill("github.com", CredentialField::Password, &perms, &bridge)
            .await
            .unwrap();
        match &outcome {
            FillOutcome::NeedsApproval(prompt) => {
                assert!(prompt.contains("github.com"));
                assert!(prompt.contains("you@email.com"));
                assert!(prompt.contains("password"));
            }
            other => panic!("expected NeedsApproval, got {other:?}"),
        }
        assert!(
            bridge.filled_value().is_none(),
            "nothing filled before approval"
        );

        // The user picks "always": persist the per-origin grant, round-trip disk.
        perms.allow_credential_origin("github.com");
        let dir = std::env::temp_dir().join(format!("eri_vault_grant_{}", std::process::id()));
        let path = dir.join("perms.json");
        let _ = std::fs::remove_dir_all(&dir);
        perms.save(&path).unwrap();
        let loaded = PermissionStore::load(&path);
        assert!(loaded.is_credential_origin_allowed("github.com"));

        // Now the same fill proceeds — the secret went to the bridge.
        let outcome = vault
            .fill("github.com", CredentialField::Password, &loaded, &bridge)
            .await
            .unwrap();
        assert_eq!(outcome, FillOutcome::Filled);
        assert_eq!(bridge.filled_value().as_deref(), Some("hunter2"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn audit_records_fill_without_value() {
        let (vault, audit) = vault_with_github();
        let bridge = FakeBridge::at("github.com");
        let mut perms = PermissionStore::default();
        perms.allow_credential_origin("github.com");

        let outcome = vault
            .fill("github.com", CredentialField::Password, &perms, &bridge)
            .await
            .unwrap();
        assert_eq!(outcome, FillOutcome::Filled);

        let log = audit.lock().unwrap();
        let trail = log.trail().join("\n");
        // The audit names the origin + field…
        assert!(
            trail.contains("github.com"),
            "trail names the origin: {trail}"
        );
        assert!(trail.contains("password"), "trail names the field: {trail}");
        // …but NEVER the secret value.
        assert!(
            !trail.contains("hunter2"),
            "the secret must not appear: {trail}"
        );
    }

    #[tokio::test]
    async fn fill_outcome_nomatch_falls_through_to_handback() {
        // Empty vault → no saved credential here → NoMatch (caller hands back).
        let audit = Arc::new(Mutex::new(ActionLog::default()));
        let vault = CredentialVault::new(Box::new(InMemoryStore::new()), audit);
        let bridge = FakeBridge::at("github.com");
        let perms = PermissionStore::default();
        let outcome = vault
            .fill("github.com", CredentialField::Password, &perms, &bridge)
            .await
            .unwrap();
        assert_eq!(outcome, FillOutcome::NoMatch);
    }

    #[tokio::test]
    async fn origin_match_is_normalized() {
        // A live origin in a different surface form still matches the saved entry.
        let (vault, _audit) = vault_with_github();
        let bridge = FakeBridge::at("https://www.github.com/login");
        let mut perms = PermissionStore::default();
        perms.allow_credential_origin("github.com");
        let outcome = vault
            .fill(
                "https://www.github.com/login",
                CredentialField::Password,
                &perms,
                &bridge,
            )
            .await
            .unwrap();
        assert_eq!(outcome, FillOutcome::Filled);
    }

    #[test]
    fn add_list_forget_roundtrips_without_exposing_values() {
        // The `eri vault` CLI surface, exercised through the core methods.
        let store = Arc::new(InMemoryStore::new());
        let audit = Arc::new(Mutex::new(ActionLog::default()));
        let mut vault = CredentialVault::new(Box::new(SharedStore(store.clone())), audit);

        // Save a login → metadata records origin + username, secret goes to store.
        vault
            .add(
                CredentialEntry::new("gh", "github.com", "you@email.com", "eri/vault/github.com"),
                Secret::new("hunter2"),
            )
            .unwrap();
        assert_eq!(vault.entries().len(), 1);
        assert_eq!(vault.entries()[0].origin, "github.com");
        assert_eq!(vault.entries()[0].username, "you@email.com");
        assert_eq!(
            store.get("eri/vault/github.com").unwrap().expose_secret(),
            "hunter2"
        );

        // Re-saving the same origin updates in place (no duplicate).
        vault
            .add(
                CredentialEntry::new("gh", "github.com", "new@email.com", "eri/vault/github.com"),
                Secret::new("newpass"),
            )
            .unwrap();
        assert_eq!(
            vault.entries().len(),
            1,
            "same origin updates, not duplicates"
        );
        assert_eq!(vault.entries()[0].username, "new@email.com");
        assert_eq!(
            store.get("eri/vault/github.com").unwrap().expose_secret(),
            "newpass"
        );

        // forget removes the entry AND deletes the keystore secret.
        assert!(vault.forget("https://github.com/login").unwrap()); // normalized match
        assert!(vault.is_empty());
        assert!(
            store.get("eri/vault/github.com").is_err(),
            "secret must be deleted from the store on forget"
        );
        assert!(!vault.forget("github.com").unwrap(), "already gone → false");
    }

    #[tokio::test]
    async fn fill_username_fills_the_username_not_the_password() {
        // Field-aware fill: `username` types the saved username, NOT the password.
        let store = InMemoryStore::new();
        store
            .put("eri/vault/example.com", Secret::new("hunter2"))
            .unwrap();
        let audit = Arc::new(Mutex::new(ActionLog::default()));
        let mut vault = CredentialVault::new(Box::new(store), audit);
        vault.add_entry(CredentialEntry::new(
            "ex",
            "example.com",
            "you@email.com",
            "eri/vault/example.com",
        ));
        let bridge = FakeBridge::at("example.com");
        let mut perms = PermissionStore::default();
        perms.allow_credential_origin("example.com");

        let outcome = vault
            .fill("example.com", CredentialField::Username, &perms, &bridge)
            .await
            .unwrap();
        assert_eq!(outcome, FillOutcome::Filled);
        assert_eq!(bridge.filled_value().as_deref(), Some("you@email.com"));
        assert_ne!(
            bridge.filled_value().as_deref(),
            Some("hunter2"),
            "the password must never be filled into the username field"
        );
    }

    #[tokio::test]
    async fn fill_totp_generates_a_code_not_the_seed() {
        let seed = data_encoding::BASE32_NOPAD.encode(b"12345678901234567890");
        let audit = Arc::new(Mutex::new(ActionLog::default()));
        let mut vault = CredentialVault::new(Box::new(InMemoryStore::new()), audit.clone());
        vault.add_entry(CredentialEntry::new(
            "ex",
            "example.com",
            "you@email.com",
            "eri/vault/example.com",
        ));
        // Attach 2FA via the same path the `eri vault totp` CLI uses.
        assert!(
            vault
                .set_totp("example.com", Secret::new(seed.clone()))
                .unwrap()
        );
        // set_totp on a site with no saved login returns false.
        assert!(
            !vault
                .set_totp("unknown.com", Secret::new(seed.clone()))
                .unwrap()
        );
        let bridge = FakeBridge::at("example.com");
        let mut perms = PermissionStore::default();
        perms.allow_credential_origin("example.com");

        let outcome = vault
            .fill("example.com", CredentialField::Totp, &perms, &bridge)
            .await
            .unwrap();
        assert_eq!(outcome, FillOutcome::Filled);
        let code = bridge.filled_value().unwrap();
        assert_eq!(code.len(), 6, "a 6-digit code");
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        assert_ne!(code, seed, "the seed must never be filled");
        // Audited as a one-time code, never the seed.
        let trail = audit.lock().unwrap().trail().join("\n");
        assert!(trail.contains("one-time code"));
        assert!(
            !trail.contains(&seed),
            "the seed leaked into the trail: {trail}"
        );
    }

    #[tokio::test]
    async fn fill_totp_without_a_seed_falls_through() {
        // A site with a password but no 2FA configured → hand back, don't fill.
        let (vault, _audit) = vault_with_github();
        let bridge = FakeBridge::at("github.com");
        let mut perms = PermissionStore::default();
        perms.allow_credential_origin("github.com");

        let outcome = vault
            .fill("github.com", CredentialField::Totp, &perms, &bridge)
            .await
            .unwrap();
        assert_eq!(
            outcome,
            FillOutcome::NoMatch,
            "no 2FA configured → hand back"
        );
        assert!(bridge.filled_value().is_none());
    }
}
