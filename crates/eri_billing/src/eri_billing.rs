//! Client-side billing and feature-gating for eri.
//!
//! Pairs with the website backend (Stripe-backed) and the eri_auth client
//! (which provides the bearer token for authenticated requests). This crate is
//! intentionally I/O-light: HTTP is done via blocking `ureq` so call sites can
//! drive it from any async runtime via `spawn_blocking`, and the feature gate
//! is a pure function so tests cover every (tier, feature) combination.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

/// Default eri.dev API base. Overridable via `ERI_BILLING_API_BASE` for staging
/// and tests. Trailing slash is stripped at construction.
const DEFAULT_API_BASE: &str = "https://api.eri.dev";
const API_BASE_ENV: &str = "ERI_BILLING_API_BASE";

/// Subscription tier mirrors the website's `subscription_tier` column. Defined
/// here (rather than re-exported from `eri_auth`) so this crate can stand on
/// its own — the auth crate will re-export this enum when it lands.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionTier {
    Free,
    Starter,
    Pro,
    ProPlus,
    Teams,
    Enterprise,
}

impl SubscriptionTier {
    pub fn slug(self) -> &'static str {
        match self {
            SubscriptionTier::Free => "free",
            SubscriptionTier::Starter => "starter",
            SubscriptionTier::Pro => "pro",
            SubscriptionTier::ProPlus => "pro_plus",
            SubscriptionTier::Teams => "teams",
            SubscriptionTier::Enterprise => "enterprise",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    Active,
    PastDue,
    Canceled,
    Incomplete,
    Trialing,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Subscription {
    pub tier: SubscriptionTier,
    pub status: SubscriptionStatus,
    pub current_period_end: i64,
    pub cancel_at_period_end: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UsageSummary {
    pub this_month_usd: f64,
    pub this_month_tokens: u64,
    pub limit_usd: f64,
    pub days_until_reset: u32,
}

/// Subscription plan that the user is checking out into. `Enterprise` and
/// `Free` are deliberately absent here — Free needs no checkout and Enterprise
/// is handled via direct sales.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Plan {
    Starter,
    Pro,
    ProPlus,
    Teams,
}

impl Plan {
    pub fn slug(self) -> &'static str {
        match self {
            Plan::Starter => "starter",
            Plan::Pro => "pro",
            Plan::ProPlus => "pro_plus",
            Plan::Teams => "teams",
        }
    }

    /// Resolve a user-spoken plan name into a `Plan`. Used by the voice command
    /// router when handling `ControlCommand::OpenCheckout`.
    pub fn from_spoken(name: &str) -> Option<Self> {
        let lowered = name.trim().to_ascii_lowercase();
        match lowered.as_str() {
            "starter" | "the starter plan" | "starter plan" | "basic" => Some(Plan::Starter),
            "pro" | "the pro plan" | "pro plan" | "professional" | "premium" => Some(Plan::Pro),
            "pro plus"
            | "pro+"
            | "pro_plus"
            | "the pro plus plan"
            | "pro plus plan"
            | "the pro+ plan"
            | "pro+ plan" => Some(Plan::ProPlus),
            "teams"
            | "team"
            | "team plan"
            | "the team plan"
            | "teams plan"
            | "the teams plan" => Some(Plan::Teams),
            _ => None,
        }
    }
}

/// Features that the billing tier table gates. Centralized here so UI panels,
/// inference call sites, and onboarding can ask `feature_allowed(tier, ...)`
/// without each one re-implementing the matrix.
///
/// The "Brain" features represent depth-of-personalization tiers:
///
/// - `AdaptiveBrain` (Starter+): eri_cache cross-session memory unlocks. The
///   `SessionRecap` namespace persists. Intent classifications get cached.
///   Design preferences accumulate per-project.
///
/// - `FrontierBrain` (Pro+): unlocks the LlmProvider multi-model trait. Voice
///   commands like "use gpt-4o" and "switch to claude" actually do something.
///   Cloud agents (background Claude tasks) can run idle.
///
/// - `PersonalizedBrain` (ProPlus+): eri_index trains a private embedding
///   model on the user's project, the cache namespace marks entries
///   private-do-not-share, and a local LoRA fine-tune adapter learns the
///   user's style.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Feature {
    /// Pro+. Lift the per-month Mercury Edit call cap.
    UnlimitedMercuryEdits,
    /// Teams+. Share builds with teammates.
    TeamSharing,
    /// Pro+. Configure custom MCP servers beyond the built-in set.
    CustomMcpServers,
    /// Free only. The little "Built with eri" badge in the corner of shipped
    /// builds. Free has it forced ON; Starter+ can hide it.
    EriBranding,
    /// ProPlus+. Priority Claude Opus polish queue — jump the line on the
    /// flagship reasoning model.
    PriorityClaudeOpus,
    /// Pro+. Access to the frontier model lane (Claude Opus, GPT-5 flagship,
    /// Gemini Ultra) on top of the standard Mercury 2 path.
    FrontierModels,
    /// ProPlus+. Frontier+ models — Opus, GPT-4.5/5, Gemini 2.5 Pro Ultra and
    /// the next-generation lane above the standard frontier set.
    FrontierPlusModels,
    /// Pro+. Long-running cloud agents that keep working while the desktop
    /// app is closed.
    CloudAgents,
    /// ProPlus+. 5x the per-month credit allowance versus Pro.
    ExtraCredits5x,
    /// Teams+. Shared project context and iteration history across the team.
    SharedTeamContext,
    /// Teams+. Centrally managed rule packs and skill libraries.
    TeamRulesAndSkills,
    /// Teams+. Automated security review agent in code review.
    SecurityReviewAgent,
    /// Teams+. SSO via SAML 2.0 / OIDC.
    SsoSamlOidc,
    /// Teams+. Per-seat and per-project usage analytics dashboard.
    UsageAnalytics,
    /// Teams+. Single invoice / billing contact for the whole org.
    CentralizedBilling,
    /// Adaptive Eri — basic cross-session memory + pattern learning. Starter+
    AdaptiveBrain,
    /// Frontier Eri — multi-model routing + cloud agents. Pro+
    FrontierBrain,
    /// Personalized Eri — codebase-trained patterns + private brain + local
    /// fine-tune adapter. ProPlus+
    PersonalizedBrain,
    /// Starter+ basic background bug detection; Pro+ gets autonomous detection
    /// with auto-fix via `BugFinderPro`.
    BugFinder,
    /// Pro+. Bug Finder Pro — autonomous detection plus auto-fix suggestions
    /// running continuously in the background.
    BugFinderPro,
    /// ProPlus+. eri reads your full project and learns YOUR conventions, then
    /// biases every completion toward them.
    CodebaseTrainedBrain,
    /// ProPlus+. Brain is never shared with other users — lives in the local
    /// cache and never leaves the device.
    PrivateBrain,
    /// Pro+. Run 3 versions of a change in parallel and pick the winner from
    /// the branching iteration timeline.
    BranchingIterationTimeline,
    /// ProPlus+. Run 3+ agents simultaneously, each with their own scratchpad
    /// and rollback point.
    MultiAgentOrchestration,
    /// ProPlus+. Local LoRA weights trained on your style, applied on top of
    /// the base model at inference time.
    PersonalizedFineTuneAdapter,
    /// ProPlus+. Personal eri palette — custom Cmd-K commands defined per
    /// user, surfaced in the command bar.
    PersonalEriPalette,
    /// Starter+. Read-only access to the community skills marketplace.
    MarketplaceSkills,
    /// Pro+. Install marketplace skills and author your own for publication.
    MarketplaceSkillsWrite,
    /// Pro+. Project-specific `.eri/rules.md` and custom hooks honored by the
    /// agent during every session.
    CustomHooksAndRules,
    /// Pro+. Voice-driven test generation — "write tests for this" produces a
    /// full suite scoped to the current file.
    TestGenerator,
    /// Pro+. Voice-driven code explanation — "what does this do" returns a
    /// narrated walkthrough of the selected region.
    CodeExplainer,
    /// Starter+. Voice "ship it" → Claude polish + Vercel deploy in one step.
    /// Explicitly NOT available on Free.
    OneShotShip,
    /// ProPlus+. 256K+ token context window across multi-model routing so
    /// large monorepos fit in one prompt.
    ExtendedContextWindow,
    /// ProPlus+. Global memory across ALL projects — eri remembers patterns
    /// you taught it in any project and applies them everywhere.
    PersonalAiMemory,
    /// Pro+. Beta and research preview features land here first.
    EarlyAccessNewFeatures,
    /// Teams+. Internal plugin hub for your team's private packages.
    TeamPluginMarketplace,
    /// Teams+. Track AI vs human contributions per PR for governance and
    /// productivity reporting.
    AiCodeTracking,
    /// Enterprise. Shared credit pool with no per-seat limits — usage flows
    /// freely across the org.
    PooledUsage,
    /// Enterprise. Invoice / PO billing instead of per-seat card billing.
    InvoiceBilling,
    /// Enterprise. SCIM provisioning via Okta / Azure AD.
    ScimProvisioning,
    /// Enterprise. Private dedicated compute for sensitive code that must
    /// never share infrastructure.
    DedicatedCompute,
    /// Teams+ basic, Enterprise full. Compliance-grade audit logs of every
    /// agent action.
    AuditLogs,
    /// Enterprise. IP allowlisting plus custom data retention policy.
    IpAllowlisting,
    /// Enterprise. 24/7 priority support with a named dedicated account
    /// manager.
    DedicatedAccountManager,
}

/// Pure tier × feature lookup. `const fn` so it compiles down to a jump table,
/// and so call sites can use it in `const` contexts.
///
/// Tier hierarchy for "is this gated feature unlocked?":
/// - Starter unlocks Starter-tier features.
/// - Pro inherits Starter and unlocks Pro-tier features.
/// - ProPlus inherits Pro and unlocks the frontier-model lane.
/// - Teams inherits Pro and unlocks the collaboration / SSO suite.
/// - Enterprise inherits everything (ProPlus ∪ Teams).
/// EriBranding inverts: it's "must show eri branding"; Free is forced ON.
pub const fn feature_allowed(tier: SubscriptionTier, feature: Feature) -> bool {
    match feature {
        // EriBranding is forced on Free only.
        Feature::EriBranding => matches!(tier, SubscriptionTier::Free),

        // Starter+ (Starter, Pro, ProPlus, Teams, Enterprise).
        Feature::OneShotShip
        | Feature::BugFinder
        | Feature::MarketplaceSkills
        | Feature::AdaptiveBrain => matches!(
            tier,
            SubscriptionTier::Starter
                | SubscriptionTier::Pro
                | SubscriptionTier::ProPlus
                | SubscriptionTier::Teams
                | SubscriptionTier::Enterprise,
        ),

        // Pro+ (Pro, ProPlus, Teams, Enterprise).
        Feature::UnlimitedMercuryEdits
        | Feature::CustomMcpServers
        | Feature::CustomHooksAndRules
        | Feature::MarketplaceSkillsWrite
        | Feature::BranchingIterationTimeline
        | Feature::TestGenerator
        | Feature::CodeExplainer
        | Feature::EarlyAccessNewFeatures
        | Feature::BugFinderPro
        | Feature::FrontierModels
        | Feature::CloudAgents
        | Feature::FrontierBrain => matches!(
            tier,
            SubscriptionTier::Pro
                | SubscriptionTier::ProPlus
                | SubscriptionTier::Teams
                | SubscriptionTier::Enterprise,
        ),

        // ProPlus+ (ProPlus, Teams, Enterprise).
        Feature::FrontierPlusModels
        | Feature::ExtraCredits5x
        | Feature::PriorityClaudeOpus
        | Feature::CodebaseTrainedBrain
        | Feature::PrivateBrain
        | Feature::MultiAgentOrchestration
        | Feature::PersonalizedFineTuneAdapter
        | Feature::PersonalEriPalette
        | Feature::ExtendedContextWindow
        | Feature::PersonalAiMemory
        | Feature::PersonalizedBrain => matches!(
            tier,
            SubscriptionTier::ProPlus | SubscriptionTier::Teams | SubscriptionTier::Enterprise,
        ),

        // Teams+ (Teams, Enterprise).
        Feature::SharedTeamContext
        | Feature::TeamRulesAndSkills
        | Feature::SecurityReviewAgent
        | Feature::SsoSamlOidc
        | Feature::UsageAnalytics
        | Feature::CentralizedBilling
        | Feature::TeamPluginMarketplace
        | Feature::AiCodeTracking
        | Feature::TeamSharing
        | Feature::AuditLogs => matches!(
            tier,
            SubscriptionTier::Teams | SubscriptionTier::Enterprise,
        ),

        // Enterprise-only.
        Feature::PooledUsage
        | Feature::InvoiceBilling
        | Feature::ScimProvisioning
        | Feature::DedicatedCompute
        | Feature::IpAllowlisting
        | Feature::DedicatedAccountManager => matches!(tier, SubscriptionTier::Enterprise),
    }
}

#[derive(Debug, Error)]
pub enum BillingError {
    #[error("billing transport error: {0}")]
    Transport(String),
    #[error("unauthorized: access token rejected by billing API")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("network error: {0}")]
    Network(#[from] ureq::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Blocking HTTP client for the eri.dev billing endpoints. Cheap to clone
/// (`ureq::Agent` is `Arc`-backed internally). Construct once at app startup
/// and reuse — `new()` reads the `ERI_BILLING_API_BASE` env var, so creating
/// new clients per request would re-read it unnecessarily.
#[derive(Clone, Debug)]
pub struct BillingClient {
    api_base: String,
    http: ureq::Agent,
}

#[derive(Serialize)]
struct CheckoutRequest<'a> {
    plan: &'a str,
}

#[derive(Deserialize)]
struct CheckoutResponse {
    url: String,
}

#[derive(Deserialize)]
struct PortalResponse {
    url: String,
}

#[derive(Serialize)]
struct UsagePingRequest<'a> {
    tokens: u64,
    cost_usd: f64,
    model: &'a str,
}

impl BillingClient {
    pub fn new() -> Result<Self, BillingError> {
        let api_base = std::env::var(API_BASE_ENV)
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_API_BASE.to_string());
        Self::with_base(api_base)
    }

    pub fn with_base(api_base: impl Into<String>) -> Result<Self, BillingError> {
        let base = api_base.into();
        let trimmed = base.trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(BillingError::Transport("empty api_base".into()));
        }
        let http = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(30))
            .timeout_write(Duration::from_secs(30))
            .build();
        Ok(Self {
            api_base: trimmed,
            http,
        })
    }

    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    /// POST `/v1/billing/checkout` — returns a Stripe Checkout Session URL the
    /// caller should open in the user's browser.
    pub fn start_checkout(&self, access_token: &str, plan: Plan) -> Result<String, BillingError> {
        let url = format!("{}/v1/billing/checkout", self.api_base);
        let body = serde_json::to_string(&CheckoutRequest { plan: plan.slug() })?;
        let response = self
            .http
            .post(&url)
            .set("Authorization", &format!("Bearer {access_token}"))
            .set("Content-Type", "application/json")
            .send_string(&body);
        let parsed: CheckoutResponse = handle_response(response)?;
        Ok(parsed.url)
    }

    /// POST `/v1/billing/portal` — returns a Stripe Customer Portal URL the
    /// caller should open in the user's browser. Stripe makes these
    /// single-use, so we generate one per request.
    pub fn open_customer_portal(&self, access_token: &str) -> Result<String, BillingError> {
        let url = format!("{}/v1/billing/portal", self.api_base);
        let response = self
            .http
            .post(&url)
            .set("Authorization", &format!("Bearer {access_token}"))
            .set("Content-Type", "application/json")
            .send_string("{}");
        let parsed: PortalResponse = handle_response(response)?;
        Ok(parsed.url)
    }

    /// GET `/v1/billing/subscription` — current tier, status, period end.
    pub fn current_subscription(&self, access_token: &str) -> Result<Subscription, BillingError> {
        let url = format!("{}/v1/billing/subscription", self.api_base);
        let response = self
            .http
            .get(&url)
            .set("Authorization", &format!("Bearer {access_token}"))
            .call();
        handle_response(response)
    }

    /// POST `/v1/billing/usage` — record token + dollar usage for the
    /// just-completed inference call. Fire-and-forget from the caller's POV.
    pub fn ping_usage(
        &self,
        access_token: &str,
        tokens: u64,
        cost_usd: f64,
        model: &str,
    ) -> Result<(), BillingError> {
        let url = format!("{}/v1/billing/usage", self.api_base);
        let body = serde_json::to_string(&UsagePingRequest {
            tokens,
            cost_usd,
            model,
        })?;
        let response = self
            .http
            .post(&url)
            .set("Authorization", &format!("Bearer {access_token}"))
            .set("Content-Type", "application/json")
            .send_string(&body);
        let _value: serde_json::Value = handle_response(response)?;
        Ok(())
    }

    /// GET `/v1/billing/usage` — monthly rollup for the "Show usage" voice
    /// command and the settings panel.
    pub fn usage_summary(&self, access_token: &str) -> Result<UsageSummary, BillingError> {
        let url = format!("{}/v1/billing/usage", self.api_base);
        let response = self
            .http
            .get(&url)
            .set("Authorization", &format!("Bearer {access_token}"))
            .call();
        handle_response(response)
    }
}

fn handle_response<T: serde::de::DeserializeOwned>(
    response: Result<ureq::Response, ureq::Error>,
) -> Result<T, BillingError> {
    match response {
        Ok(resp) => {
            let body = resp
                .into_string()
                .map_err(|e| BillingError::Transport(e.to_string()))?;
            if body.trim().is_empty() {
                // Allow `()` and `serde_json::Value::Null` for endpoints that
                // return 204 / empty body.
                let null = serde_json::Value::Null;
                return Ok(serde_json::from_value(null)?);
            }
            Ok(serde_json::from_str(&body)?)
        }
        Err(ureq::Error::Status(401, _)) => Err(BillingError::Unauthorized),
        Err(ureq::Error::Status(404, _)) => Err(BillingError::NotFound),
        Err(err) => Err(BillingError::Network(err)),
    }
}
