//! Cold-path reflection orchestration (ADR-0007 §3) — the async glue.
//!
//! The defensive parse, the provenance-tagging graph write, and the prompt all
//! live in `eri_inference::memory::reflection` (pure / sync, fully unit-tested).
//! This is the thin async layer that belongs where the inference clients are:
//! assemble the user's recent observations, ask the base engine to extract the
//! entities + relations they evidence, and apply the response — user-scoped and
//! best-effort. The base-engine call is a seam ([`ReflectionClient`]) so
//! production wires the real proxy and tests inject a recorded transcript (no
//! live model), keeping the cold path deterministic + CI-safe.

use anyhow::Result;

use eri_inference::memory::reflection;

/// The base-engine call the reflection pass makes. A seam: prod wires
/// [`ProxyReflectionClient`] (eri tokens via the proxy); tests inject a mock that
/// returns a recorded transcript.
#[async_trait::async_trait]
pub trait ReflectionClient: Send + Sync {
    /// Send `prompt` to the base engine and return its raw text response.
    async fn reflect(&self, prompt: &str) -> Result<String>;
}

/// Run one cold-path reflection flush for the signed-in user over their most
/// recent `limit` observations: collect the batch, build the prompt, call the
/// base engine, and apply the response (grounded, provenance-tagged,
/// user-scoped). Returns the number of entities written. Best-effort over
/// untrusted output — an empty batch or a garbage response simply writes nothing.
pub async fn run_reflection(
    client: &dyn ReflectionClient,
    user_id: Option<&str>,
    limit: usize,
) -> Result<usize> {
    let batch = reflection::reflection_batch(user_id, limit)?;
    if batch.is_empty() {
        return Ok(0);
    }
    let prompt = reflection::reflection_prompt(&batch.texts());
    let response = client.reflect(&prompt).await?;
    let written = reflection::apply_batch(user_id, &batch, &response)?;
    Ok(written)
}

/// Production [`ReflectionClient`]: routes the reflection prompt through the eri
/// proxy (eri tokens), like every other base-engine call. Live IO — exercised
/// end-to-end on the real binary, never in CI (CI uses a mock).
pub struct ProxyReflectionClient;

#[async_trait::async_trait]
impl ReflectionClient for ProxyReflectionClient {
    async fn reflect(&self, prompt: &str) -> Result<String> {
        crate::agent::capture_intent_text("reflect", prompt, None).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A recorded transcript stand-in for the base engine — deterministic.
    struct MockReflectionClient {
        response: String,
    }

    #[async_trait::async_trait]
    impl ReflectionClient for MockReflectionClient {
        async fn reflect(&self, _prompt: &str) -> Result<String> {
            Ok(self.response.clone())
        }
    }

    // The env lock is held across the await to keep HOME isolated for the whole
    // flush; `#[tokio::test]` is current-thread, so the guard never crosses a real
    // thread boundary (the lint's actual hazard).
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn run_reflection_applies_a_mock_clients_reading_to_the_user_graph() {
        // Serialized + temp-HOME (the eri_cli env-test pattern) so the user graph
        // is isolated and race-free; the mock makes the model response a fixture,
        // so the whole cold path is deterministic.
        let _lock = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        // Seed the (anonymous) user's world graph with one observation.
        {
            use eri_graph::world;
            let g = eri_inference::memory::world_recall::open_world_graph(None).unwrap();
            world::record_observation(&g, "Paired with Priya on the atlas project").unwrap();
        }

        let client = MockReflectionClient {
            response: r#"{
                "entities":[{"kind":"person","name":"Priya"},{"kind":"project","name":"atlas"}],
                "relations":[{"src":"Priya","dst":"atlas","relation":"collaborates_on"}]
            }"#
            .into(),
        };
        let written = run_reflection(&client, None, 50).await.unwrap();
        assert_eq!(
            written, 2,
            "the mock reading is grounded in the observation and applied to the user graph"
        );

        // The inferred entities are now queryable in the user's graph.
        use eri_graph::world;
        let g = eri_inference::memory::world_recall::open_world_graph(None).unwrap();
        let people = world::entities_of_kind(&g, world::entity_kind::PERSON).unwrap();
        assert!(
            people.iter().any(|e| e.canonical_name() == "Priya"),
            "Priya is in the user's world model after the flush"
        );

        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    #[allow(clippy::await_holding_lock)] // see the note above; current-thread test
    #[tokio::test]
    async fn an_empty_graph_reflects_to_nothing_without_calling_the_model() {
        let _lock = crate::config::ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::TempDir::new().unwrap();
        let prev = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        // A client that PANICS if called — proves an empty batch never calls the
        // base engine (no wasted tokens on the cold path).
        struct NeverClient;
        #[async_trait::async_trait]
        impl ReflectionClient for NeverClient {
            async fn reflect(&self, _prompt: &str) -> Result<String> {
                panic!("must not call the base engine with no observations")
            }
        }
        let written = run_reflection(&NeverClient, None, 50).await.unwrap();
        assert_eq!(written, 0);

        unsafe {
            match prev.as_deref() {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
        }
    }
}
