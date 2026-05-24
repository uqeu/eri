use eri_billing::{BillingClient, Feature, Plan, SubscriptionTier, feature_allowed};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[test]
fn feature_allowed_free_user_is_locked_out_of_paid_features() {
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::UnlimitedMercuryEdits
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::TeamSharing
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::CustomMcpServers
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::PriorityClaudeOpus
    ));
    // Free users have the eri branding forced on.
    assert!(feature_allowed(
        SubscriptionTier::Free,
        Feature::EriBranding
    ));
}

#[test]
fn free_does_not_unlock_one_shot_ship() {
    // Free users do NOT get the "ship it" voice command — regression test:
    // ship_it via Claude polish + Vercel deploy is paid-tier behavior.
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::OneShotShip,
    ));
}

#[test]
fn starter_unlocks_one_shot_ship() {
    assert!(feature_allowed(
        SubscriptionTier::Starter,
        Feature::OneShotShip,
    ));
    // And it inherits up.
    assert!(feature_allowed(SubscriptionTier::Pro, Feature::OneShotShip,));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::OneShotShip,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::OneShotShip,
    ));
}

#[test]
fn feature_allowed_starter_basic_tier_features() {
    // Starter unlocks the entry-level intelligence features.
    assert!(feature_allowed(
        SubscriptionTier::Starter,
        Feature::AdaptiveBrain
    ));
    assert!(feature_allowed(
        SubscriptionTier::Starter,
        Feature::MarketplaceSkills
    ));
    // Starter can hide the eri branding.
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::EriBranding
    ));
    // Starter still gated out of Pro-only features.
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::UnlimitedMercuryEdits
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::CustomMcpServers
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::BugFinderPro,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::MarketplaceSkillsWrite,
    ));
    // TeamSharing is Teams+ now.
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::TeamSharing
    ));
}

#[test]
fn bug_finder_unlocks_at_starter() {
    assert!(!feature_allowed(SubscriptionTier::Free, Feature::BugFinder,));
    assert!(feature_allowed(
        SubscriptionTier::Starter,
        Feature::BugFinder,
    ));
    // Higher tiers inherit it.
    assert!(feature_allowed(SubscriptionTier::Pro, Feature::BugFinder));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::BugFinder,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::BugFinder,
    ));
}

#[test]
fn bug_finder_pro_unlocks_at_pro() {
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::BugFinderPro,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::BugFinderPro
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::BugFinderPro,
    ));
}

#[test]
fn feature_allowed_pro_unlocks_intelligence_layer() {
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::UnlimitedMercuryEdits
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::CustomMcpServers
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::CustomHooksAndRules
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::BranchingIterationTimeline
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::TestGenerator
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::CodeExplainer
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::EarlyAccessNewFeatures
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::MarketplaceSkillsWrite
    ));
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::FrontierModels
    ));
    assert!(feature_allowed(SubscriptionTier::Pro, Feature::CloudAgents));
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::EriBranding
    ));
    // Pro is NOT ProPlus.
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::FrontierPlusModels,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::PriorityClaudeOpus,
    ));
    // TeamSharing remains Teams+.
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::TeamSharing
    ));
}

#[test]
fn codebase_trained_brain_unlocks_at_pro_plus() {
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::CodebaseTrainedBrain,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::CodebaseTrainedBrain,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Teams,
        Feature::CodebaseTrainedBrain,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::CodebaseTrainedBrain,
    ));
}

#[test]
fn private_brain_unlocks_at_pro_plus() {
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::PrivateBrain,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::PrivateBrain,
    ));
}

#[test]
fn multi_agent_orchestration_unlocks_at_pro_plus() {
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::MultiAgentOrchestration,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::MultiAgentOrchestration,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::MultiAgentOrchestration,
    ));
}

#[test]
fn feature_allowed_enterprise_unlocks_everything() {
    for feature in [
        Feature::UnlimitedMercuryEdits,
        Feature::TeamSharing,
        Feature::CustomMcpServers,
        Feature::PriorityClaudeOpus,
        Feature::FrontierModels,
        Feature::FrontierPlusModels,
        Feature::CloudAgents,
        Feature::ExtraCredits5x,
        Feature::SharedTeamContext,
        Feature::TeamRulesAndSkills,
        Feature::SecurityReviewAgent,
        Feature::SsoSamlOidc,
        Feature::UsageAnalytics,
        Feature::CentralizedBilling,
        Feature::AdaptiveBrain,
        Feature::FrontierBrain,
        Feature::PersonalizedBrain,
        Feature::BugFinder,
        Feature::BugFinderPro,
        Feature::CodebaseTrainedBrain,
        Feature::PrivateBrain,
        Feature::BranchingIterationTimeline,
        Feature::MultiAgentOrchestration,
        Feature::PersonalizedFineTuneAdapter,
        Feature::PersonalEriPalette,
        Feature::MarketplaceSkills,
        Feature::MarketplaceSkillsWrite,
        Feature::CustomHooksAndRules,
        Feature::TestGenerator,
        Feature::CodeExplainer,
        Feature::OneShotShip,
        Feature::ExtendedContextWindow,
        Feature::PersonalAiMemory,
        Feature::EarlyAccessNewFeatures,
        Feature::TeamPluginMarketplace,
        Feature::AiCodeTracking,
        Feature::PooledUsage,
        Feature::InvoiceBilling,
        Feature::ScimProvisioning,
        Feature::DedicatedCompute,
        Feature::AuditLogs,
        Feature::IpAllowlisting,
        Feature::DedicatedAccountManager,
    ] {
        assert!(
            feature_allowed(SubscriptionTier::Enterprise, feature),
            "Enterprise should unlock {feature:?}"
        );
    }
    // Enterprise can also hide branding.
    assert!(!feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::EriBranding
    ));
}

#[test]
fn feature_allowed_pro_plus_unlocks_frontier_plus_models() {
    // ProPlus inherits everything Pro can do …
    for feature in [
        Feature::UnlimitedMercuryEdits,
        Feature::CustomMcpServers,
        Feature::FrontierModels,
        Feature::CloudAgents,
        Feature::BugFinderPro,
        Feature::CustomHooksAndRules,
    ] {
        assert!(
            feature_allowed(SubscriptionTier::ProPlus, feature),
            "ProPlus should inherit Pro feature {feature:?}"
        );
    }
    // … and unlocks the frontier-plus-model lane on top.
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::FrontierPlusModels,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::PriorityClaudeOpus,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::ExtraCredits5x,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::ExtendedContextWindow,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::PersonalAiMemory,
    ));
    // ProPlus is not Teams: SSO and shared context stay locked.
    assert!(!feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::SsoSamlOidc,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::SharedTeamContext,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::TeamSharing,
    ));
    // Pro tier itself does NOT unlock frontier-plus models.
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::FrontierPlusModels,
    ));
}

#[test]
fn feature_allowed_teams_unlocks_sso() {
    // Teams inherits Pro tier features.
    for feature in [
        Feature::UnlimitedMercuryEdits,
        Feature::CustomMcpServers,
        Feature::FrontierModels,
        Feature::CloudAgents,
        Feature::BugFinderPro,
        Feature::CustomHooksAndRules,
    ] {
        assert!(
            feature_allowed(SubscriptionTier::Teams, feature),
            "Teams should inherit Pro feature {feature:?}"
        );
    }
    // Teams-only features.
    for feature in [
        Feature::SharedTeamContext,
        Feature::TeamRulesAndSkills,
        Feature::SecurityReviewAgent,
        Feature::SsoSamlOidc,
        Feature::UsageAnalytics,
        Feature::CentralizedBilling,
        Feature::TeamPluginMarketplace,
        Feature::AiCodeTracking,
        Feature::TeamSharing,
        Feature::AuditLogs,
    ] {
        assert!(
            feature_allowed(SubscriptionTier::Teams, feature),
            "Teams should unlock {feature:?}"
        );
    }
    // Pro tier does not get SSO.
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::SsoSamlOidc
    ));
}

#[test]
fn ai_code_tracking_unlocks_at_teams() {
    assert!(!feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::AiCodeTracking,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::AiCodeTracking,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Teams,
        Feature::AiCodeTracking,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::AiCodeTracking,
    ));
}

#[test]
fn pooled_usage_only_unlocks_at_enterprise() {
    for tier in [
        SubscriptionTier::Free,
        SubscriptionTier::Starter,
        SubscriptionTier::Pro,
        SubscriptionTier::ProPlus,
        SubscriptionTier::Teams,
    ] {
        assert!(
            !feature_allowed(tier, Feature::PooledUsage),
            "{tier:?} should NOT unlock PooledUsage"
        );
        assert!(
            !feature_allowed(tier, Feature::InvoiceBilling),
            "{tier:?} should NOT unlock InvoiceBilling"
        );
        assert!(
            !feature_allowed(tier, Feature::ScimProvisioning),
            "{tier:?} should NOT unlock ScimProvisioning"
        );
        assert!(
            !feature_allowed(tier, Feature::DedicatedCompute),
            "{tier:?} should NOT unlock DedicatedCompute"
        );
    }
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::PooledUsage,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::InvoiceBilling,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::ScimProvisioning,
    ));
    assert!(feature_allowed(
        SubscriptionTier::Enterprise,
        Feature::DedicatedCompute,
    ));
}

#[test]
fn adaptive_brain_unlocks_at_starter() {
    assert!(feature_allowed(
        SubscriptionTier::Starter,
        Feature::AdaptiveBrain,
    ));
    // Free does not have an adaptive brain.
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::AdaptiveBrain,
    ));
    // Higher tiers inherit it.
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::AdaptiveBrain,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::AdaptiveBrain,
    ));
}

#[test]
fn frontier_brain_does_not_unlock_at_starter() {
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::FrontierBrain,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::FrontierBrain,
    ));
}

#[test]
fn frontier_brain_unlocks_at_pro() {
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::FrontierBrain,
    ));
    // Pro still has adaptive brain too.
    assert!(feature_allowed(
        SubscriptionTier::Pro,
        Feature::AdaptiveBrain,
    ));
    // But not personalized yet.
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::PersonalizedBrain,
    ));
}

#[test]
fn personalized_brain_does_not_unlock_at_pro() {
    assert!(!feature_allowed(
        SubscriptionTier::Pro,
        Feature::PersonalizedBrain,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Starter,
        Feature::PersonalizedBrain,
    ));
    assert!(!feature_allowed(
        SubscriptionTier::Free,
        Feature::PersonalizedBrain,
    ));
}

#[test]
fn personalized_brain_unlocks_at_pro_plus() {
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::PersonalizedBrain,
    ));
    // ProPlus inherits the other two brain tiers.
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::AdaptiveBrain,
    ));
    assert!(feature_allowed(
        SubscriptionTier::ProPlus,
        Feature::FrontierBrain,
    ));
}

#[test]
fn teams_inherits_all_three_brain_tiers() {
    for feature in [
        Feature::AdaptiveBrain,
        Feature::FrontierBrain,
        Feature::PersonalizedBrain,
    ] {
        assert!(
            feature_allowed(SubscriptionTier::Teams, feature),
            "Teams should inherit brain feature {feature:?}",
        );
    }
}

#[test]
fn plan_from_spoken_resolves_pro_plus_and_teams() {
    for phrase in &[
        "pro plus",
        "pro+",
        "pro_plus",
        "the pro plus plan",
        "pro plus plan",
    ] {
        assert_eq!(
            Plan::from_spoken(phrase),
            Some(Plan::ProPlus),
            "phrase {phrase:?} should resolve to Plan::ProPlus",
        );
    }
    for phrase in &["teams", "team", "team plan", "the teams plan"] {
        assert_eq!(
            Plan::from_spoken(phrase),
            Some(Plan::Teams),
            "phrase {phrase:?} should resolve to Plan::Teams",
        );
    }
    // Slugs round-trip.
    assert_eq!(Plan::ProPlus.slug(), "pro_plus");
    assert_eq!(Plan::Teams.slug(), "teams");
}

#[test]
fn start_checkout_request_body_includes_plan() {
    let (server, base) = start_capture_server(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 41\r\n\r\n{\"url\":\"https://checkout.stripe.com/abc\"}",
    );
    let client = BillingClient::with_base(base).expect("client");
    let url = client
        .start_checkout("tok_test", Plan::Pro)
        .expect("checkout call");
    assert_eq!(url, "https://checkout.stripe.com/abc");

    let captured = server.recv().expect("captured request");
    assert!(
        captured.contains("POST /v1/billing/checkout"),
        "expected checkout path; got:\n{captured}"
    );
    assert!(
        captured.contains("Authorization: Bearer tok_test"),
        "expected bearer header; got:\n{captured}"
    );
    assert!(
        captured.contains("\"plan\":\"pro\""),
        "expected plan in body; got:\n{captured}"
    );
}

#[test]
fn usage_ping_request_body_has_tokens_cost_model() {
    let (server, base) = start_capture_server(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4\r\n\r\nnull",
    );
    let client = BillingClient::with_base(base).expect("client");
    client
        .ping_usage("tok_test", 1234, 0.075, "mercury-2")
        .expect("usage ping");

    let captured = server.recv().expect("captured request");
    assert!(
        captured.contains("POST /v1/billing/usage"),
        "expected usage path; got:\n{captured}"
    );
    assert!(
        captured.contains("\"tokens\":1234"),
        "expected tokens; got:\n{captured}"
    );
    assert!(
        captured.contains("\"cost_usd\":0.075"),
        "expected cost_usd; got:\n{captured}"
    );
    assert!(
        captured.contains("\"model\":\"mercury-2\""),
        "expected model; got:\n{captured}"
    );
}

/// Spawns a one-shot TCP server that accepts a single request, captures the
/// full request bytes (headers + body), writes `response` back, and shuts
/// down. Returns the receiver for the captured request and the `http://...`
/// base URL to point a `BillingClient` at.
fn start_capture_server(response: &'static str) -> (mpsc::Receiver<String>, String) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("local_addr");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        listener
            .set_nonblocking(false)
            .expect("set_nonblocking false");
        let (mut stream, _) = match listener.accept() {
            Ok(pair) => pair,
            Err(err) => {
                let _ = tx.send(format!("accept error: {err}"));
                return;
            }
        };
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let mut buf = [0u8; 4096];
        let mut collected = Vec::new();
        // Read until we see end-of-headers, then consume Content-Length bytes.
        loop {
            match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    collected.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&collected);
                    if let Some(header_end) = text.find("\r\n\r\n") {
                        let headers = &text[..header_end];
                        let content_length = headers
                            .lines()
                            .find_map(|line| {
                                let lower = line.to_ascii_lowercase();
                                lower
                                    .strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        let body_received = collected.len() - (header_end + 4);
                        if body_received >= content_length {
                            break;
                        }
                    }
                }
                Err(_) => break,
            }
        }
        let captured = String::from_utf8_lossy(&collected).to_string();
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        let _ = tx.send(captured);
    });
    (rx, format!("http://{addr}"))
}
