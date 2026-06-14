//! `K_user` key material — the secret that derives the Tier-B memory key
//! (security: C-1).
//!
//! The review's crux: `MemoryKey::derive` is correct, but if the input keying
//! material is sourced carelessly under deadline pressure (the bearer, the
//! email, a constant) the whole E2E guarantee collapses. This module is the
//! blessed source: a **generated 32-byte secret + a separate salt**, created
//! once and persisted in the OS keychain, retrieved thereafter. The IKM is
//! never the rotating bearer, so `K_user` is stable across token rotation and
//! every existing blob stays readable (ADR-0001).
//!
//! The keychain access sits behind a [`KeyMaterialStore`] seam so the
//! load-or-create logic is unit-tested with an in-memory store and never touches
//! the real keychain in CI.

use base64::Engine as _;

use super::sync::{MemoryKey, SyncError};

/// IKM is a full 256-bit secret; the salt is 128 bits — both generated once.
const IKM_LEN: usize = 32;
const SALT_LEN: usize = 16;

/// Keychain service name (matches `eri_auth`'s `eri` slot family).
const KEYCHAIN_SERVICE: &str = "eri";

/// Persisted secret store for `K_user` material. The production impl is the OS
/// keychain ([`KeychainStore`]); tests substitute an in-memory map.
pub trait KeyMaterialStore {
    /// Load the raw bytes stored under `name`, or `None` if absent.
    fn load(&self, name: &str) -> Result<Option<Vec<u8>>, SyncError>;
    /// Persist `value` under `name`, overwriting any prior value.
    fn store(&self, name: &str, value: &[u8]) -> Result<(), SyncError>;
}

/// Derive `K_user` for `user_id`, generating + persisting the IKM and salt on
/// first use. Stable across runs and bearer rotation: once stored, the same
/// material (hence the same key) is returned forever, so blobs stay readable.
/// Per-user names keep two accounts on one machine cryptographically distinct.
pub fn k_user(store: &dyn KeyMaterialStore, user_id: &str) -> Result<MemoryKey, SyncError> {
    let ikm = load_or_create(store, &format!("k_user_ikm:{user_id}"), IKM_LEN)?;
    let salt = load_or_create(store, &format!("k_user_salt:{user_id}"), SALT_LEN)?;
    Ok(MemoryKey::derive(&ikm, &salt))
}

/// Return the stored bytes for `name`, or generate `len` fresh random bytes,
/// persist them, and return those. Once created the value is never regenerated
/// (regenerating would silently re-key and orphan the cloud blob).
fn load_or_create(
    store: &dyn KeyMaterialStore,
    name: &str,
    len: usize,
) -> Result<Vec<u8>, SyncError> {
    if let Some(existing) = store.load(name)? {
        return Ok(existing);
    }
    let mut buf = vec![0u8; len];
    // A CSPRNG failure is fatal, not retriable — and we never echo the OS error.
    getrandom::getrandom(&mut buf).map_err(|_| SyncError::Crypto)?;
    store.store(name, &buf)?;
    Ok(buf)
}

/// OS-keychain-backed [`KeyMaterialStore`]. Bytes are base64-encoded into a
/// keychain password slot (portable across the keyring backends). Constructed
/// only in production; unit tests use the in-memory store, so CI never touches
/// the real keychain.
pub struct KeychainStore;

impl KeyMaterialStore for KeychainStore {
    fn load(&self, name: &str) -> Result<Option<Vec<u8>>, SyncError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, name)
            .map_err(|e| SyncError::Transport(e.to_string()))?;
        match entry.get_password() {
            Ok(b64) => base64::engine::general_purpose::STANDARD
                .decode(b64.as_bytes())
                .map(Some)
                .map_err(|_| SyncError::Malformed),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SyncError::Transport(e.to_string())),
        }
    }

    fn store(&self, name: &str, value: &[u8]) -> Result<(), SyncError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, name)
            .map_err(|e| SyncError::Transport(e.to_string()))?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(value);
        entry
            .set_password(&b64)
            .map_err(|e| SyncError::Transport(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::super::sync::{open, seal};
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemStore {
        map: RefCell<HashMap<String, Vec<u8>>>,
    }
    impl KeyMaterialStore for MemStore {
        fn load(&self, name: &str) -> Result<Option<Vec<u8>>, SyncError> {
            Ok(self.map.borrow().get(name).cloned())
        }
        fn store(&self, name: &str, value: &[u8]) -> Result<(), SyncError> {
            self.map
                .borrow_mut()
                .insert(name.to_string(), value.to_vec());
            Ok(())
        }
    }

    #[test]
    fn k_user_is_stable_across_calls_for_the_same_user() {
        // The blob written today must open tomorrow: deriving K_user twice for
        // one user yields the same key (material is persisted, not regenerated).
        let store = MemStore::default();
        let k1 = k_user(&store, "user_a").unwrap();
        let blob = seal(&k1, b"my memory").unwrap();
        let k2 = k_user(&store, "user_a").unwrap();
        assert_eq!(open(&k2, &blob).unwrap(), b"my memory");
    }

    #[test]
    fn k_user_is_distinct_per_user() {
        // Two accounts on one machine must not be able to read each other's blob.
        let store = MemStore::default();
        let ka = k_user(&store, "user_a").unwrap();
        let kb = k_user(&store, "user_b").unwrap();
        let blob = seal(&ka, b"A's memory").unwrap();
        assert!(matches!(open(&kb, &blob), Err(SyncError::Crypto)));
    }

    #[test]
    fn first_use_generates_and_persists_both_secrets() {
        let store = MemStore::default();
        let _ = k_user(&store, "user_a").unwrap();
        let map = store.map.borrow();
        assert_eq!(map.get("k_user_ikm:user_a").map(Vec::len), Some(IKM_LEN));
        assert_eq!(map.get("k_user_salt:user_a").map(Vec::len), Some(SALT_LEN));
    }

    #[test]
    fn generated_ikm_is_not_derivable_from_the_user_id() {
        // The IKM must be high-entropy random, never the user id / bearer.
        let store = MemStore::default();
        let _ = k_user(&store, "user_a").unwrap();
        let ikm = store
            .map
            .borrow()
            .get("k_user_ikm:user_a")
            .cloned()
            .unwrap();
        assert_ne!(ikm, b"user_a".to_vec());
        assert!(ikm.iter().any(|&b| b != 0), "IKM must not be all-zeros");
    }
}
