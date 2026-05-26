//! Credentials + base-URL handling for the `eri` CLI.
//!
//! Bearer tokens are stored at `~/.config/eri/credentials.json` with
//! 0600 permissions on Unix. The shape mirrors the IDE's
//! `SessionStore` so a future "share session with desktop" mode can
//! plug both readers into the same file:
//!
//! ```json
//! {
//!   "bearer": "eri_sk_...",
//!   "userId": "u_...",
//!   "email": "khai@example.com",
//!   "tier": "pro",
//!   "baseUrl": "https://tryeri.ca"
//! }
//! ```

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const DEFAULT_BASE_URL: &str = "https://tryeri.ca";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub bearer: Option<String>,
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub tier: Option<String>,
    pub base_url: Option<String>,
}

impl Credentials {
    /// Resolve the active base URL. Order: env override → file →
    /// `https://tryeri.ca`.
    pub fn base_url(&self) -> String {
        if let Ok(env) = std::env::var("ERI_BASE_URL") {
            if !env.trim().is_empty() {
                return env;
            }
        }
        self.base_url
            .clone()
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
    }

    /// Resolve the active bearer. Order: env override → file. Returns
    /// `None` when the user is signed out.
    pub fn bearer(&self) -> Option<String> {
        if let Ok(env) = std::env::var("ERI_API_KEY") {
            if !env.trim().is_empty() {
                return Some(env);
            }
        }
        self.bearer.clone()
    }

    pub fn is_signed_in(&self) -> bool {
        self.bearer().is_some()
    }
}

pub fn credentials_path() -> Result<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        return Ok(PathBuf::from(home)
            .join(".config")
            .join("eri")
            .join("credentials.json"));
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        return Ok(PathBuf::from(home)
            .join(".config")
            .join("eri")
            .join("credentials.json"));
    }
    anyhow::bail!("no HOME / USERPROFILE — cannot resolve credentials path")
}

pub fn load() -> Result<Credentials> {
    let path = credentials_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Credentials>(&raw)
            .with_context(|| format!("parse {}", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Credentials::default()),
        Err(err) => Err(err).with_context(|| format!("read {}", path.display())),
    }
}

pub fn save(creds: &Credentials) -> Result<()> {
    let path = credentials_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create {}", parent.display()))?;
    }
    let serialized = serde_json::to_string_pretty(creds)?;
    fs::write(&path, format!("{serialized}\n"))
        .with_context(|| format!("write {}", path.display()))?;
    set_owner_only(&path)?;
    Ok(())
}

pub fn clear() -> Result<()> {
    let path = credentials_path()?;
    if path.exists() {
        fs::remove_file(&path)
            .with_context(|| format!("remove {}", path.display()))?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_owner_only(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let perms = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, perms)
        .with_context(|| format!("chmod 0600 {}", path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_owner_only(_path: &std::path::Path) -> Result<()> {
    // Windows ACLs are out of scope; OS-level ACL hardening lives with
    // the desktop installer.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_temp_home<F: FnOnce()>(f: F) {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }
        f();
        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    #[test]
    fn save_then_load_roundtrips() {
        with_temp_home(|| {
            let creds = Credentials {
                bearer: Some("eri_sk_test123".into()),
                user_id: Some("u_abc".into()),
                email: Some("khai@example.com".into()),
                tier: Some("pro".into()),
                base_url: Some("https://staging.tryeri.ca".into()),
            };
            save(&creds).unwrap();
            let loaded = load().unwrap();
            assert_eq!(loaded.bearer.as_deref(), Some("eri_sk_test123"));
            assert_eq!(loaded.tier.as_deref(), Some("pro"));
        });
    }

    #[test]
    fn missing_file_returns_default() {
        with_temp_home(|| {
            let loaded = load().unwrap();
            assert!(loaded.bearer.is_none());
            assert!(!loaded.is_signed_in());
        });
    }

    #[test]
    fn env_override_wins_for_bearer() {
        with_temp_home(|| {
            let creds = Credentials {
                bearer: Some("file_bearer".into()),
                ..Default::default()
            };
            save(&creds).unwrap();
            unsafe {
                std::env::set_var("ERI_API_KEY", "env_bearer");
            }
            let loaded = load().unwrap();
            assert_eq!(loaded.bearer().as_deref(), Some("env_bearer"));
            unsafe {
                std::env::remove_var("ERI_API_KEY");
            }
        });
    }

    #[test]
    fn clear_removes_file_idempotently() {
        with_temp_home(|| {
            // Clearing when nothing exists is a no-op.
            clear().unwrap();
            // After save, clear removes the file.
            save(&Credentials {
                bearer: Some("x".into()),
                ..Default::default()
            })
            .unwrap();
            clear().unwrap();
            assert!(!credentials_path().unwrap().exists());
        });
    }
}
