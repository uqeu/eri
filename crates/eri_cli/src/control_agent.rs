//! Computer-control agent — the tool layer that lets eri *act* on the desktop
//! (observe the screen, click, type, press keys, open/quit apps) through a
//! pluggable [`ControlBridge`].
//!
//! The bridge is an abstraction so the control logic is unit-testable with a
//! [`MockBridge`] (no macOS, no permissions) while the real implementation
//! delegates each action to the macOS app over its WKWebView bridge (Swift
//! does the actual `AXUIElement` / `CGEvent` / `NSWorkspace` work).
//!
//! Accessibility-first: the cheap, reliable percept is the AX "screen graph"
//! (text, not pixels), so the agent clicks elements *by name* and only falls
//! back to coordinates/vision when AX has nothing usable. Risky/irreversible
//! actions (quitting apps, and later: sending messages, purchases, deletes)
//! pass through a confirm-gate so eri states the action and waits — never
//! silently does something destructive.

use std::path::Path;

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use eri_inference::memory::MemoryStore;

/// One node of the accessibility "screen graph" — a thing actually on screen.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AxElement {
    /// Stable-ish handle the bridge can act on (assigned per snapshot).
    pub id: String,
    /// AX role, e.g. "AXButton", "AXTextField".
    pub role: String,
    /// Best-effort human label (title/description/value).
    pub label: String,
    /// Whether the element exposes a press/confirm action.
    pub actionable: bool,
    /// Screen-point frame [x, y, w, h].
    pub frame: [f32; 4],
}

/// A snapshot of what's in front: the focused app/window and its elements.
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct ScreenGraph {
    pub app: String,
    pub window: String,
    pub elements: Vec<AxElement>,
}

impl ScreenGraph {
    /// Compact text rendering for the model — token-frugal (no pixels), one
    /// actionable element per line. This is what the agent "sees".
    pub fn to_prompt(&self) -> String {
        let mut out = format!("app: {} | window: {}\n", self.app, self.window);
        for e in &self.elements {
            if e.actionable {
                out.push_str(&format!("[{}] {} \"{}\"\n", e.id, e.role, e.label));
            }
        }
        out
    }
}

/// Where a click lands: a named AX element (preferred) or raw coordinates.
#[derive(Clone, Debug, PartialEq)]
pub enum ClickTarget {
    Element(String),
    Coord(f32, f32),
}

/// One concrete actuation the agent can request.
#[derive(Clone, Debug, PartialEq)]
pub enum ControlAction {
    Observe,
    Click(ClickTarget),
    Type(String),
    Key(String),
    OpenApp(String),
    QuitApp(String),
    Wait(u64),
}

impl ControlAction {
    /// Risky/irreversible or outward-facing actions must be confirmed before
    /// they run. Conservative by default — when in doubt, gate it. Beyond the
    /// obvious (quit), this is CONTENT-AWARE: a keystroke or typed string that
    /// looks destructive (⌘⌫, `rm -rf`, `DROP TABLE`, force-push, …) is gated
    /// too, since the agent types into whatever's focused (often a terminal).
    pub fn is_risky(&self) -> bool {
        match self {
            ControlAction::QuitApp(_) => true,
            ControlAction::Key(combo) => is_destructive_combo(combo),
            ControlAction::Type(text) => looks_destructive(text),
            _ => false,
        }
    }

    /// Human-readable description for the confirm prompt + narration.
    pub fn describe(&self) -> String {
        match self {
            ControlAction::Observe => "look at the screen".into(),
            ControlAction::Click(ClickTarget::Element(id)) => format!("click element {id}"),
            ControlAction::Click(ClickTarget::Coord(x, y)) => format!("click at ({x:.0}, {y:.0})"),
            ControlAction::Type(t) => format!("type {t:?}"),
            ControlAction::Key(k) => format!("press {k}"),
            ControlAction::OpenApp(a) => format!("open {a}"),
            ControlAction::QuitApp(a) => format!("quit {a}"),
            ControlAction::Wait(ms) => format!("wait {ms}ms"),
        }
    }
}

/// The actuation backend. The real impl delegates to the macOS app; tests use
/// [`MockBridge`]. Each method returns a short result string for the model.
#[async_trait::async_trait]
pub trait ControlBridge: Send + Sync {
    async fn snapshot(&self) -> Result<ScreenGraph>;
    /// Capture the screen as a base64 PNG (raw — caller must redact before any
    /// cloud send).
    async fn capture(&self) -> Result<String>;
    async fn click(&self, target: &ClickTarget) -> Result<String>;
    async fn type_text(&self, text: &str) -> Result<String>;
    async fn key(&self, combo: &str) -> Result<String>;
    async fn open_app(&self, name: &str) -> Result<String>;
    async fn quit_app(&self, name: &str) -> Result<String>;
}

/// Outcome of submitting an action to the gate.
#[derive(Clone, Debug, PartialEq)]
pub enum Disposition {
    /// Action ran; carries the bridge's result string.
    Executed(String),
    /// Action is risky and was held; carries the description to confirm.
    NeedsConfirmation(String),
}

/// Gates risky actions behind explicit confirmation. `auto_confirm` exists for
/// non-interactive/headless runs and tests; the interactive default is false.
#[derive(Debug, Default)]
pub struct ControlGate {
    auto_confirm: bool,
}

impl ControlGate {
    pub fn new() -> Self {
        Self {
            auto_confirm: false,
        }
    }

    pub fn auto_confirm() -> Self {
        Self { auto_confirm: true }
    }

    /// Submit an action. Risky actions are held (unless `auto_confirm`);
    /// everything else runs immediately on the bridge.
    pub async fn submit(
        &self,
        bridge: &dyn ControlBridge,
        action: &ControlAction,
    ) -> Result<Disposition> {
        if action.is_risky() && !self.auto_confirm {
            return Ok(Disposition::NeedsConfirmation(action.describe()));
        }
        Ok(Disposition::Executed(apply(bridge, action).await?))
    }

    /// Run a previously-held action after the user said yes.
    pub async fn confirm(
        &self,
        bridge: &dyn ControlBridge,
        action: &ControlAction,
    ) -> Result<String> {
        apply(bridge, action).await
    }
}

/// A keyboard shortcut that deletes/destroys, so it needs confirmation.
fn is_destructive_combo(combo: &str) -> bool {
    let c = combo.to_lowercase().replace(' ', "");
    let has_mod =
        c.contains("cmd") || c.contains("command") || c.contains("ctrl") || c.contains("control");
    // ⌘⌫ / ⌘⇧⌫ = move to trash / delete immediately; ⌘Q = quit.
    (has_mod && (c.contains("delete") || c.contains("backspace")))
        || c.contains("cmd+q")
        || c.contains("command+q")
}

/// Typed text that looks like a destructive command — gate it before the agent
/// presses it into a terminal/SQL console/etc. Heuristic + conservative: a few
/// false positives (an extra confirm) are far cheaper than one `rm -rf` slipping
/// through. Substring match, case-insensitive.
fn looks_destructive(text: &str) -> bool {
    let t = text.to_lowercase();
    const PATTERNS: &[&str] = &[
        "rm -rf",
        "rm -r ",
        "rm -f",
        "sudo rm",
        "mkfs",
        "dd if=",
        "dd of=/dev",
        "> /dev/sd",
        ":(){", // fork bomb
        "drop table",
        "drop database",
        "truncate table",
        "delete from ",
        "git push --force",
        "git push -f",
        "git reset --hard",
        "git clean -fd",
        "shutdown",
        "reboot",
        "diskutil erase",
        "format c:",
    ];
    PATTERNS.iter().any(|p| t.contains(p))
}

/// Dispatch an action to the bridge (no gating — callers gate first).
async fn apply(bridge: &dyn ControlBridge, action: &ControlAction) -> Result<String> {
    match action {
        ControlAction::Observe => Ok(bridge.snapshot().await?.to_prompt()),
        ControlAction::Click(t) => bridge.click(t).await,
        ControlAction::Type(s) => bridge.type_text(s).await,
        ControlAction::Key(k) => bridge.key(k).await,
        ControlAction::OpenApp(a) => bridge.open_app(a).await,
        ControlAction::QuitApp(a) => bridge.quit_app(a).await,
        ControlAction::Wait(ms) => Ok(format!("waited {ms}ms")),
    }
}

/// Parse a model tool call `(name, input)` into a [`ControlAction`].
pub fn parse_action(name: &str, input: &Value) -> Result<ControlAction> {
    let s = |k: &str| input.get(k).and_then(Value::as_str).map(str::to_string);
    match name {
        "screen_observe" => Ok(ControlAction::Observe),
        "click" => {
            if let Some(id) = s("element") {
                Ok(ControlAction::Click(ClickTarget::Element(id)))
            } else if let (Some(x), Some(y)) = (
                input.get("x").and_then(Value::as_f64),
                input.get("y").and_then(Value::as_f64),
            ) {
                Ok(ControlAction::Click(ClickTarget::Coord(x as f32, y as f32)))
            } else {
                Err(anyhow!("click needs `element` or `x`+`y`"))
            }
        }
        "type" => s("text")
            .map(ControlAction::Type)
            .ok_or_else(|| anyhow!("type needs `text`")),
        "key" => s("combo")
            .map(ControlAction::Key)
            .ok_or_else(|| anyhow!("key needs `combo`")),
        "open_app" => s("name")
            .map(ControlAction::OpenApp)
            .ok_or_else(|| anyhow!("open_app needs `name`")),
        "quit_app" => s("name")
            .map(ControlAction::QuitApp)
            .ok_or_else(|| anyhow!("quit_app needs `name`")),
        "wait" => Ok(ControlAction::Wait(
            input.get("ms").and_then(Value::as_u64).unwrap_or(500),
        )),
        other => Err(anyhow!("unknown control tool: {other}")),
    }
}

/// The control tool specs advertised to the model. Accessibility-first: the
/// description steers the model to `screen_observe` then click elements by id.
pub fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": "screen_observe",
            "description": "Look at the screen: returns the focused app/window and its actionable UI elements (id, role, label). Call this first, and after any action, to see current state. Cheap (text, not pixels) — prefer it over guessing.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "look",
            "description": "Capture the actual screen pixels as an image (faces auto-blurred locally for privacy). Use ONLY when screen_observe (accessibility text) isn't enough — e.g. canvas/games/custom UI or to read something not exposed as an element. More expensive than screen_observe, so prefer that first.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "click",
            "description": "Click a UI element by its id from screen_observe (preferred), or fall back to screen coordinates x,y only if no element matches.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "element": { "type": "string", "description": "Element id from screen_observe." },
                    "x": { "type": "number" },
                    "y": { "type": "number" }
                }
            }
        }),
        json!({
            "name": "type",
            "description": "Type text into the focused field.",
            "input_schema": {
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"]
            }
        }),
        json!({
            "name": "key",
            "description": "Press a key or shortcut, e.g. \"cmd+l\", \"enter\", \"esc\".",
            "input_schema": {
                "type": "object",
                "properties": { "combo": { "type": "string" } },
                "required": ["combo"]
            }
        }),
        json!({
            "name": "open_app",
            "description": "Open or activate an application by name, e.g. \"Safari\".",
            "input_schema": {
                "type": "object",
                "properties": { "name": { "type": "string" } },
                "required": ["name"]
            }
        }),
        json!({
            "name": "quit_app",
            "description": "Quit an application by name. This is a confirmed action — eri will ask the user before quitting.",
            "input_schema": {
                "type": "object",
                "properties": { "name": { "type": "string" } },
                "required": ["name"]
            }
        }),
        json!({
            "name": "wait",
            "description": "Wait for the UI to settle before observing again.",
            "input_schema": {
                "type": "object",
                "properties": { "ms": { "type": "integer" } }
            }
        }),
    ]
}

/// Outcome of executing one turn's tool calls.
#[derive(Debug, Default)]
pub struct StepOutcome {
    /// `tool_result` blocks to feed back to the model (one per call).
    pub results: Vec<Value>,
    /// The model called `done`.
    pub done: bool,
    /// Human-readable log of what happened this step (for narration).
    pub log: Vec<String>,
}

/// Execute one turn's tool calls through the gate + bridge. Risky actions are
/// confirmed via `confirm(description) -> bool` (interactive: prompt stdin;
/// tests: a canned closure). Shared by the live loop and the unit tests, so the
/// gate/confirm/error logic has exactly one implementation.
pub async fn execute_tool_calls(
    bridge: &dyn ControlBridge,
    gate: &ControlGate,
    confirm: &mut dyn FnMut(&str) -> bool,
    calls: &[(String, String, Value)],
) -> StepOutcome {
    let mut out = StepOutcome::default();
    for (id, name, input) in calls {
        if name == "done" {
            out.done = true;
            out.results.push(tool_result(id, "acknowledged", false));
            continue;
        }
        // `look`: capture the screen, REDACT faces locally, and return the
        // redacted image to the model. FAIL-CLOSED: if redaction can't run, we
        // refuse to send the frame (never ship an unredacted screen to cloud).
        if name == "look" {
            out.results.push(match bridge.capture().await {
                Ok(b64) => match redact_png(&b64).await {
                    Ok(redacted) => {
                        out.log.push("looked at the screen (faces redacted)".into());
                        image_tool_result(id, &redacted)
                    }
                    Err(e) => {
                        out.log
                            .push(format!("look refused — redaction failed: {e}"));
                        tool_result(
                            id,
                            &format!(
                                "refused: could not redact the screen ({e}); not sending it. \
                                 Use screen_observe (accessibility) instead."
                            ),
                            true,
                        )
                    }
                },
                Err(e) => tool_result(id, &format!("capture failed: {e}"), true),
            });
            continue;
        }
        let action = match parse_action(name, input) {
            Ok(a) => a,
            Err(e) => {
                out.log.push(format!("bad tool call {name}: {e}"));
                out.results
                    .push(tool_result(id, &format!("error: {e}"), true));
                continue;
            }
        };
        match gate.submit(bridge, &action).await {
            Ok(Disposition::Executed(result)) => {
                out.log.push(format!("{} -> {result}", action.describe()));
                out.results.push(tool_result(id, &result, false));
            }
            Ok(Disposition::NeedsConfirmation(desc)) => {
                if confirm(&desc) {
                    match gate.confirm(bridge, &action).await {
                        Ok(result) => {
                            out.log.push(format!("confirmed: {desc} -> {result}"));
                            out.results.push(tool_result(id, &result, false));
                        }
                        Err(e) => {
                            out.log.push(format!("confirm failed: {e}"));
                            out.results
                                .push(tool_result(id, &format!("error: {e}"), true));
                        }
                    }
                } else {
                    out.log.push(format!("declined: {desc}"));
                    out.results
                        .push(tool_result(id, "user declined this action", false));
                }
            }
            Err(e) => {
                out.log.push(format!("{} failed: {e}", action.describe()));
                out.results
                    .push(tool_result(id, &format!("error: {e}"), true));
            }
        }
    }
    out
}

fn tool_result(id: &str, content: &str, is_error: bool) -> Value {
    json!({
        "type": "tool_result",
        "tool_use_id": id,
        "content": content,
        "is_error": is_error,
    })
}

/// A tool_result carrying a (redacted) PNG image block, so the model can see the
/// screen. Anthropic accepts image blocks inside tool_result content.
fn image_tool_result(id: &str, png_b64: &str) -> Value {
    json!({
        "type": "tool_result",
        "tool_use_id": id,
        "content": [{
            "type": "image",
            "source": { "type": "base64", "media_type": "image/png", "data": png_b64 },
        }],
    })
}

/// Redact faces in a base64 PNG by piping it through the local `eri_redact.py`
/// sidecar. FAIL-CLOSED by design: any failure (sidecar missing, CV deps absent,
/// bad output) returns Err so the caller refuses to send an unredacted frame.
async fn redact_png(png_b64: &str) -> Result<String> {
    let script =
        std::env::var("ERI_REDACT_SCRIPT").unwrap_or_else(|_| "scripts/eri_redact.py".to_string());
    let mut child = tokio::process::Command::new("python3")
        .arg(&script)
        .arg("--stdio")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| anyhow!("redactor spawn failed: {e}"))?;
    let req = format!("{}\n", json!({ "image": png_b64 }));
    {
        use tokio::io::AsyncWriteExt;
        let mut stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        stdin
            .write_all(req.as_bytes())
            .await
            .map_err(|e| anyhow!("redactor write: {e}"))?;
        stdin.shutdown().await.ok();
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| anyhow!("redactor wait: {e}"))?;
    let line = String::from_utf8_lossy(&output.stdout);
    let reply: Value = serde_json::from_str(line.lines().next().unwrap_or("").trim())
        .map_err(|e| anyhow!("redactor output not JSON: {e}"))?;
    if let Some(err) = reply.get("error").and_then(Value::as_str) {
        return Err(anyhow!("redactor: {err}"));
    }
    reply
        .get("image")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("redactor reply missing image"))
}

/// Builder persona for the control loop. Accessibility-first + frugal.
fn control_system_prompt() -> &'static str {
    "You are eri's computer-control agent. You accomplish the user's goal by \
operating the computer with the provided tools. ALWAYS call screen_observe \
first to see the current app and its actionable elements, then act, then \
observe again to verify. Prefer clicking elements by their id over \
coordinates. Use open_app to launch/focus apps. Keep steps minimal -- do not \
take unnecessary actions. quit_app and other destructive actions require the \
user's confirmation (the harness will ask). When the goal is achieved, call \
done with a one-line summary. Be efficient: observe only when state may have \
changed."
}

/// A safe bridge that performs NO actuation -- it logs what eri *would* do.
/// Lets `eri control` exercise the live planning loop before the macOS
/// actuation bridge lands, and is the default until the user opts into real
/// control. `snapshot` returns an empty graph (the model is told it's dry-run).
pub struct DryRunBridge;

#[async_trait::async_trait]
impl ControlBridge for DryRunBridge {
    async fn snapshot(&self) -> Result<ScreenGraph> {
        Ok(ScreenGraph {
            app: "(dry-run: no live screen access)".into(),
            window: String::new(),
            elements: Vec::new(),
        })
    }
    async fn capture(&self) -> Result<String> {
        Err(anyhow!("DRY RUN: no screen capture"))
    }
    async fn click(&self, t: &ClickTarget) -> Result<String> {
        Ok(format!("DRY RUN: would click {t:?}"))
    }
    async fn type_text(&self, text: &str) -> Result<String> {
        Ok(format!("DRY RUN: would type {text:?}"))
    }
    async fn key(&self, combo: &str) -> Result<String> {
        Ok(format!("DRY RUN: would press {combo}"))
    }
    async fn open_app(&self, name: &str) -> Result<String> {
        Ok(format!("DRY RUN: would open {name}"))
    }
    async fn quit_app(&self, name: &str) -> Result<String> {
        Ok(format!("DRY RUN: would quit {name}"))
    }
}

/// Serialize an action to the wire JSON the actuation server understands.
/// Pure + tested so the Rust↔app contract can't silently drift. `Observe` and
/// `Wait` never reach the wire (snapshot has its own call; wait is local).
pub fn action_to_wire(action: &ControlAction) -> Value {
    match action {
        ControlAction::Observe => json!({ "kind": "snapshot" }),
        ControlAction::Click(ClickTarget::Element(id)) => {
            json!({ "kind": "click", "element": id })
        }
        ControlAction::Click(ClickTarget::Coord(x, y)) => {
            json!({ "kind": "click", "x": x, "y": y })
        }
        ControlAction::Type(t) => json!({ "kind": "type", "text": t }),
        ControlAction::Key(k) => json!({ "kind": "key", "combo": k }),
        ControlAction::OpenApp(a) => json!({ "kind": "open_app", "name": a }),
        ControlAction::QuitApp(a) => json!({ "kind": "quit_app", "name": a }),
        ControlAction::Wait(ms) => json!({ "kind": "wait", "ms": ms }),
    }
}

/// Parse the actuation server's reply for a non-snapshot action: `{"result"}`
/// on success, `{"error"}` on failure.
pub fn parse_wire_result(reply: &Value) -> Result<String> {
    if let Some(err) = reply.get("error").and_then(Value::as_str) {
        return Err(anyhow!("{err}"));
    }
    reply
        .get("result")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("malformed control reply: {reply}"))
}

/// Parse a snapshot reply: `{"screen": ScreenGraph}` (or `{"error"}`).
pub fn parse_wire_snapshot(reply: &Value) -> Result<ScreenGraph> {
    if let Some(err) = reply.get("error").and_then(Value::as_str) {
        return Err(anyhow!("{err}"));
    }
    let screen = reply
        .get("screen")
        .ok_or_else(|| anyhow!("snapshot reply missing `screen`: {reply}"))?;
    serde_json::from_value(screen.clone()).map_err(|e| anyhow!("bad screen graph: {e}"))
}

/// Parse a capture reply: `{"image": "<base64 png>"}` (or `{"error"}`).
pub fn parse_wire_capture(reply: &Value) -> Result<String> {
    if let Some(err) = reply.get("error").and_then(Value::as_str) {
        return Err(anyhow!("{err}"));
    }
    reply
        .get("image")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("capture reply missing `image`: {reply}"))
}

/// The real actuation bridge: POSTs each action to a loopback endpoint hosted
/// by the macOS app (which does the AX/CGEvent/NSWorkspace work) and parses the
/// reply. The endpoint URL comes from `ERI_CONTROL_ENDPOINT`, set by the app
/// when it spawns `eri control --live`, so standalone CLI runs can't actuate by
/// accident.
pub struct HttpBridge {
    endpoint: String,
    /// Per-launch bearer token from `ERI_CONTROL_TOKEN`; the server rejects
    /// requests without it (defends the all-powerful endpoint against any other
    /// local process).
    token: Option<String>,
    client: reqwest::Client,
}

impl HttpBridge {
    /// Build from `ERI_CONTROL_ENDPOINT` (+ `ERI_CONTROL_TOKEN`); `None` when
    /// the endpoint is unset (no app host).
    pub fn from_env() -> Option<Self> {
        let endpoint = std::env::var("ERI_CONTROL_ENDPOINT").ok()?;
        if endpoint.trim().is_empty() {
            return None;
        }
        let token = std::env::var("ERI_CONTROL_TOKEN")
            .ok()
            .filter(|t| !t.is_empty());
        Some(Self {
            endpoint,
            token,
            client: reqwest::Client::new(),
        })
    }

    async fn post(&self, body: Value) -> Result<Value> {
        let mut req = self.client.post(&self.endpoint).json(&body);
        if let Some(token) = &self.token {
            req = req.bearer_auth(token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| anyhow!("control bridge unreachable: {e}"))?;
        let json: Value = resp
            .json()
            .await
            .map_err(|e| anyhow!("control bridge sent invalid JSON: {e}"))?;
        Ok(json)
    }

    async fn act(&self, action: &ControlAction) -> Result<String> {
        let reply = self.post(action_to_wire(action)).await?;
        parse_wire_result(&reply)
    }
}

#[async_trait::async_trait]
impl ControlBridge for HttpBridge {
    async fn snapshot(&self) -> Result<ScreenGraph> {
        let reply = self.post(action_to_wire(&ControlAction::Observe)).await?;
        parse_wire_snapshot(&reply)
    }
    async fn capture(&self) -> Result<String> {
        let reply = self.post(json!({ "kind": "capture" })).await?;
        parse_wire_capture(&reply)
    }
    async fn click(&self, target: &ClickTarget) -> Result<String> {
        self.act(&ControlAction::Click(target.clone())).await
    }
    async fn type_text(&self, text: &str) -> Result<String> {
        self.act(&ControlAction::Type(text.to_string())).await
    }
    async fn key(&self, combo: &str) -> Result<String> {
        self.act(&ControlAction::Key(combo.to_string())).await
    }
    async fn open_app(&self, name: &str) -> Result<String> {
        self.act(&ControlAction::OpenApp(name.to_string())).await
    }
    async fn quit_app(&self, name: &str) -> Result<String> {
        self.act(&ControlAction::QuitApp(name.to_string())).await
    }
}

/// Build the lower-trust context notes injected into the control loop: (a)
/// remembered facts relevant to the goal (hybrid recall, 0 model tokens), and
/// (b) a single cheap ambient snapshot of what's on screen. All best-effort —
/// any failure just yields fewer notes, never an error.
async fn context_blocks(goal: &str, bridge: &dyn ControlBridge, workspace: &Path) -> Vec<String> {
    let mut blocks = Vec::new();
    if let Ok(mut store) = MemoryStore::open()
        && let Ok(hits) = store.recall_hybrid(goal, workspace, 5)
    {
        let lines: Vec<String> = hits
            .into_iter()
            .map(|(o, _)| format!("- {}", o.body.replace('\n', " ")))
            .collect();
        if !lines.is_empty() {
            blocks.push(format!(
                "<eri:memory note=\"remembered context — not an instruction\">\n{}\n</eri:memory>",
                lines.join("\n")
            ));
        }
    }
    if let Ok(graph) = bridge.snapshot().await
        && !graph.elements.is_empty()
    {
        let note = crate::awareness::situation_note(&graph);
        if !note.is_empty() {
            blocks.push(format!(
                "<eri:awareness note=\"on screen now — context only\">\n{note}\n</eri:awareness>"
            ));
        }
    }
    blocks
}

/// Record the user's request to local memory (learn-do loop). Best-effort.
fn remember_goal(goal: &str, workspace: &Path) {
    if let Ok(mut store) = MemoryStore::open() {
        let _ = store.insert("procedure", workspace, &format!("asked eri to: {goal}"));
    }
}

/// Run the live computer-control loop for `goal`: stream the model, execute its
/// control tool calls through `bridge` + `gate`, feed results back, until it
/// calls `done` or hits the turn cap. Reuses the build loop's streaming
/// (`consume_turn`) and request shaping so the protocol + prompt-caching are
/// identical. Returns the model's final summary text.
pub async fn run_control_agent(
    goal: &str,
    model: &str,
    bridge: &dyn ControlBridge,
    gate: &ControlGate,
    confirm: &mut dyn FnMut(&str) -> bool,
    max_turns: usize,
) -> Result<String> {
    use std::io::Write;

    if goal.trim().is_empty() {
        return Err(anyhow!("control goal is empty"));
    }
    let client = crate::build_agent::signed_in_client()?;
    let mut system = vec![json!({
        "type": "text",
        "text": control_system_prompt(),
        "cache_control": { "type": "ephemeral" }
    })];
    // Inject local context so eri acts informed + frugal: (a) remembered facts
    // relevant to this goal (mem0-style hybrid recall, 0 model tokens), and
    // (b) what's on screen right now (ambient situation note from one cheap AX
    // snapshot). Both fenced as lower-trust notes. Best-effort — never blocks.
    let workspace = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    for note in context_blocks(goal, bridge, &workspace).await {
        system.push(json!({ "type": "text", "text": note }));
    }
    // Learn-do loop: record what the user asked so future sessions anticipate.
    remember_goal(goal, &workspace);
    let tools: Value = json!(tool_specs());
    let mut messages: Vec<Value> = vec![json!({ "role": "user", "content": goal.trim() })];
    let mut stdout = std::io::stdout();
    let mut final_text = String::new();

    for _ in 0..max_turns {
        let cached = eri_agent::request::with_conversation_cache(&messages);
        let body = eri_agent::request::messages_body(
            model,
            crate::build_agent::MAX_TOKENS,
            &system,
            &tools,
            &cached,
        );
        let response = client
            .post_stream("/api/v1/inference/messages", &body)
            .await
            .map_err(crate::build_agent::friendly_proxy_error)?;
        let turn = crate::build_agent::consume_turn(response, &mut stdout, true).await?;

        let text = eri_agent::stream::assistant_text(&turn.content);
        if !text.trim().is_empty() {
            final_text = text;
        }
        messages.push(json!({ "role": "assistant", "content": turn.content }));

        if turn.stop_reason.as_deref() != Some("tool_use") {
            return Ok(final_text);
        }

        let calls: Vec<(String, String, Value)> = turn
            .tool_uses
            .iter()
            .map(|t| (t.id.clone(), t.name.clone(), t.input.clone()))
            .collect();
        let step = execute_tool_calls(bridge, gate, confirm, &calls).await;
        for line in &step.log {
            let _ = writeln!(stdout, "[eri] {line}");
        }
        messages.push(json!({ "role": "user", "content": step.results }));
        if step.done {
            return Ok(final_text);
        }
    }
    Ok(final_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Records every call so tests can assert the action sequence; returns
    /// canned snapshots from a queue.
    #[derive(Default)]
    struct MockBridge {
        calls: Mutex<Vec<String>>,
        snapshots: Mutex<Vec<ScreenGraph>>,
    }

    impl MockBridge {
        fn with_snapshot(graph: ScreenGraph) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                snapshots: Mutex::new(vec![graph]),
            }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl ControlBridge for MockBridge {
        async fn snapshot(&self) -> Result<ScreenGraph> {
            self.calls.lock().unwrap().push("snapshot".into());
            Ok(self.snapshots.lock().unwrap().pop().unwrap_or_default())
        }
        async fn capture(&self) -> Result<String> {
            self.calls.lock().unwrap().push("capture".into());
            Ok("ZmFrZS1wbmc=".into()) // base64("fake-png")
        }
        async fn click(&self, t: &ClickTarget) -> Result<String> {
            self.calls.lock().unwrap().push(format!("click:{t:?}"));
            Ok("clicked".into())
        }
        async fn type_text(&self, text: &str) -> Result<String> {
            self.calls.lock().unwrap().push(format!("type:{text}"));
            Ok("typed".into())
        }
        async fn key(&self, combo: &str) -> Result<String> {
            self.calls.lock().unwrap().push(format!("key:{combo}"));
            Ok("pressed".into())
        }
        async fn open_app(&self, name: &str) -> Result<String> {
            self.calls.lock().unwrap().push(format!("open:{name}"));
            Ok(format!("opened {name}"))
        }
        async fn quit_app(&self, name: &str) -> Result<String> {
            self.calls.lock().unwrap().push(format!("quit:{name}"));
            Ok(format!("quit {name}"))
        }
    }

    fn graph() -> ScreenGraph {
        ScreenGraph {
            app: "Safari".into(),
            window: "Start Page".into(),
            elements: vec![
                AxElement {
                    id: "e1".into(),
                    role: "AXTextField".into(),
                    label: "Search".into(),
                    actionable: true,
                    frame: [10.0, 10.0, 200.0, 30.0],
                },
                AxElement {
                    id: "e2".into(),
                    role: "AXStaticText".into(),
                    label: "decoration".into(),
                    actionable: false,
                    frame: [0.0, 0.0, 5.0, 5.0],
                },
            ],
        }
    }

    #[test]
    fn screen_graph_prompt_lists_only_actionable() {
        let p = graph().to_prompt();
        assert!(p.contains("app: Safari"));
        assert!(p.contains("[e1] AXTextField \"Search\""));
        assert!(
            !p.contains("decoration"),
            "non-actionable elements are omitted"
        );
    }

    #[test]
    fn parse_action_covers_the_tool_surface() {
        assert_eq!(
            parse_action("screen_observe", &json!({})).unwrap(),
            ControlAction::Observe
        );
        assert_eq!(
            parse_action("click", &json!({ "element": "e1" })).unwrap(),
            ControlAction::Click(ClickTarget::Element("e1".into()))
        );
        assert_eq!(
            parse_action("click", &json!({ "x": 4.0, "y": 8.0 })).unwrap(),
            ControlAction::Click(ClickTarget::Coord(4.0, 8.0))
        );
        assert_eq!(
            parse_action("type", &json!({ "text": "lofi" })).unwrap(),
            ControlAction::Type("lofi".into())
        );
        assert_eq!(
            parse_action("wait", &json!({})).unwrap(),
            ControlAction::Wait(500)
        );
        assert!(parse_action("click", &json!({})).is_err());
        assert!(parse_action("bogus", &json!({})).is_err());
    }

    #[test]
    fn quit_is_risky_others_are_not() {
        assert!(ControlAction::QuitApp("Cursor".into()).is_risky());
        assert!(!ControlAction::OpenApp("Safari".into()).is_risky());
        assert!(!ControlAction::Type("x".into()).is_risky());
    }

    #[test]
    fn destructive_typed_text_is_gated() {
        let risky = [
            "rm -rf /",
            "sudo rm -rf node_modules",
            "DROP TABLE users;",
            "git push --force origin main",
            "git reset --hard HEAD~3",
            "DELETE FROM accounts WHERE 1=1",
        ];
        for t in risky {
            assert!(ControlAction::Type(t.into()).is_risky(), "should gate: {t}");
        }
        // Benign typing is NOT gated (no confirmation friction).
        for t in [
            "hello world",
            "lofi hip hop",
            "const x = 1;",
            "format the date",
        ] {
            assert!(
                !ControlAction::Type(t.into()).is_risky(),
                "should NOT gate: {t}"
            );
        }
    }

    #[test]
    fn destructive_key_combos_are_gated() {
        for k in [
            "cmd+delete",
            "cmd+shift+delete",
            "command+backspace",
            "cmd+q",
        ] {
            assert!(ControlAction::Key(k.into()).is_risky(), "should gate: {k}");
        }
        for k in ["cmd+l", "enter", "cmd+c", "tab"] {
            assert!(
                !ControlAction::Key(k.into()).is_risky(),
                "should NOT gate: {k}"
            );
        }
    }

    #[tokio::test]
    async fn gate_runs_safe_actions_immediately() {
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::new();
        let d = gate
            .submit(&bridge, &ControlAction::OpenApp("Safari".into()))
            .await
            .unwrap();
        assert_eq!(d, Disposition::Executed("opened Safari".into()));
        assert_eq!(bridge.calls(), vec!["open:Safari"]);
    }

    #[tokio::test]
    async fn gate_holds_risky_action_until_confirmed() {
        let bridge = MockBridge::default();
        let gate = ControlGate::new();
        let quit = ControlAction::QuitApp("Cursor".into());
        // Submitting does NOT execute — it asks for confirmation.
        let d = gate.submit(&bridge, &quit).await.unwrap();
        assert_eq!(d, Disposition::NeedsConfirmation("quit Cursor".into()));
        assert!(bridge.calls().is_empty(), "must not quit before confirm");
        // After the user says yes, confirm() runs it.
        let out = gate.confirm(&bridge, &quit).await.unwrap();
        assert_eq!(out, "quit Cursor");
        assert_eq!(bridge.calls(), vec!["quit:Cursor"]);
    }

    #[tokio::test]
    async fn auto_confirm_bypasses_the_gate() {
        let bridge = MockBridge::default();
        let gate = ControlGate::auto_confirm();
        let d = gate
            .submit(&bridge, &ControlAction::QuitApp("X".into()))
            .await
            .unwrap();
        assert_eq!(d, Disposition::Executed("quit X".into()));
    }

    #[tokio::test]
    async fn observe_returns_the_compact_graph() {
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::new();
        let d = gate.submit(&bridge, &ControlAction::Observe).await.unwrap();
        match d {
            Disposition::Executed(text) => assert!(text.contains("[e1] AXTextField")),
            other => panic!("expected executed observe, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn executor_runs_a_full_open_type_click_done_sequence() {
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::new();
        let mut confirm = |_: &str| true;
        let calls = vec![
            ("1".into(), "open_app".into(), json!({ "name": "Safari" })),
            ("2".into(), "type".into(), json!({ "text": "lofi" })),
            ("3".into(), "click".into(), json!({ "element": "e1" })),
            ("4".into(), "done".into(), json!({})),
        ];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, &calls).await;
        assert!(out.done);
        assert_eq!(out.results.len(), 4);
        assert_eq!(
            bridge.calls(),
            vec!["open:Safari", "type:lofi", "click:Element(\"e1\")"]
        );
    }

    #[tokio::test]
    async fn executor_skips_risky_action_when_user_declines() {
        let bridge = MockBridge::default();
        let gate = ControlGate::new();
        let mut confirm = |_: &str| false; // user says no
        let calls = vec![("1".into(), "quit_app".into(), json!({ "name": "Cursor" }))];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, &calls).await;
        assert!(!out.done);
        assert!(bridge.calls().is_empty(), "declined quit must not run");
        let content = out.results[0]["content"].as_str().unwrap();
        assert!(content.contains("declined"));
    }

    #[tokio::test]
    async fn executor_runs_risky_action_when_user_confirms() {
        let bridge = MockBridge::default();
        let gate = ControlGate::new();
        let mut confirm = |_: &str| true; // user says yes
        let calls = vec![("1".into(), "quit_app".into(), json!({ "name": "Cursor" }))];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, &calls).await;
        assert_eq!(bridge.calls(), vec!["quit:Cursor"]);
        assert!(!out.results[0]["is_error"].as_bool().unwrap());
    }

    #[tokio::test]
    async fn executor_reports_bad_tool_call_as_error_not_panic() {
        let bridge = MockBridge::default();
        let gate = ControlGate::new();
        let mut confirm = |_: &str| true;
        let calls = vec![("1".into(), "click".into(), json!({}))]; // missing target
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, &calls).await;
        assert!(out.results[0]["is_error"].as_bool().unwrap());
        assert!(bridge.calls().is_empty());
    }

    #[test]
    fn parse_wire_capture_handles_image_and_error() {
        assert_eq!(
            parse_wire_capture(&json!({ "image": "abc", "format": "png" })).unwrap(),
            "abc"
        );
        assert!(parse_wire_capture(&json!({ "error": "denied" })).is_err());
        assert!(parse_wire_capture(&json!({ "nope": 1 })).is_err());
    }

    #[tokio::test]
    async fn look_fails_closed_when_redaction_unavailable() {
        // The redactor sidecar can't run in this test env (no CV deps / script
        // path), so `look` MUST refuse to return the frame rather than ship an
        // unredacted screen. This is the core privacy guarantee.
        let bridge = MockBridge::default();
        let gate = ControlGate::new();
        let mut confirm = |_: &str| true;
        // Point the redactor at a definitely-missing script so it fails fast.
        // SAFETY: single-threaded test; we own this process-local var.
        unsafe { std::env::set_var("ERI_REDACT_SCRIPT", "/nonexistent/eri_redact.py") };
        let calls = vec![("1".into(), "look".into(), json!({}))];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, &calls).await;
        unsafe { std::env::remove_var("ERI_REDACT_SCRIPT") };

        assert!(
            bridge.calls().contains(&"capture".to_string()),
            "should capture"
        );
        let res = &out.results[0];
        assert!(
            res["is_error"].as_bool().unwrap_or(false),
            "must fail closed"
        );
        let content = res["content"].as_str().unwrap_or("");
        assert!(
            content.contains("refused") || content.contains("redact"),
            "must explain the refusal, got: {content}"
        );
        // Crucially: NO image block was emitted.
        assert!(
            res["content"].as_array().is_none(),
            "must not emit an image"
        );
    }

    #[test]
    fn action_wire_roundtrip_is_stable() {
        // The Rust↔app contract: these shapes must match the Swift server.
        assert_eq!(
            action_to_wire(&ControlAction::Observe),
            json!({ "kind": "snapshot" })
        );
        assert_eq!(
            action_to_wire(&ControlAction::Click(ClickTarget::Element("e1".into()))),
            json!({ "kind": "click", "element": "e1" })
        );
        assert_eq!(
            action_to_wire(&ControlAction::OpenApp("Safari".into())),
            json!({ "kind": "open_app", "name": "Safari" })
        );
        assert_eq!(
            action_to_wire(&ControlAction::QuitApp("Cursor".into())),
            json!({ "kind": "quit_app", "name": "Cursor" })
        );
    }

    #[test]
    fn parse_wire_result_handles_success_and_error() {
        assert_eq!(
            parse_wire_result(&json!({ "result": "clicked" })).unwrap(),
            "clicked"
        );
        assert!(parse_wire_result(&json!({ "error": "no such element" })).is_err());
        assert!(parse_wire_result(&json!({ "nonsense": 1 })).is_err());
    }

    #[test]
    fn parse_wire_snapshot_reconstructs_the_graph() {
        let reply = json!({ "screen": {
            "app": "Safari", "window": "Start", "elements": [
                { "id": "e1", "role": "AXButton", "label": "Go", "actionable": true, "frame": [1.0,2.0,3.0,4.0] }
            ]
        }});
        let g = parse_wire_snapshot(&reply).unwrap();
        assert_eq!(g.app, "Safari");
        assert_eq!(g.elements.len(), 1);
        assert_eq!(g.elements[0].id, "e1");
        assert!(parse_wire_snapshot(&json!({ "error": "denied" })).is_err());
    }

    #[test]
    fn http_bridge_absent_without_endpoint() {
        // Guards accidental standalone actuation. (Uses a guaranteed-unset key
        // by removing it for the duration is racy across tests; instead assert
        // the empty-string case is rejected via the same predicate.)
        // Empty endpoint -> None.
        // SAFETY: single-threaded test mutation of a process-local var we own.
        unsafe { std::env::set_var("ERI_CONTROL_ENDPOINT", "") };
        assert!(HttpBridge::from_env().is_none());
        unsafe { std::env::remove_var("ERI_CONTROL_ENDPOINT") };
    }

    #[tokio::test]
    async fn dry_run_bridge_actuates_nothing() {
        let bridge = DryRunBridge;
        let out = bridge.open_app("Safari").await.unwrap();
        assert!(out.starts_with("DRY RUN"));
        assert!(bridge.snapshot().await.unwrap().elements.is_empty());
    }

    #[test]
    fn tool_specs_cover_the_action_surface() {
        let specs = tool_specs();
        assert_eq!(specs.len(), 8);
        let names: Vec<&str> = specs
            .iter()
            .map(|s| s.get("name").and_then(Value::as_str).unwrap())
            .collect();
        for expected in [
            "screen_observe",
            "look",
            "click",
            "type",
            "key",
            "open_app",
            "quit_app",
            "wait",
        ] {
            assert!(names.contains(&expected), "missing tool spec {expected}");
        }
    }
}
