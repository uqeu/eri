//! Tier-B cross-device memory sync — the encrypted blob round-trip (ADR-0001).
//!
//! The full observation log (tombstones included) is end-to-end encrypted with
//! `K_user` and pushed to / pulled from the cloud `memory_blobs` store. The
//! cloud only ever holds opaque bytes keyed by the caller's bearer; it cannot
//! read the plaintext. Pulled observations feed [`MemoryStore::apply_merge`]
//! (union + last-write-wins + tombstones), so a `/forget` on one device can't
//! resurrect from a stale copy on another and concurrent edits converge.
//!
//! Layered as a deep module behind a thin [`SyncTransport`] seam: the crypto +
//! merge core is unit-tested with an in-memory stub transport; the production
//! transport is a `ureq` client against `/api/v1/memory/sync` (same base-URL +
//! bearer contract as `eri_auth`).
//!
//! `K_user` is derived via HKDF-SHA256 over a **stored per-user salt** (not the
//! rotating bearer), so the key is stable across token rotation (ADR-0001).

use std::time::Duration;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine as _;
use zeroize::Zeroizing;

use crate::memory::Observation;

/// AES-256-GCM nonce length, in bytes.
const NONCE_LEN: usize = 12;

/// HKDF `info` context string — domain-separates `K_user` from any other key
/// that might be derived from the same input material in the future.
const HKDF_INFO: &[u8] = b"eri-memory-tier-b-v1";

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("sync transport error: {0}")]
    Transport(String),
    /// Decryption / authentication failed. Deliberately detail-free so the
    /// error can't act as a padding/format oracle.
    #[error("memory blob could not be decrypted")]
    Crypto,
    #[error("memory blob is malformed")]
    Malformed,
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// The symmetric key that encrypts the Tier-B memory blob. Newtype over the
/// 32 raw bytes so it can't be confused with arbitrary `[u8; 32]` data and so
/// the derivation is the only blessed way to make one. The bytes are wrapped in
/// [`Zeroizing`] so they're wiped from memory on drop, and the type is
/// deliberately **not** `Clone` to keep copies of key material from proliferating
/// (security: H-3).
pub struct MemoryKey(Zeroizing<[u8; 32]>);

impl MemoryKey {
    /// Derive `K_user` from input keying material + a stored per-user salt via
    /// HKDF-SHA256.
    ///
    /// **IKM provenance (security: C-1) — the caller MUST honor this:**
    /// - `ikm` must be a high-entropy secret generated once and stored in the OS
    ///   keychain (e.g. 32 random bytes). It must **never** be the rotating
    ///   `eri_sk_…` bearer, the user's email, or any low-entropy/derivable value
    ///   — using the bearer would re-key on every token rotation and orphan
    ///   every existing blob.
    /// - `salt` must be a separate per-user value, also persisted (not the
    ///   bearer). Deriving from a stored salt keeps the key stable across token
    ///   rotation (ADR-0001).
    pub fn derive(ikm: &[u8], salt: &[u8]) -> Self {
        let hk = hkdf::Hkdf::<sha2::Sha256>::new(Some(salt), ikm);
        let mut key = Zeroizing::new([0u8; 32]);
        // HKDF-Expand only fails when the output length exceeds 255*HashLen;
        // 32 bytes is far under that, so this is infallible here.
        hk.expand(HKDF_INFO, key.as_mut_slice())
            .expect("32-byte HKDF expansion is always valid");
        Self(key)
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(self.0.as_slice()))
    }
}

/// Encrypt `plaintext` under `key`. Output layout is `nonce || ciphertext+tag`;
/// a fresh random nonce is generated per call so identical plaintexts produce
/// distinct blobs (no deterministic leakage). [`HKDF_INFO`] is bound as AAD so
/// the ciphertext is authenticated against its Tier-B domain (security: M-1).
pub fn seal(key: &MemoryKey, plaintext: &[u8]) -> Result<Vec<u8>, SyncError> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    // A CSPRNG failure is a fatal crypto condition, not a retriable transport
    // error (and we never echo the OS error string) — security: M-2.
    getrandom::getrandom(&mut nonce_bytes).map_err(|_| SyncError::Crypto)?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = key
        .cipher()
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: HKDF_INFO,
            },
        )
        .map_err(|_| SyncError::Crypto)?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a `nonce || ciphertext+tag` blob under `key`. Fails with
/// [`SyncError::Crypto`] on a wrong key, any tampering, or a mismatched AAD
/// domain (GCM authenticates), and [`SyncError::Malformed`] if the blob is too
/// short to hold a nonce.
pub fn open(key: &MemoryKey, blob: &[u8]) -> Result<Vec<u8>, SyncError> {
    if blob.len() < NONCE_LEN {
        return Err(SyncError::Malformed);
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    key.cipher()
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: HKDF_INFO,
            },
        )
        .map_err(|_| SyncError::Crypto)
}

/// The cloud-blob transport seam. The production impl is a `ureq` client against
/// `/api/v1/memory/sync`; tests use an in-memory stub. Carrying opaque bytes (not
/// observations) keeps every plaintext concern — and the key — on the client.
pub trait SyncTransport {
    /// Fetch the stored blob, or `None` if the user has never synced.
    fn download(&self) -> Result<Option<Vec<u8>>, SyncError>;
    /// Replace the stored blob with `blob`.
    fn upload(&self, blob: &[u8]) -> Result<(), SyncError>;
}

/// The Tier-B sync engine: encrypts the local observation log with `K_user` and
/// round-trips it through a [`SyncTransport`]. Pulled observations are merged
/// via [`MemoryStore::apply_merge`], never blindly overwritten.
pub struct MemorySync<T: SyncTransport> {
    transport: T,
    key: MemoryKey,
}

impl<T: SyncTransport> MemorySync<T> {
    pub fn new(transport: T, key: MemoryKey) -> Self {
        Self { transport, key }
    }

    /// Encrypt `observations` and upload them as the user's memory blob. The
    /// caller passes the *full* log (tombstones included) so merges on other
    /// devices stay correct.
    pub fn push(&self, observations: &[Observation]) -> Result<(), SyncError> {
        let plaintext = serde_json::to_vec(observations)?;
        let blob = seal(&self.key, &plaintext)?;
        self.transport.upload(&blob)
    }

    /// Download + decrypt the remote blob into observations. Returns an empty
    /// vec when nothing has been synced yet, so callers can merge unconditionally.
    pub fn pull(&self) -> Result<Vec<Observation>, SyncError> {
        let Some(blob) = self.transport.download()? else {
            return Ok(Vec::new());
        };
        let plaintext = open(&self.key, &blob)?;
        let observations = serde_json::from_slice(&plaintext)?;
        Ok(observations)
    }

    /// One convergent round-trip for `store`: pull the remote log, merge it in
    /// (union + LWW + tombstones via [`MemoryStore::apply_merge`]), then push
    /// the merged result back so the cloud converges too. Idempotent — running
    /// it on an already-synced pair is a no-op.
    pub fn sync(&self, store: &mut crate::memory::MemoryStore) -> Result<(), SyncError> {
        let remote = self.pull()?;
        store
            .apply_merge(remote)
            .map_err(|e| SyncError::Transport(e.to_string()))?;
        self.push(&store.snapshot())
    }
}

/// Path of the Tier-B blob endpoint (mirrors `eri_auth::endpoints`).
const SYNC_PATH: &str = "/api/v1/memory/sync";

/// JSON envelope the cloud route speaks: `{ blob_base64 }`.
#[derive(serde::Serialize)]
struct UploadBody {
    blob_base64: String,
}

#[derive(serde::Deserialize)]
struct DownloadBody {
    blob_base64: Option<String>,
}

/// Build the PUT body for `blob` — base64 in a `{ blob_base64 }` envelope.
fn encode_upload_body(blob: &[u8]) -> Result<String, SyncError> {
    let blob_base64 = base64::engine::general_purpose::STANDARD.encode(blob);
    Ok(serde_json::to_string(&UploadBody { blob_base64 })?)
}

/// Parse a GET response body into raw blob bytes. `null`/absent `blob_base64`
/// (an unsynced account) maps to `None`; a present value is base64-decoded.
fn decode_download_body(json: &str) -> Result<Option<Vec<u8>>, SyncError> {
    let body: DownloadBody = serde_json::from_str(json)?;
    match body.blob_base64 {
        None => Ok(None),
        Some(b64) => base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .map(Some)
            .map_err(|_| SyncError::Malformed),
    }
}

/// Production transport: a `ureq` client against the cloud `memory_blobs` route,
/// authenticated with the same `eri_sk_*` bearer as the rest of the API. Thin by
/// design — all crypto + merge logic lives in [`MemorySync`]; this only moves
/// opaque base64 bytes (the envelope shaping is the unit-tested part).
pub struct HttpSyncTransport {
    api_base: String,
    bearer: String,
    http: ureq::Agent,
}

impl HttpSyncTransport {
    pub fn new(api_base: impl Into<String>, bearer: impl Into<String>) -> Self {
        let api_base = api_base.into().trim_end_matches('/').to_string();
        // The bearer + (E2E) blob must never cross plaintext HTTP. Loud in dev
        // (catches a misconfigured base); HTTPS is enforced for real in prod by
        // the deployed base URL (security: L-3).
        debug_assert!(
            api_base.starts_with("https://") || api_base.starts_with("http://localhost"),
            "HttpSyncTransport requires HTTPS; got: {api_base}"
        );
        let http = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build();
        Self {
            api_base,
            bearer: bearer.into(),
            http,
        }
    }

    fn url(&self) -> String {
        format!("{}{}", self.api_base, SYNC_PATH)
    }

    fn auth(&self) -> String {
        format!("Bearer {}", self.bearer)
    }
}

impl SyncTransport for HttpSyncTransport {
    fn download(&self) -> Result<Option<Vec<u8>>, SyncError> {
        match self
            .http
            .get(&self.url())
            .set("authorization", &self.auth())
            .call()
        {
            Ok(response) => {
                let body = response
                    .into_string()
                    .map_err(|e| SyncError::Transport(e.to_string()))?;
                decode_download_body(&body)
            }
            Err(ureq::Error::Status(status, _)) => {
                Err(SyncError::Transport(format!("sync GET returned {status}")))
            }
            Err(other) => Err(SyncError::Transport(other.to_string())),
        }
    }

    fn upload(&self, blob: &[u8]) -> Result<(), SyncError> {
        let body = encode_upload_body(blob)?;
        match self
            .http
            .put(&self.url())
            .set("authorization", &self.auth())
            .set("content-type", "application/json")
            .send_string(&body)
        {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(status, _)) => {
                Err(SyncError::Transport(format!("sync PUT returned {status}")))
            }
            Err(other) => Err(SyncError::Transport(other.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    fn test_key() -> MemoryKey {
        MemoryKey::derive(b"input-keying-material", b"per-user-salt")
    }

    /// In-memory stand-in for the cloud blob store. A shared cell so two
    /// `MemorySync`s can model two devices talking to the same backend.
    #[derive(Clone, Default)]
    struct StubTransport {
        blob: Rc<RefCell<Option<Vec<u8>>>>,
    }

    impl SyncTransport for StubTransport {
        fn download(&self) -> Result<Option<Vec<u8>>, SyncError> {
            Ok(self.blob.borrow().clone())
        }
        fn upload(&self, blob: &[u8]) -> Result<(), SyncError> {
            *self.blob.borrow_mut() = Some(blob.to_vec());
            Ok(())
        }
    }

    fn obs(id: &str, ts_ms: u64, kind: &str, body: &str) -> Observation {
        Observation {
            id: id.to_string(),
            ts_ms,
            kind: kind.to_string(),
            workspace_hash: String::new(),
            body: body.to_string(),
            embedding: Vec::new(),
        }
    }

    #[test]
    fn seal_then_open_roundtrips_plaintext() {
        let key = test_key();
        let plaintext = b"the user prefers tabs over spaces";
        let blob = seal(&key, plaintext).unwrap();
        assert_ne!(blob.as_slice(), plaintext, "blob must be encrypted");
        let recovered = open(&key, &blob).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn open_with_the_wrong_key_fails() {
        // The cross-user isolation guarantee: even if user B's bytes leaked,
        // user A's key cannot decrypt them.
        let blob = seal(&test_key(), b"user B's private memory").unwrap();
        let other = MemoryKey::derive(b"input-keying-material", b"a-different-salt");
        assert!(matches!(open(&other, &blob), Err(SyncError::Crypto)));
    }

    #[test]
    fn open_rejects_tampered_ciphertext() {
        let key = test_key();
        let mut blob = seal(&key, b"do not tamper").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0xff; // flip a bit in the GCM tag region
        assert!(matches!(open(&key, &blob), Err(SyncError::Crypto)));
    }

    #[test]
    fn open_rejects_a_blob_shorter_than_a_nonce() {
        let key = test_key();
        assert!(matches!(open(&key, &[0u8; 4]), Err(SyncError::Malformed)));
    }

    #[test]
    fn seal_uses_a_fresh_nonce_each_call() {
        // Identical plaintext must not produce identical blobs — otherwise the
        // cloud could detect "memory unchanged" or correlate users.
        let key = test_key();
        let a = seal(&key, b"same input").unwrap();
        let b = seal(&key, b"same input").unwrap();
        assert_ne!(a, b, "nonce reuse would leak that the plaintext repeated");
    }

    #[test]
    fn derive_is_deterministic_for_the_same_inputs() {
        // A device re-deriving K_user from the stored salt must get the same key
        // back across restarts (so it can still open its own blobs).
        let a = MemoryKey::derive(b"ikm", b"salt");
        let b = MemoryKey::derive(b"ikm", b"salt");
        let blob = seal(&a, b"persisted").unwrap();
        assert_eq!(open(&b, &blob).unwrap(), b"persisted");
    }

    #[test]
    fn push_then_pull_roundtrips_observations() {
        let sync = MemorySync::new(StubTransport::default(), test_key());
        let log = vec![
            obs("a", 10, "fact", "name is Khai"),
            obs("b", 20, "edit_accepted", "header.tsx"),
        ];
        sync.push(&log).unwrap();
        let pulled = sync.pull().unwrap();
        assert_eq!(pulled.len(), 2);
        assert_eq!(pulled[0].id, "a");
        assert_eq!(pulled[1].body, "header.tsx");
    }

    #[test]
    fn pull_on_an_unsynced_account_is_empty_not_an_error() {
        let sync = MemorySync::new(StubTransport::default(), test_key());
        assert!(sync.pull().unwrap().is_empty());
    }

    #[test]
    fn the_uploaded_blob_is_ciphertext_not_plaintext() {
        let transport = StubTransport::default();
        let sync = MemorySync::new(transport.clone(), test_key());
        sync.push(&[obs("a", 1, "fact", "TOP SECRET passphrase")])
            .unwrap();
        let stored = transport.blob.borrow().clone().unwrap();
        let haystack = String::from_utf8_lossy(&stored);
        assert!(
            !haystack.contains("TOP SECRET"),
            "cloud must never see plaintext"
        );
    }

    #[test]
    fn a_second_device_with_the_wrong_key_cannot_pull() {
        let transport = StubTransport::default();
        MemorySync::new(transport.clone(), test_key())
            .push(&[obs("a", 1, "fact", "private")])
            .unwrap();
        let intruder = MemorySync::new(transport, MemoryKey::derive(b"ikm", b"other"));
        assert!(matches!(intruder.pull(), Err(SyncError::Crypto)));
    }

    /// A `MemoryStore` backed by a fresh temp file — models one device.
    fn temp_store() -> (tempfile::TempDir, crate::memory::MemoryStore) {
        let dir = tempfile::TempDir::new().unwrap();
        let store = crate::memory::MemoryStore::open_at(dir.path().join("memory.json")).unwrap();
        (dir, store)
    }

    #[test]
    fn sync_propagates_observations_across_two_devices() {
        // Shared cloud blob; two devices keyed identically (the same user).
        let cloud = StubTransport::default();
        let (_da, mut device_a) = temp_store();
        let (_db, mut device_b) = temp_store();

        device_a
            .insert("fact", std::path::Path::new("/ws"), "name is Khai")
            .unwrap();
        MemorySync::new(cloud.clone(), test_key())
            .sync(&mut device_a)
            .unwrap();

        // Device B has never seen this fact until it syncs.
        assert!(device_b.all().is_empty());
        MemorySync::new(cloud.clone(), test_key())
            .sync(&mut device_b)
            .unwrap();
        assert!(device_b.all().iter().any(|o| o.body == "name is Khai"));
    }

    #[test]
    fn a_forgotten_fact_does_not_resurrect_through_the_cloud() {
        // Device A learns then forgets a fact and syncs the tombstone up.
        // Device B still holds the stale copy; syncing must NOT bring it back.
        let cloud = StubTransport::default();
        let (_da, mut device_a) = temp_store();
        let (_db, mut device_b) = temp_store();

        let id = device_a
            .insert("fact", std::path::Path::new("/ws"), "delete me")
            .unwrap()
            .id;
        MemorySync::new(cloud.clone(), test_key())
            .sync(&mut device_a)
            .unwrap();
        MemorySync::new(cloud.clone(), test_key())
            .sync(&mut device_b)
            .unwrap();
        assert!(
            device_b.all().iter().any(|o| o.id == id),
            "B has the fact pre-forget"
        );

        device_a.forget(&id).unwrap();
        MemorySync::new(cloud.clone(), test_key())
            .sync(&mut device_a)
            .unwrap();
        MemorySync::new(cloud.clone(), test_key())
            .sync(&mut device_b)
            .unwrap();

        assert!(
            !device_b.all().iter().any(|o| o.id == id),
            "the tombstone must suppress the forgotten fact on device B"
        );
    }

    #[test]
    fn upload_body_then_download_body_roundtrips_bytes() {
        // The HTTP envelope (base64 in `{ blob_base64 }`) must survive a
        // round-trip through both shaping functions unchanged.
        let blob = seal(&test_key(), b"some ciphertext").unwrap();
        let put = encode_upload_body(&blob).unwrap();
        // Simulate the GET response echoing the stored value back.
        let got = decode_download_body(&put).unwrap().unwrap();
        assert_eq!(got, blob);
    }

    #[test]
    fn download_body_treats_null_blob_as_unsynced() {
        assert!(
            decode_download_body(r#"{"blob_base64":null}"#)
                .unwrap()
                .is_none()
        );
        assert!(
            decode_download_body(r#"{"updated_at":null}"#)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn download_body_rejects_non_base64() {
        assert!(matches!(
            decode_download_body(r#"{"blob_base64":"not valid base64 !!!"}"#),
            Err(SyncError::Malformed)
        ));
    }

    #[test]
    fn sync_is_idempotent_once_converged() {
        let cloud = StubTransport::default();
        let (_da, mut device_a) = temp_store();
        device_a
            .insert("fact", std::path::Path::new("/ws"), "stable")
            .unwrap();
        let s = MemorySync::new(cloud.clone(), test_key());
        s.sync(&mut device_a).unwrap();
        let after_first = device_a.all();
        s.sync(&mut device_a).unwrap();
        assert_eq!(
            device_a.all().len(),
            after_first.len(),
            "re-sync changes nothing"
        );
    }
}
