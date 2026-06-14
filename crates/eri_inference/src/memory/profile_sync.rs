//! Tier-A profile push — uploads the distilled [`Profile`] to the cloud
//! `/api/v1/memory/profile` route (the server-readable personalization profile,
//! ADR-0001). Symmetric to [`super::sync`] (Tier-B blob), but Tier-A is *not*
//! E2E: the client sends plaintext and the server encrypts at rest with
//! `K_server`. The wire body splits the static projection (`facts` +
//! `preferences`) from the live `dynamic_context`, matching the route's two
//! encrypted columns.
//!
//! Layered behind a [`ProfileTransport`] seam — an in-memory stub for tests, an
//! [`EriApiClient`]-backed adapter for prod — so the body shaping is unit-tested
//! without a network.

use super::cloud::EriApiClient;
use super::profile::Profile;
use super::sync::SyncError;

/// Path of the Tier-A profile endpoint.
const PROFILE_PATH: &str = "/api/v1/memory/profile";

/// The PUT body the `/memory/profile` route expects: a plaintext static profile
/// object + the live dynamic context (the server encrypts both at rest).
#[derive(serde::Serialize)]
struct ProfileBody<'a> {
    profile: StaticProfile<'a>,
    dynamic_context: &'a str,
}

#[derive(serde::Serialize)]
struct StaticProfile<'a> {
    facts: &'a [String],
    preferences: &'a [String],
}

/// Shape a [`Profile`] into the route's JSON body. Pure + unit-tested.
fn profile_upload_body(profile: &Profile) -> Result<String, SyncError> {
    let body = ProfileBody {
        profile: StaticProfile {
            facts: &profile.facts,
            preferences: &profile.preferences,
        },
        dynamic_context: &profile.dynamic_context,
    };
    Ok(serde_json::to_string(&body)?)
}

/// The Tier-A upload seam. Carries the already-shaped JSON body so the transport
/// has no opinion about the profile's structure.
pub trait ProfileTransport {
    fn upload(&self, body: &str) -> Result<(), SyncError>;
}

/// Production transport: a thin adapter over [`EriApiClient`] targeting
/// `/memory/profile` — the same client the Tier-B [`super::sync::HttpSyncTransport`]
/// rides, not a second copy of the plumbing.
pub struct HttpProfileTransport {
    client: EriApiClient,
}

impl HttpProfileTransport {
    pub fn new(api_base: impl Into<String>, bearer: impl Into<String>) -> Self {
        Self {
            client: EriApiClient::with_base(api_base, bearer),
        }
    }

    /// Adapt an already-built client (so one `EriApiClient` can back both the
    /// Tier-A and Tier-B transports for a session).
    pub fn from_client(client: EriApiClient) -> Self {
        Self { client }
    }
}

impl ProfileTransport for HttpProfileTransport {
    fn upload(&self, body: &str) -> Result<(), SyncError> {
        self.client.put_json(PROFILE_PATH, body)
    }
}

/// Shape + upload the Tier-A profile. The caller distills the [`Profile`]
/// (`profile::distill`) and decides *when* to push (debounced after inserts /
/// on startup — wired at the call site).
pub fn push_profile(transport: &dyn ProfileTransport, profile: &Profile) -> Result<(), SyncError> {
    transport.upload(&profile_upload_body(profile)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct StubProfileTransport {
        last: RefCell<Option<String>>,
    }
    impl ProfileTransport for StubProfileTransport {
        fn upload(&self, body: &str) -> Result<(), SyncError> {
            *self.last.borrow_mut() = Some(body.to_string());
            Ok(())
        }
    }

    fn sample() -> Profile {
        Profile {
            facts: vec!["name is Khai".into(), "builds eri".into()],
            preferences: vec!["accepts most edits".into()],
            dynamic_context: "Today: shipped the overlay".into(),
        }
    }

    #[test]
    fn body_splits_static_profile_from_dynamic_context() {
        let body = profile_upload_body(&sample()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["profile"]["facts"][0], "name is Khai");
        assert_eq!(v["profile"]["preferences"][0], "accepts most edits");
        assert_eq!(v["dynamic_context"], "Today: shipped the overlay");
        // dynamic_context must NOT be nested inside `profile` (route contract).
        assert!(v["profile"]["dynamic_context"].is_null());
    }

    #[test]
    fn push_uploads_the_shaped_body() {
        let transport = StubProfileTransport::default();
        push_profile(&transport, &sample()).unwrap();
        let sent = transport.last.borrow().clone().unwrap();
        let v: serde_json::Value = serde_json::from_str(&sent).unwrap();
        assert_eq!(v["profile"]["facts"][1], "builds eri");
    }

    #[test]
    fn an_empty_profile_still_produces_a_valid_body() {
        // Pushing an empty profile clears the cloud to match local truth; the
        // route accepts an object with empty arrays.
        let body = profile_upload_body(&Profile::default()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(v["profile"]["facts"].as_array().unwrap().is_empty());
        assert_eq!(v["dynamic_context"], "");
    }
}
