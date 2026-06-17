// Eri desktop — Tauri shell for the floating glass companion.
//
// WHY TAURI: eri's core is Rust, and Tauri hands us for free everything the old
// hand-rolled Swift/WKWebView shell fought us on — native window drag
// (`data-tauri-drag-region`), real transparency, content-protection, resize,
// auto-update, global shortcuts. The frontend (index.html / manager.css /
// manager.js) is reused verbatim; `ui/tauri-bridge.js` shims the old
// `window.webkit.messageHandlers.eri` API onto Tauri `invoke`, so manager.js
// runs unchanged.
//
// PHASE 1 (this file): the window done right + a CLI-streaming bridge so the
// brain works. PHASE 2 will replace the CLI spawn with in-process calls into
// eri's own crates (killing the "spawn + parse stdout" failure class).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// Warm brain: a single persistent `eri chat` process. Cold-start (config,
// persona, memory, agent build) is paid ONCE at launch; every question after is
// just a model round-trip — that's the Pluely-class latency, no per-turn spawn.
static CHAT_STDIN: Mutex<Option<ChildStdin>> = Mutex::new(None);
static CHAT_TURN: AtomicI64 = AtomicI64::new(0); // which UI turn the current reply belongs to
static CHAT_AWAITING: AtomicBool = AtomicBool::new(false); // are we mid-reply (vs idle/banner)?

// Control bridge env (endpoint + bearer) from the loopback actuation server.
// Without it, `eri control --live` can only DRY-RUN (simulate). With it, eri
// actually opens apps / clicks / types.
static CONTROL_ENV: Mutex<Option<(String, String)>> = Mutex::new(None);

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

/// Resolve the `eri` CLI. Prefer PATH; fall back to the repo release build.
fn eri_bin() -> String {
    "eri".to_string()
}

/// Default working dir for eri commands (mirrors the Swift shell's default).
fn default_cwd() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&home).join("eri-projects/default")
}

fn str_field<'a>(msg: &'a Value, key: &str) -> &'a str {
    msg.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

fn f64_field(msg: &Value, key: &str) -> Option<f64> {
    msg.get(key).and_then(|v| v.as_f64())
}

fn bool_field(msg: &Value, key: &str) -> bool {
    msg.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Decide whether the user is COMMANDING the computer (→ eri's control/actuation
/// path) vs ASKING a question (→ the conversational brain). eri is a do-things
/// companion, so an imperative like "open Spotify" must actuate, not get the
/// generic "I'm a text AI, I can't open apps" refusal. Heuristic, deliberately
/// conservative: questions and "write/explain/summarize" stay conversational.
fn is_actuation_command(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    if t.ends_with('?') {
        return false;
    }
    let first = t.split_whitespace().next().unwrap_or("");
    const ACTUATE: &[&str] = &[
        "open", "launch", "close", "quit", "click", "type", "play", "pause", "skip",
        "scroll", "switch", "go", "take", "press", "select", "copy", "paste", "mute",
        "unmute", "start", "stop", "turn", "navigate", "minimize", "maximize", "show",
        "hide", "screenshot", "record", "drag", "drop", "double-click",
    ];
    const ASK_LEAD: &[&str] = &[
        "what", "why", "how", "who", "when", "where", "which", "is", "are", "can",
        "could", "should", "would", "do", "does", "did", "explain", "tell", "summarize",
        "summarise", "write", "draft", "translate", "define", "describe",
    ];
    if ASK_LEAD.contains(&first) {
        return false;
    }
    ACTUATE.contains(&first)
}

/// Spawn an `eri` subcommand and stream stdout lines to the web layer as
/// `eri-stream` events, finishing with an `eri-result` event — the exact
/// contract manager.js's `eriStreamEvent` / `eriBridgeResult` expect.
fn spawn_stream(app: AppHandle, ui_command: String, args: Vec<String>, turn: i64) {
    std::thread::spawn(move || {
        let cwd = default_cwd();
        let _ = std::fs::create_dir_all(&cwd);
        let mut cmd = Command::new(eri_bin());
        cmd.args(&args).current_dir(&cwd).stdout(Stdio::piped()).stderr(Stdio::piped());
        // Hand control children the live actuation bridge so they don't dry-run.
        if let Ok(g) = CONTROL_ENV.lock() {
            if let Some((ep, tok)) = g.as_ref() {
                cmd.env("ERI_CONTROL_ENDPOINT", ep).env("ERI_CONTROL_TOKEN", tok);
            }
        }
        let child = cmd.spawn();

        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "eri-result",
                    json!({ "command": ui_command, "turn": turn, "status": "error", "detail": format!("could not start eri: {e}") }),
                );
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app.emit("eri-stream", json!({ "command": ui_command, "turn": turn, "line": line }));
            }
        }

        let status = child.wait();
        let ok = status.map(|s| s.success()).unwrap_or(false);
        let _ = app.emit(
            "eri-result",
            json!({ "command": ui_command, "turn": turn, "status": if ok { "done" } else { "error" }, "detail": "" }),
        );
    });
}

/// The single entry point the web layer calls (via the bridge shim). `message`
/// is the object manager.js sends: `{ command, mode, intent, ...payload }`.
#[tauri::command]
fn bridge(app: AppHandle, message: Value) -> Result<(), String> {
    let command = str_field(&message, "command").to_string();
    let window = app.get_webview_window("main");

    // Quick ack so the UI never hangs waiting on a result.
    let ack = |status: &str| {
        let _ = app.emit(
            "eri-result",
            json!({ "command": command, "status": status, "detail": "" }),
        );
    };

    match command.as_str() {
        // ---- window control (free with Tauri) ----
        "resizeWindow" => {
            if let Some(w) = window {
                let width = f64_field(&message, "width").unwrap_or(580.0);
                let height = f64_field(&message, "height").unwrap_or(64.0);
                // Floor at the bar height (56) so the resting card can be tight —
                // no empty glass strip below it.
                let _ = w.set_size(tauri::LogicalSize::new(width.max(360.0), height.max(56.0)));
            }
            ack("ok");
        }
        "setContentProtection" => {
            if let Some(w) = window {
                let _ = w.set_content_protected(bool_field(&message, "enabled"));
            }
            ack("ok");
        }
        "setAlwaysOnTop" => {
            if let Some(w) = window {
                let _ = w.set_always_on_top(bool_field(&message, "enabled"));
            }
            ack("ok");
        }
        // moveWindow is handled natively by data-tauri-drag-region; no-op here.
        "moveWindow" => ack("ok"),

        "quit" => {
            app.exit(0);
        }

        // ---- brain / CLI (streamed) ----
        // Route by intent: imperative commands actuate (control --live), questions
        // go to the conversational brain (ask). This is what stops eri from
        // refusing "open Spotify" like a generic chatbot. `--mode fast` keeps the
        // companion snappy (the heavy tier is for builds, not chat).
        "askEri" => {
            let turn = message.get("turn").and_then(|v| v.as_i64()).unwrap_or(0);
            let intent = str_field(&message, "intent").to_string();
            if is_actuation_command(&intent) {
                // `control` accepts --mode (fast tier keeps actuation snappy).
                spawn_stream(app, command.clone(), vec!["control".into(), "--live".into(), "--mode".into(), "fast".into(), intent], turn);
            } else if !ask_warm(&intent, turn) {
                // Warm brain down → cold fallback. `eri ask` takes only the prompt.
                spawn_stream(app, command.clone(), vec!["ask".into(), intent], turn);
            }
        }
        "research" => {
            let turn = message.get("turn").and_then(|v| v.as_i64()).unwrap_or(0);
            spawn_stream(app, command.clone(), vec!["research".into(), str_field(&message, "intent").into()], turn);
        }
        "runEri" | "spawnAgent" => {
            let turn = message.get("turn").and_then(|v| v.as_i64()).unwrap_or(0);
            spawn_stream(app, command.clone(), vec!["build".into(), str_field(&message, "intent").into()], turn);
        }

        // ---- everything else: ack so the UI proceeds (wired in Phase 2/3) ----
        _ => ack("ok"),
    }

    Ok(())
}

/// Find the loopback actuation server binary (built by the eri app build).
fn control_server_path() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("ERI_CONTROL_SERVER") {
        let pb = std::path::PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    let repo = std::path::PathBuf::from("/Users/khai/Desktop/eri/target/eri_control_server");
    if repo.exists() {
        return Some(repo);
    }
    None
}

/// Spawn the loopback control server and capture its endpoint + bearer so
/// `eri control --live` can ACTUALLY actuate (open apps, click, type) instead of
/// dry-running. Without this, control only simulates.
fn start_control_server() {
    let path = match control_server_path() {
        Some(p) => p,
        None => {
            eprintln!("[eri] control server binary not found — actuation will dry-run");
            return;
        }
    };
    std::thread::spawn(move || {
        let mut child = match Command::new(&path).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[eri] control server failed to start: {e}");
                return;
            }
        };
        if let Some(out) = child.stdout.take() {
            let reader = BufReader::new(out);
            let (mut ep, mut tok) = (None::<String>, None::<String>);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(v) = line.strip_prefix("ERI_CONTROL_ENDPOINT=") {
                    ep = Some(v.to_string());
                }
                if let Some(v) = line.strip_prefix("ERI_CONTROL_TOKEN=") {
                    tok = Some(v.to_string());
                }
                if let (Some(e), Some(t)) = (&ep, &tok) {
                    if let Ok(mut g) = CONTROL_ENV.lock() {
                        *g = Some((e.clone(), t.clone()));
                    }
                    eprintln!("[eri] control bridge ready — actuation live");
                    ep = None;
                    tok = None;
                }
            }
        }
        let _ = child.wait();
    });
}

/// Spawn the single persistent `eri chat` process and stream its replies. The
/// reader thread tags each reply with the UI turn that asked, and detects
/// end-of-turn from the REPL's "turn done" marker. Banner/idle output is skipped.
fn start_chat_brain(app: AppHandle) {
    let cwd = default_cwd();
    let _ = std::fs::create_dir_all(&cwd);
    let mut child = match Command::new(eri_bin())
        .args(["chat", "--mode", "fast"])
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[eri] warm chat brain failed to start: {e} (falling back to per-turn spawn)");
            return;
        }
    };

    if let Some(stdin) = child.stdin.take() {
        if let Ok(mut g) = CHAT_STDIN.lock() {
            *g = Some(stdin);
        }
    }

    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for raw in reader.lines().map_while(Result::ok) {
                if !CHAT_AWAITING.load(Ordering::SeqCst) {
                    continue; // startup banner / idle prompt between turns
                }
                let turn = CHAT_TURN.load(Ordering::SeqCst);
                // Strip the REPL prompt prefix so the reply reads clean.
                let line = raw.strip_prefix("eri chat> ").unwrap_or(&raw).to_string();

                // End of this turn.
                if line.contains("[eri] turn done") || (line.contains("session ") && line.contains("saved")) {
                    CHAT_AWAITING.store(false, Ordering::SeqCst);
                    let _ = app.emit("eri-result", json!({ "command": "askEri", "turn": turn, "status": "done", "detail": "" }));
                    continue;
                }
                if line.trim().is_empty() {
                    continue;
                }
                let _ = app.emit("eri-stream", json!({ "command": "askEri", "turn": turn, "line": line }));
            }
            // chat exited — clear the handle so asks fall back to a cold spawn.
            if let Ok(mut g) = CHAT_STDIN.lock() {
                *g = None;
            }
        });
    }

    // Keep the process alive for the app's lifetime (stdin stays open in the
    // static). The OS reaps it on app exit.
    std::mem::forget(child);
}

/// Send a question to the warm brain. Returns false if it isn't running (caller
/// then falls back to a cold `eri ask` spawn).
fn ask_warm(intent: &str, turn: i64) -> bool {
    if let Ok(mut g) = CHAT_STDIN.lock() {
        if let Some(stdin) = g.as_mut() {
            CHAT_TURN.store(turn, Ordering::SeqCst);
            CHAT_AWAITING.store(true, Ordering::SeqCst);
            if writeln!(stdin, "{intent}").and_then(|_| stdin.flush()).is_ok() {
                return true;
            }
            CHAT_AWAITING.store(false, Ordering::SeqCst);
        }
    }
    false
}

fn apply_glass(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        // Real macOS glass — the HUD material is the dark, strongly-blurred
        // translucent surface (the Cluely/Pluely look), with rounded corners.
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::Active),
            Some(14.0),
        );
    }
    let _ = window;
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                apply_glass(&window);
            }
            // Warm the brain + bring up the actuation bridge at launch.
            start_control_server();
            start_chat_brain(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bridge])
        .run(tauri::generate_context!())
        .expect("error while running eri desktop");
}
