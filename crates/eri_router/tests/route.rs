use eri_router::{IntentKind, Model, RouteRequest, route, route_for_sidecar};

fn request(prompt: &str) -> RouteRequest {
    RouteRequest {
        prompt: prompt.to_string(),
        ..Default::default()
    }
}

#[test]
fn voice_override_is_respected() {
    let req = RouteRequest {
        prompt: "fix the imports".into(),
        voice_override: Some(Model::Gpt5),
        ..Default::default()
    };
    let decision = route(&req);
    assert_eq!(decision.model, Model::Gpt5);
    assert!((decision.confidence - 1.0).abs() < f32::EPSILON);
}

#[test]
fn image_goes_to_gemini() {
    let req = RouteRequest {
        prompt: "look at this".into(),
        has_image: true,
        ..Default::default()
    };
    let decision = route(&req);
    assert_eq!(decision.model, Model::Gemini25Pro);
    assert_eq!(decision.intent, IntentKind::Multimodal);
}

#[test]
fn sixty_file_refactor_goes_to_gpt5_with_opus_fallback() {
    let req = RouteRequest {
        prompt: "refactor the payment pipeline across the monorepo".into(),
        file_count: 60,
        ..Default::default()
    };
    let decision = route(&req);
    assert_eq!(decision.model, Model::Gpt5);
    assert_eq!(decision.fallback, Some(Model::ClaudeOpus47));
}

#[test]
fn fix_the_imports_goes_to_sonnet() {
    let decision = route(&request("fix the imports in this file"));
    assert_eq!(decision.model, Model::ClaudeSonnet46);
    assert_eq!(decision.intent, IntentKind::Polish);
}

#[test]
fn coffee_shop_landing_goes_to_eri_engine() {
    let decision = route(&request("build a coffee-shop landing page hero section"));
    assert_eq!(decision.model, Model::EriEngine);
}

#[test]
fn redesign_auth_flow_goes_to_opus() {
    let decision = route(&request("redesign the auth flow to use passkeys"));
    assert_eq!(decision.model, Model::ClaudeOpus47);
    assert_eq!(decision.intent, IntentKind::DeepReasoning);
}

#[test]
fn long_context_without_keyword_still_picks_gpt5() {
    let req = RouteRequest {
        prompt: "summarize all the changes".into(),
        has_long_context: true,
        ..Default::default()
    };
    let decision = route(&req);
    assert_eq!(decision.model, Model::Gpt5);
}

#[test]
fn sidecar_helper_handles_voice_override_field() {
    let json = r#"{"prompt":"anything","voice_override":"gemini-2.5-pro"}"#;
    let value = route_for_sidecar(json);
    assert_eq!(value["model"], "gemini-2.5-pro");
}

#[test]
fn sidecar_helper_reports_bad_json() {
    let value = route_for_sidecar("not json");
    assert!(value.get("error").is_some());
}
