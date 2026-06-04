use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to parse settings TOML: {0}")]
    Parse(#[from] toml::de::Error),
    #[error("failed to serialize settings TOML: {0}")]
    Serialize(#[from] toml::ser::Error),
    #[error("unable to determine home directory")]
    NoHome,
    #[error("invalid setting value: {0}")]
    Invalid(String),
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EriSettings {
    pub voice: VoiceSettings,
    pub tts: TtsSettings,
    pub brain: BrainSettings,
    pub mercury: MercurySettings,
    pub agent: AgentSettings,
    pub cost: CostSettings,
    pub ui: UiSettings,
    pub telemetry: TelemetrySettings,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct VoiceSettings {
    pub sensitivity: f32,
    pub final_silence_ms: u32,
    pub partial_interval_ms: u32,
    pub language: String,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            sensitivity: 0.005,
            final_silence_ms: 400,
            partial_interval_ms: 300,
            language: "en".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TtsSettings {
    /// Canonical voice NAME for eri's spoken replies. The production voice is
    /// `eri_prod_voice` -- pinned here so the name is the source of truth and
    /// `voice_id` is just its current ElevenLabs binding.
    pub voice_name: String,
    /// ElevenLabs voice id bound to `voice_name` (= `eri_prod_voice`).
    pub voice_id: String,
    pub model: String,
    pub format: String,
}

impl Default for TtsSettings {
    fn default() -> Self {
        Self {
            voice_name: "eri_prod_voice".to_string(),
            voice_id: "gJx1vCzNCD1EQHT212Ls".to_string(),
            model: "eleven_multilingual_v2".to_string(),
            format: "mp3_44100_128".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BrainSettings {
    pub backend: String,
    pub model: String,
}

impl Default for BrainSettings {
    fn default() -> Self {
        Self {
            backend: "mlx".to_string(),
            model: "Llama-3.2-1B-Instruct-4bit".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MercurySettings {
    pub model: String,
    pub edit_model: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub reasoning_effort: String,
    pub diffusing: bool,
}

impl Default for MercurySettings {
    fn default() -> Self {
        Self {
            model: "mercury-2".to_string(),
            edit_model: "mercury-edit-2".to_string(),
            max_tokens: 16384,
            temperature: 0.85,
            reasoning_effort: "medium".to_string(),
            diffusing: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AgentSettings {
    pub backend: String,
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            backend: "claude".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CostSettings {
    pub session_limit_usd: f32,
    pub per_request_limit_usd: f32,
}

impl Default for CostSettings {
    fn default() -> Self {
        Self {
            session_limit_usd: 1.00,
            per_request_limit_usd: 0.10,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct UiSettings {
    pub dock_position: String,
    pub zoomed_default: bool,
    pub font_display: String,
    pub font_body: String,
    pub font_mono: String,
    pub theme: String,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            dock_position: "right".to_string(),
            zoomed_default: true,
            font_display: "Fraunces".to_string(),
            font_body: "Space Grotesk".to_string(),
            font_mono: "JetBrains Mono".to_string(),
            theme: "cursor_notion_dark".to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TelemetrySettings {
    pub sentry: bool,
    pub posthog: bool,
}

impl EriSettings {
    /// Resolve `~/.eri/settings.toml`. Returns `NoHome` when the OS reports no
    /// home directory (rare; happens in some sandboxes / minimal envs).
    pub fn default_path() -> Result<PathBuf, SettingsError> {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or(SettingsError::NoHome)?;
        Ok(home.join(".eri").join("settings.toml"))
    }

    /// Load from `~/.eri/settings.toml`. Returns defaults if the file is missing.
    pub fn load() -> Result<Self, SettingsError> {
        let path = Self::default_path()?;
        Self::load_from(&path)
    }

    /// Load from an explicit path. Missing files yield defaults; partial files
    /// are merged with defaults via `#[serde(default)]` on each field group.
    pub fn load_from(path: &Path) -> Result<Self, SettingsError> {
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                let parsed: Self = toml::from_str(&contents)?;
                parsed.validate()?;
                Ok(parsed)
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(err) => Err(SettingsError::Io(err)),
        }
    }

    /// Save to `~/.eri/settings.toml`, creating parent directories as needed.
    pub fn save(&self) -> Result<(), SettingsError> {
        let path = Self::default_path()?;
        self.save_to(&path)
    }

    /// Save to an explicit path. Creates the parent directory if missing.
    pub fn save_to(&self, path: &Path) -> Result<(), SettingsError> {
        self.validate()?;
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let serialized = toml::to_string_pretty(self)?;
        std::fs::write(path, serialized)?;
        Ok(())
    }

    /// Validate cross-field invariants. Each sub-struct may also encode its own
    /// range checks here.
    pub fn validate(&self) -> Result<(), SettingsError> {
        validate_voice_sensitivity(self.voice.sensitivity)?;
        if self.mercury.temperature < 0.0 || self.mercury.temperature > 2.0 {
            return Err(SettingsError::Invalid(format!(
                "mercury.temperature must be within [0.0, 2.0], got {}",
                self.mercury.temperature
            )));
        }
        Ok(())
    }
}

/// Public so tests and callers can validate without constructing an `EriSettings`.
pub fn validate_voice_sensitivity(value: f32) -> Result<(), SettingsError> {
    if !(0.0..=1.0).contains(&value) || value.is_nan() {
        return Err(SettingsError::Invalid(format!(
            "voice.sensitivity must be within [0.0, 1.0], got {value}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tts_tests {
    use super::TtsSettings;

    #[test]
    fn default_voice_is_eri_prod_voice() {
        let tts = TtsSettings::default();
        assert_eq!(tts.voice_name, "eri_prod_voice");
        assert_eq!(tts.voice_id, "gJx1vCzNCD1EQHT212Ls");
    }

    #[test]
    fn legacy_tts_toml_without_voice_name_still_parses() {
        // Settings files written before voice_name existed must still load,
        // defaulting the name to eri_prod_voice.
        let toml = "voice_id = \"gJx1vCzNCD1EQHT212Ls\"\n\
                    model = \"eleven_multilingual_v2\"\n\
                    format = \"mp3_44100_128\"\n";
        let tts: TtsSettings = toml::from_str(toml).expect("legacy tts parses");
        assert_eq!(tts.voice_name, "eri_prod_voice");
    }
}
