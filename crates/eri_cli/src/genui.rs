//! Eri GenUI artifacts: a compact component contract for streamed UI.

use anyhow::Result;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum GenUiOutputMode {
    Text,
    ArtifactJson,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenUiArtifact<'a> {
    kind: &'static str,
    intent: &'a str,
    language: &'static str,
    components: &'static [&'static str],
    system_prompt: String,
    example: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopLaunchIntent<'a> {
    intent: &'a str,
    source: &'static str,
    phase: &'static str,
    open_builder: bool,
    created_at_ms: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DesktopLaunchRequest {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
}

const ERI_WORKBENCH_LAUNCH_FILE_ENV: &str = "ERI_WORKBENCH_LAUNCH_FILE";
const ERI_AGENT_MANAGER_BIN_ENV: &str = "ERI_AGENT_MANAGER_BIN";

const COMPONENTS: &[&str] = &[
    "Screen(title, sections)",
    "Stack(children, gap)",
    "Grid(children, columns)",
    "Card(title, body, actions)",
    "Stat(label, value, delta)",
    "Table(columns, rows)",
    "Chart(kind, data, label)",
    "Form(title, fields, submit)",
    "Action(label, intent, style)",
    "Timeline(items)",
    "ReviewFinding(severity, title, file, detail)",
    "PreviewFrame(url, checks)",
];

const EXAMPLE: &str = r#"root = Screen("Usage dashboard", [hero, stats, actions])
hero = Card("Current plan", "Pro workspace, 82% credits remaining", [upgrade])
stats = Grid([s1, s2, s3], 3)
s1 = Stat("Credits", "18,420", "down")
s2 = Stat("Checks passed", "42", "up")
s3 = Stat("Open risks", "3", "flat")
upgrade = Action("Review billing", "open_billing", "primary")"#;

pub fn system_prompt(intent: &str) -> String {
    format!(
        "You are Eri generating a streamed UI artifact.\n\
         Emit only Eri GenUI statements, one statement per line.\n\
         The first statement must assign root.\n\
         Use only these components:\n{}\n\
         Prefer top-down layout: Screen, sections, components, data.\n\
         Do not expose internal engine, provider, or route names.\n\
         User intent: {}",
        COMPONENTS
            .iter()
            .map(|component| format!("- {component}"))
            .collect::<Vec<_>>()
            .join("\n"),
        intent.trim()
    )
}

pub fn run_with_open(prompt: &str, output: GenUiOutputMode, open: bool) -> Result<()> {
    let intent = prompt.trim();
    if intent.is_empty() {
        anyhow::bail!("ui needs a prompt");
    }

    let artifact = GenUiArtifact {
        kind: "eri.genui.prompt",
        intent,
        language: "eri-genui-v1",
        components: COMPONENTS,
        system_prompt: system_prompt(intent),
        example: EXAMPLE,
    };

    if open && output == GenUiOutputMode::Text {
        println!("Eri visual builder");
        println!("intent: {intent}");
        println!("opening desktop workbench...");
    } else {
        match output {
            GenUiOutputMode::Text => {
                println!("Eri GenUI prompt");
                println!();
                println!("{}", artifact.system_prompt);
                println!();
                println!("Example:");
                println!("{}", artifact.example);
            }
            GenUiOutputMode::ArtifactJson => {
                println!("{}", serde_json::to_string_pretty(&artifact)?);
            }
        }
    }

    if open {
        launch_desktop(intent)?;
    }

    Ok(())
}

fn launch_desktop(intent: &str) -> Result<()> {
    write_desktop_launch_intent(intent)?;
    let request = desktop_launch_request(intent)?;
    if request.program == "open" {
        if let Some(app_path) = request.args.iter().find(|arg| arg.ends_with(".app")) {
            if !Path::new(app_path).exists() {
                anyhow::bail!(
                    "Eri Agent Manager is not built at {app_path}. Run scripts/build_eri_agent_manager.sh"
                );
            }
        }
    } else if Path::new(&request.program).is_absolute() && !Path::new(&request.program).exists() {
        anyhow::bail!(
            "Eri Agent Manager is not built at {}. Run scripts/build_eri_agent_manager.sh",
            request.program
        );
    }
    Command::new(&request.program)
        .args(&request.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    eprintln!("opened Eri Agent Manager with UI intent");
    Ok(())
}

fn write_desktop_launch_intent(intent: &str) -> Result<()> {
    let path = desktop_launch_intent_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let created_at_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let payload = DesktopLaunchIntent {
        intent: intent.trim(),
        source: "cli",
        phase: "planning",
        open_builder: true,
        created_at_ms,
    };
    fs::write(path, serde_json::to_vec_pretty(&payload)?)?;
    Ok(())
}

fn desktop_launch_intent_file_path() -> Result<PathBuf> {
    if let Ok(path) = std::env::var(ERI_WORKBENCH_LAUNCH_FILE_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    if std::env::consts::OS != "macos" {
        anyhow::bail!("desktop launch intent handoff is currently supported on macOS");
    }
    let home = std::env::var("HOME")?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("eri")
        .join("Workbench")
        .join("launch-intent.json"))
}

pub(crate) fn desktop_launch_request(intent: &str) -> Result<DesktopLaunchRequest> {
    if std::env::consts::OS != "macos" {
        anyhow::bail!("eri ui --open is currently supported on macOS");
    }
    let manager_path = resolve_eri_agent_manager_path()?;
    let workspace = std::env::current_dir()?;
    Ok(DesktopLaunchRequest {
        program: "open".to_string(),
        args: vec![
            "-n".to_string(),
            manager_path.display().to_string(),
            "--args".to_string(),
            "--intent".to_string(),
            intent.trim().to_string(),
            "--workspace".to_string(),
            workspace.display().to_string(),
        ],
    })
}

fn resolve_eri_agent_manager_path() -> Result<PathBuf> {
    if let Ok(path) = std::env::var(ERI_AGENT_MANAGER_BIN_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    if let Ok(resources) = std::env::var("ERI_RESOURCES") {
        let bundled = PathBuf::from(resources).join("Eri Agent Manager.app");
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    let cwd = std::env::current_dir()?;
    for ancestor in cwd.ancestors() {
        let manager = ancestor.join("apps").join("Eri Agent Manager.app");
        let source = ancestor.join("scripts").join("eri_agent_manager.swift");
        if manager.exists() || source.exists() {
            return Ok(manager);
        }
    }
    anyhow::bail!(
        "Eri Agent Manager assets were not found. Run from an Eri checkout or set {ERI_AGENT_MANAGER_BIN_ENV}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompt_contains_component_contract() {
        let prompt = system_prompt("make a review dashboard");
        assert!(prompt.contains("Screen(title, sections)"));
        assert!(prompt.contains("ReviewFinding(severity, title, file, detail)"));
        assert!(prompt.contains("User intent: make a review dashboard"));
    }

    #[test]
    fn system_prompt_hides_provider_names() {
        let prompt = system_prompt("make a billing dashboard");
        for forbidden in ["Mercury", "OpenAI", "Anthropic", "Claude", "Gemini"] {
            assert!(
                !prompt.contains(forbidden),
                "GenUI prompt exposes forbidden name: {forbidden}"
            );
        }
    }

    #[test]
    fn desktop_launch_request_points_at_standalone_agent_manager_app() {
        let request = desktop_launch_request("make a checkout flow").unwrap();
        assert_eq!(request.program, "open");
        assert!(request.args.contains(&"-n".to_string()));
        assert!(
            request
                .args
                .iter()
                .any(|arg| arg.ends_with("apps/Eri Agent Manager.app"))
        );
        assert!(request.args.contains(&"--args".to_string()));
        assert!(request.args.contains(&"--intent".to_string()));
        assert!(request.args.contains(&"make a checkout flow".to_string()));
        assert!(request.args.contains(&"--workspace".to_string()));
        assert!(
            !request
                .args
                .iter()
                .any(|arg| arg.contains("VSCode-darwin-arm64"))
        );
    }
}
