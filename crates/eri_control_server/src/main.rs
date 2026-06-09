//! `eri_control_server` — the local eyes+hands bridge.
//!
//! A tiny loopback HTTP server the macOS app (or `eri control --live`) spawns.
//! It is the ONLY process that actually touches the screen and input devices:
//! it captures pixels, reads the frontmost app, and posts mouse/keyboard events
//! via CGEvent. The agent loop (in `eri_cli`) plans actions and POSTs them here;
//! this server does the OS-level work and replies.
//!
//! Protocol (one POST endpoint, bearer-token auth). Request `{"kind": ...}`:
//!   snapshot        -> {"screen": {app, window, elements: []}}
//!   capture         -> {"image": "<base64 png>", "format": "png"}
//!   click {x,y}     -> {"result": "..."}      (element-by-name is a later add)
//!   type  {text}    -> {"result": "..."}
//!   key   {combo}   -> {"result": "..."}      e.g. "cmd+t", "enter", "shift+tab"
//!   open_app {name} -> {"result": "..."}
//!   quit_app {name} -> {"result": "..."}
//!   wait  {ms}      -> {"result": "..."}
//! Any failure -> {"error": "..."}.
//!
//! On startup it prints two lines to stdout (the app reads them):
//!   ERI_CONTROL_ENDPOINT=http://127.0.0.1:<port>
//!   ERI_CONTROL_TOKEN=<token>

use std::io::Write;

use anyhow::{Context, Result};
use serde_json::{json, Value};

fn main() {
    if let Err(e) = run() {
        eprintln!("eri_control_server: fatal: {e:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    // arg[1] = port (0 = ephemeral, the app's default).
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let server = tiny_http::Server::http(("127.0.0.1", port))
        .map_err(|e| anyhow::anyhow!("bind 127.0.0.1:{port}: {e}"))?;
    let bound = server
        .server_addr()
        .to_ip()
        .context("server has no IP address")?;
    let token = random_token();

    // Handshake the app parses from stdout. Flush so it's delivered immediately.
    let mut out = std::io::stdout();
    writeln!(out, "ERI_CONTROL_ENDPOINT=http://127.0.0.1:{}", bound.port())?;
    writeln!(out, "ERI_CONTROL_TOKEN={token}")?;
    out.flush()?;

    for mut request in server.incoming_requests() {
        // Bearer-token gate: this endpoint can drive the whole machine, so any
        // other local process must present the per-launch token.
        if !authorized(&request, &token) {
            let _ = request.respond(json_response(&json!({ "error": "unauthorized" })));
            continue;
        }
        let mut body = String::new();
        if request.as_reader().read_to_string(&mut body).is_err() {
            let _ = request.respond(json_response(&json!({ "error": "unreadable body" })));
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&body) {
            Ok(req) => handle(&req),
            Err(e) => json!({ "error": format!("invalid JSON: {e}") }),
        };
        let _ = request.respond(json_response(&reply));
    }
    Ok(())
}

fn authorized(request: &tiny_http::Request, token: &str) -> bool {
    request.headers().iter().any(|h| {
        h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {token}")
    })
}

fn json_response(v: &Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let body = v.to_string();
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header");
    tiny_http::Response::from_string(body).with_header(header)
}

/// Dispatch one request to the actuation layer. Always returns a JSON value
/// (either `{result|screen|image}` or `{error}`) — never panics on bad input.
fn handle(req: &Value) -> Value {
    let kind = req.get("kind").and_then(Value::as_str).unwrap_or("");
    let result: Result<Value> = match kind {
        "snapshot" => platform::snapshot(),
        "capture" => platform::capture(),
        "click" => {
            if let Some(el) = req.get("element").and_then(Value::as_str) {
                Err(anyhow::anyhow!(
                    "click-by-element ({el}) needs the AX tree, not yet implemented — use x,y coordinates from the captured frame"
                ))
            } else {
                let x = req.get("x").and_then(Value::as_f64);
                let y = req.get("y").and_then(Value::as_f64);
                match (x, y) {
                    (Some(x), Some(y)) => {
                        platform::click_at(x, y).map(|_| json!({ "result": format!("clicked at ({x:.0}, {y:.0})") }))
                    }
                    _ => Err(anyhow::anyhow!("click needs `element` or `x`+`y`")),
                }
            }
        }
        "type" => match req.get("text").and_then(Value::as_str) {
            Some(text) => platform::type_text(text).map(|_| json!({ "result": format!("typed {text:?}") })),
            None => Err(anyhow::anyhow!("type needs `text`")),
        },
        "key" => match req.get("combo").and_then(Value::as_str) {
            Some(combo) => platform::key_combo(combo).map(|_| json!({ "result": format!("pressed {combo}") })),
            None => Err(anyhow::anyhow!("key needs `combo`")),
        },
        "open_app" => match req.get("name").and_then(Value::as_str) {
            Some(name) => platform::open_app(name).map(|_| json!({ "result": format!("opened {name}") })),
            None => Err(anyhow::anyhow!("open_app needs `name`")),
        },
        "quit_app" => match req.get("name").and_then(Value::as_str) {
            Some(name) => platform::quit_app(name).map(|_| json!({ "result": format!("quit {name}") })),
            None => Err(anyhow::anyhow!("quit_app needs `name`")),
        },
        "wait" => {
            let ms = req.get("ms").and_then(Value::as_u64).unwrap_or(0).min(10_000);
            std::thread::sleep(std::time::Duration::from_millis(ms));
            Ok(json!({ "result": format!("waited {ms}ms") }))
        }
        other => Err(anyhow::anyhow!("unknown action kind: {other:?}")),
    };
    match result {
        Ok(v) => v,
        Err(e) => json!({ "error": format!("{e}") }),
    }
}

fn random_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| format!("{:x}", rng.gen_range(0u8..16)))
        .collect()
}

// ─────────────────────────── platform layer ───────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use std::process::Command;

    use anyhow::{Context, Result};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton,
    };
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;
    use serde_json::{json, Value};

    fn source() -> Result<CGEventSource> {
        CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| anyhow::anyhow!("CGEventSource::new failed (grant Accessibility permission)"))
    }

    /// Frontmost app + window title via AppleScript. Elements are empty in v1 —
    /// the agent uses the captured frame (vision) to locate targets and clicks
    /// by coordinate. AX element enumeration is the next enhancement.
    pub fn snapshot() -> Result<Value> {
        let app = osascript(
            r#"tell application "System Events" to get name of first application process whose frontmost is true"#,
        )
        .unwrap_or_default();
        let window = osascript(
            r#"tell application "System Events" to tell (first application process whose frontmost is true) to if (count of windows) > 0 then get title of front window"#,
        )
        .unwrap_or_default();
        Ok(json!({
            "screen": { "app": app.trim(), "window": window.trim(), "elements": [] }
        }))
    }

    /// Screenshot the main display as PNG, base64-encoded. Uses the system
    /// `screencapture` (needs Screen Recording permission). `-x` = no sound.
    pub fn capture() -> Result<Value> {
        let tmp = std::env::temp_dir().join(format!("eri_shot_{}.png", std::process::id()));
        let status = Command::new("/usr/sbin/screencapture")
            .args(["-x", "-t", "png"])
            .arg(&tmp)
            .status()
            .context("spawn screencapture")?;
        if !status.success() {
            anyhow::bail!("screencapture failed (grant Screen Recording permission)");
        }
        let bytes = std::fs::read(&tmp).context("read screenshot")?;
        let _ = std::fs::remove_file(&tmp);
        if bytes.is_empty() {
            anyhow::bail!("screenshot was empty (Screen Recording permission?)");
        }
        Ok(json!({ "image": STANDARD.encode(&bytes), "format": "png" }))
    }

    pub fn click_at(x: f64, y: f64) -> Result<()> {
        let src = source()?;
        let point = CGPoint::new(x, y);
        post_mouse(&src, CGEventType::MouseMoved, point)?;
        post_mouse(&src, CGEventType::LeftMouseDown, point)?;
        post_mouse(&src, CGEventType::LeftMouseUp, point)?;
        Ok(())
    }

    fn post_mouse(src: &CGEventSource, ty: CGEventType, point: CGPoint) -> Result<()> {
        let ev = CGEvent::new_mouse_event(src.clone(), ty, point, CGMouseButton::Left)
            .map_err(|_| anyhow::anyhow!("build mouse event"))?;
        ev.post(CGEventTapLocation::HID);
        Ok(())
    }

    /// Type a literal string by posting it as a unicode keyboard event.
    pub fn type_text(text: &str) -> Result<()> {
        let src = source()?;
        let down = CGEvent::new_keyboard_event(src.clone(), 0, true)
            .map_err(|_| anyhow::anyhow!("build keyboard event"))?;
        down.set_string(text);
        down.post(CGEventTapLocation::HID);
        let up = CGEvent::new_keyboard_event(src, 0, false)
            .map_err(|_| anyhow::anyhow!("build keyboard event"))?;
        up.set_string(text);
        up.post(CGEventTapLocation::HID);
        Ok(())
    }

    /// Press a key combo like "cmd+t", "enter", "shift+tab", "esc".
    pub fn key_combo(combo: &str) -> Result<()> {
        let mut flags = CGEventFlags::CGEventFlagNonCoalesced;
        let mut keycode: Option<u16> = None;
        for part in combo.split('+').map(str::trim).filter(|p| !p.is_empty()) {
            match part.to_lowercase().as_str() {
                "cmd" | "command" | "meta" | "super" => flags |= CGEventFlags::CGEventFlagCommand,
                "shift" => flags |= CGEventFlags::CGEventFlagShift,
                "ctrl" | "control" => flags |= CGEventFlags::CGEventFlagControl,
                "alt" | "option" | "opt" => flags |= CGEventFlags::CGEventFlagAlternate,
                other => keycode = keycode_for(other),
            }
        }
        let keycode = keycode.ok_or_else(|| anyhow::anyhow!("no key in combo {combo:?}"))?;
        let src = source()?;
        let down = CGEvent::new_keyboard_event(src.clone(), keycode, true)
            .map_err(|_| anyhow::anyhow!("build keyboard event"))?;
        down.set_flags(flags);
        down.post(CGEventTapLocation::HID);
        let up = CGEvent::new_keyboard_event(src, keycode, false)
            .map_err(|_| anyhow::anyhow!("build keyboard event"))?;
        up.set_flags(flags);
        up.post(CGEventTapLocation::HID);
        Ok(())
    }

    pub fn open_app(name: &str) -> Result<()> {
        validate_app_name(name)?;
        let status = Command::new("/usr/bin/open")
            .args(["-a", name])
            .status()
            .context("spawn open")?;
        if !status.success() {
            anyhow::bail!("could not open {name:?}");
        }
        Ok(())
    }

    pub fn quit_app(name: &str) -> Result<()> {
        validate_app_name(name)?;
        // Pass `name` as an AppleScript argv parameter, NOT interpolated into the
        // script source — so a crafted app name can't inject AppleScript.
        let out = Command::new("/usr/bin/osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "tell application (item 1 of argv) to quit",
                "-e",
                "end run",
                "--",
                name,
            ])
            .output()
            .context("spawn osascript")?;
        if !out.status.success() {
            anyhow::bail!("quit {name:?}: {}", String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(())
    }

    /// App names come from the model over the loopback bridge; keep them to a
    /// conservative charset so they can't smuggle quotes/newlines/escapes into
    /// `open`/`osascript`. Real macOS app names fit easily inside this.
    fn validate_app_name(name: &str) -> Result<()> {
        let ok = !name.is_empty()
            && name.len() <= 64
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'));
        if !ok {
            anyhow::bail!("invalid app name: {name:?}");
        }
        Ok(())
    }

    fn osascript(script: &str) -> Result<String> {
        let out = Command::new("/usr/bin/osascript")
            .args(["-e", script])
            .output()
            .context("spawn osascript")?;
        if !out.status.success() {
            anyhow::bail!(
                "osascript: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// ANSI keycodes for common keys. Returns `None` for anything unmapped.
    fn keycode_for(key: &str) -> Option<u16> {
        let code = match key {
            "a" => 0, "s" => 1, "d" => 2, "f" => 3, "h" => 4, "g" => 5, "z" => 6, "x" => 7,
            "c" => 8, "v" => 9, "b" => 11, "q" => 12, "w" => 13, "e" => 14, "r" => 15,
            "y" => 16, "t" => 17, "1" => 18, "2" => 19, "3" => 20, "4" => 21, "6" => 22,
            "5" => 23, "9" => 25, "7" => 26, "8" => 28, "0" => 29, "o" => 31, "u" => 32,
            "i" => 34, "p" => 35, "l" => 37, "j" => 38, "k" => 40, "n" => 45, "m" => 46,
            "return" | "enter" => 36,
            "tab" => 48,
            "space" => 49,
            "delete" | "backspace" => 51,
            "escape" | "esc" => 53,
            "left" => 123,
            "right" => 124,
            "down" => 125,
            "up" => 126,
            _ => return None,
        };
        Some(code)
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use anyhow::Result;
    use serde_json::Value;

    fn unsupported() -> anyhow::Error {
        anyhow::anyhow!("eri_control_server only actuates on macOS")
    }
    pub fn snapshot() -> Result<Value> { Err(unsupported()) }
    pub fn capture() -> Result<Value> { Err(unsupported()) }
    pub fn click_at(_x: f64, _y: f64) -> Result<()> { Err(unsupported()) }
    pub fn type_text(_t: &str) -> Result<()> { Err(unsupported()) }
    pub fn key_combo(_c: &str) -> Result<()> { Err(unsupported()) }
    pub fn open_app(_n: &str) -> Result<()> { Err(unsupported()) }
    pub fn quit_app(_n: &str) -> Result<()> { Err(unsupported()) }
}
