use std::path::PathBuf;

use eri_settings::{EriSettings, SettingsError, validate_voice_sensitivity};

fn temp_path(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("eri_settings_test_{pid}_{nanos}_{name}"));
    path
}

#[test]
fn default_settings_serialize_to_toml_then_back_roundtrips() {
    let defaults = EriSettings::default();
    let serialized = toml::to_string_pretty(&defaults).expect("serialize defaults");
    let parsed: EriSettings = toml::from_str(&serialized).expect("parse defaults");
    assert_eq!(defaults, parsed);

    // Spot-check a few fields are present and human-readable.
    assert!(serialized.contains("[voice]"));
    assert!(serialized.contains("sensitivity ="));
    assert!(serialized.contains("[mercury]"));
    assert!(serialized.contains("[telemetry]"));
    assert!(serialized.contains("language = \"en\""));
}

#[test]
fn load_from_missing_file_returns_defaults() {
    let path = temp_path("missing.toml");
    assert!(!path.exists());
    let loaded = EriSettings::load_from(&path).expect("load missing file");
    assert_eq!(loaded, EriSettings::default());
}

#[test]
fn save_creates_parent_dir() {
    let base = temp_path("with_parent");
    let path = base.join("nested").join("a").join("settings.toml");
    assert!(!path.exists());
    let settings = EriSettings::default();
    settings.save_to(&path).expect("save creates parents");
    assert!(path.exists(), "settings file should be written");

    let reloaded = EriSettings::load_from(&path).expect("reload after save");
    assert_eq!(reloaded, settings);

    // Best-effort cleanup; ignore errors.
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn partial_toml_fills_missing_with_defaults() {
    let path = temp_path("partial.toml");
    let partial = r#"
[voice]
sensitivity = 0.123

[mercury]
temperature = 1.25
"#;
    std::fs::write(&path, partial).expect("write partial");

    let loaded = EriSettings::load_from(&path).expect("load partial");

    assert!((loaded.voice.sensitivity - 0.123).abs() < f32::EPSILON);
    assert_eq!(loaded.voice.final_silence_ms, 400);
    assert_eq!(loaded.voice.language, "en");

    assert!((loaded.mercury.temperature - 1.25).abs() < f32::EPSILON);
    assert_eq!(loaded.mercury.model, "mercury-2");
    assert_eq!(loaded.mercury.max_tokens, 16384);

    assert_eq!(loaded.tts, eri_settings::TtsSettings::default());
    assert_eq!(loaded.ui, eri_settings::UiSettings::default());

    let _ = std::fs::remove_file(&path);
}

#[test]
fn load_invalid_toml_returns_parse_error() {
    let path = temp_path("invalid.toml");
    std::fs::write(&path, "this is = not valid = toml = =\n[[[").expect("write invalid");

    let err = EriSettings::load_from(&path).expect_err("should fail to parse");
    assert!(matches!(err, SettingsError::Parse(_)), "got: {err:?}");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn voice_sensitivity_validates_within_range_0_to_1() {
    assert!(validate_voice_sensitivity(0.0).is_ok());
    assert!(validate_voice_sensitivity(0.5).is_ok());
    assert!(validate_voice_sensitivity(1.0).is_ok());

    assert!(matches!(
        validate_voice_sensitivity(-0.01),
        Err(SettingsError::Invalid(_))
    ));
    assert!(matches!(
        validate_voice_sensitivity(1.01),
        Err(SettingsError::Invalid(_))
    ));
    assert!(matches!(
        validate_voice_sensitivity(f32::NAN),
        Err(SettingsError::Invalid(_))
    ));

    let mut settings = EriSettings::default();
    settings.voice.sensitivity = 2.0;
    let err = settings.validate().expect_err("should reject out-of-range");
    assert!(matches!(err, SettingsError::Invalid(_)));
}
