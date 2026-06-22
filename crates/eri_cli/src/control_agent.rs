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
use std::sync::{Arc, Mutex};

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use eri_inference::memory::MemoryStore;

use crate::action_log::ActionLog;
use crate::control_turn::{ControlTurnSink, control_turn_log};

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
    /// Screen bounds `[x, y, w, h]` in macOS points for the display the
    /// elements live on. Optional + `#[serde(default)]` so older snapshots (and
    /// the dry-run/mock bridges) that don't carry it deserialize unchanged.
    /// Used ONLY to normalise the AX pixel frames into the gaze point's `[0,1]`
    /// space for [`crate::gaze_focus`]; absent → no gaze-focus block.
    #[serde(default)]
    pub screen: Option<[f32; 4]>,
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ClickTarget {
    Element(String),
    Coord(f32, f32),
}

/// One concrete actuation the agent can request. Serializable so the trust
/// layer ([`crate::action_log`]) can persist what eri did + replay an undo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ControlAction {
    Observe,
    Click(ClickTarget),
    Type(String),
    Key(String),
    OpenApp(String),
    QuitApp(String),
    Wait(u64),
    /// Scroll the focused view. `direction` is up/down/left/right; `amount` is a
    /// relative click/notch count (positive). Navigation, not destructive.
    Scroll {
        direction: String,
        amount: i64,
    },
    /// Press-drag-release from one point to another — moving a slider, a file,
    /// selecting a range. Reversible navigation, but flows through the gate like
    /// any pointer action so the remote channel can still confirm it.
    Drag {
        from: ClickTarget,
        to: ClickTarget,
    },
    /// Right-click (secondary click) to open a context menu.
    RightClick(ClickTarget),
    /// Double-click (open/activate).
    DoubleClick(ClickTarget),
    /// Move the pointer to a coordinate without clicking (hover).
    MouseMove(f32, f32),
    /// Run an AppleScript / Apple Event — the semantic Tier-1 path for native
    /// apps (make a new document, compose mail, set a field's value) that's
    /// faster and far more reliable than clicking. Content-gated like `Type`: a
    /// destructive script (delete/erase/rm/quit/shutdown) is held for confirm.
    RunAppleScript(String),
    /// Read the system clipboard — the cross-app bus. Lets eri carry something
    /// it grabbed in one app (a snippet, a value) into another. A read.
    ReadClipboard,
    /// Put text on the system clipboard so it can be pasted elsewhere. Not
    /// executed until something pastes it, so not destructive on its own.
    WriteClipboard(String),
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
            ControlAction::Type(text) | ControlAction::RunAppleScript(text) => {
                looks_destructive(text)
            }
            // Pointer/navigation actions are not destructive on their own; they
            // still flow through the gate so the remote channel can confirm them.
            ControlAction::Observe
            | ControlAction::Click(_)
            | ControlAction::OpenApp(_)
            | ControlAction::Wait(_)
            | ControlAction::Scroll { .. }
            | ControlAction::Drag { .. }
            | ControlAction::RightClick(_)
            | ControlAction::DoubleClick(_)
            | ControlAction::MouseMove(..)
            | ControlAction::ReadClipboard
            | ControlAction::WriteClipboard(_) => false,
        }
    }

    /// Stricter risk check for the **unattended remote** channel (review M1):
    /// everything `is_risky` gates, PLUS clicking an outward-facing button
    /// (Send / Post / Pay / Delete / Publish …). Those aren't gated locally
    /// (the user is watching) but must be confirmed when triggered from a phone,
    /// or a remote "reply to my landlord" would click Send unattended.
    pub fn is_risky_remote(&self) -> bool {
        if self.is_risky() {
            return true;
        }
        // Exhaustive on purpose — NO `_` wildcard. `is_risky_remote` is a
        // reversibility source for unattended auto-execute, so a newly-added
        // action variant must force a deliberate remote-risk decision here
        // (otherwise it would silently become auto-executable from the phone).
        match self {
            ControlAction::Click(ClickTarget::Element(label))
            | ControlAction::RightClick(ClickTarget::Element(label))
            | ControlAction::DoubleClick(ClickTarget::Element(label)) => {
                looks_outward_facing(label)
            }
            // Coord-target clicks + every non-click action carry no extra remote
            // escalation beyond `is_risky()` above. Listed explicitly so the match
            // stays exhaustive.
            ControlAction::Click(ClickTarget::Coord(..))
            | ControlAction::RightClick(ClickTarget::Coord(..))
            | ControlAction::DoubleClick(ClickTarget::Coord(..))
            | ControlAction::Observe
            | ControlAction::Type(_)
            | ControlAction::Key(_)
            | ControlAction::OpenApp(_)
            | ControlAction::QuitApp(_)
            | ControlAction::Wait(_)
            | ControlAction::Scroll { .. }
            | ControlAction::Drag { .. }
            | ControlAction::MouseMove(..)
            | ControlAction::RunAppleScript(_)
            | ControlAction::ReadClipboard
            | ControlAction::WriteClipboard(_) => false,
        }
    }

    /// The permission category that, if the user has granted it, lets this
    /// risky action run without a per-action confirm. `None` = always confirm
    /// (or it isn't risky). Refusals are never mapped here — they can't be
    /// granted away.
    pub fn permission(&self) -> Option<crate::control_safety::Permission> {
        use crate::control_safety::Permission;
        match self {
            ControlAction::QuitApp(_) => Some(Permission::QuitApps),
            ControlAction::Key(combo) if is_destructive_combo(combo) => {
                Some(Permission::DestructiveKeys)
            }
            ControlAction::Type(text) if looks_destructive(text) => {
                Some(Permission::DestructiveCommands)
            }
            ControlAction::RunAppleScript(s) if looks_destructive(s) => {
                Some(Permission::DestructiveCommands)
            }
            // Everything else (incl. the pointer/navigation actions) has no
            // grantable permission category — it either isn't risky, or it's a
            // refusal that can't be granted away.
            ControlAction::Observe
            | ControlAction::Click(_)
            | ControlAction::Type(_)
            | ControlAction::Key(_)
            | ControlAction::OpenApp(_)
            | ControlAction::Wait(_)
            | ControlAction::Scroll { .. }
            | ControlAction::Drag { .. }
            | ControlAction::RightClick(_)
            | ControlAction::DoubleClick(_)
            | ControlAction::MouseMove(..)
            | ControlAction::RunAppleScript(_)
            | ControlAction::ReadClipboard
            | ControlAction::WriteClipboard(_) => None,
        }
    }

    /// The app this action names, if any. Used to enforce the per-app denylist
    /// ("don't touch Discord") before actuating. Actions that don't name an app
    /// (click/type/key/observe) return `None` — perception-side scoping of the
    /// *frontmost* app is handled separately.
    pub fn target_app(&self) -> Option<&str> {
        match self {
            ControlAction::OpenApp(a) | ControlAction::QuitApp(a) => Some(a.as_str()),
            ControlAction::Observe
            | ControlAction::Click(_)
            | ControlAction::Type(_)
            | ControlAction::Key(_)
            | ControlAction::Wait(_)
            | ControlAction::Scroll { .. }
            | ControlAction::Drag { .. }
            | ControlAction::RightClick(_)
            | ControlAction::DoubleClick(_)
            | ControlAction::MouseMove(..)
            | ControlAction::RunAppleScript(_)
            | ControlAction::ReadClipboard
            | ControlAction::WriteClipboard(_) => None,
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
            ControlAction::Scroll { direction, amount } => format!("scroll {direction} {amount}"),
            ControlAction::Drag { from, to } => {
                format!(
                    "drag from {} to {}",
                    describe_target(from),
                    describe_target(to)
                )
            }
            ControlAction::RightClick(t) => format!("right-click {}", describe_target(t)),
            ControlAction::DoubleClick(t) => format!("double-click {}", describe_target(t)),
            ControlAction::MouseMove(x, y) => format!("move mouse to ({x:.0}, {y:.0})"),
            ControlAction::RunAppleScript(s) => {
                let one = s.replace('\n', " ");
                let short: String = one.chars().take(60).collect();
                if one.chars().count() > 60 {
                    format!("run AppleScript: {short}…")
                } else {
                    format!("run AppleScript: {short}")
                }
            }
            ControlAction::ReadClipboard => "read the clipboard".into(),
            ControlAction::WriteClipboard(_) => "copy to the clipboard".into(),
        }
    }
}

/// A short phrase for a click target, shared by the pointer-action descriptions.
fn describe_target(t: &ClickTarget) -> String {
    match t {
        ClickTarget::Element(id) => format!("element {id}"),
        ClickTarget::Coord(x, y) => format!("({x:.0}, {y:.0})"),
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
    /// The user's latest gaze point (normalised `[0,1]`), if the bridge has one.
    ///
    /// This is the SEAM that lets gaze enter the control loop. Default `None`:
    /// a bridge with no eye-tracking feed behaves exactly as before (no
    /// gaze-focus block). The macOS app — which owns the gaze tracker AND the
    /// AX snapshot — is what overrides this to supply live gaze; until it does,
    /// every bridge returns `None`. Best-effort context, never load-bearing:
    /// the loop never blocks on it and treats any error as "no gaze".
    ///
    /// [user]/app-side follow-up: feed live gaze (answer `{"kind":"gaze"}` with
    /// the latest normalised point; see [`crate::gaze_focus`]).
    async fn gaze(&self) -> Option<eri_coreutils::services::gaze::GazePoint> {
        None
    }
    async fn click(&self, target: &ClickTarget) -> Result<String>;
    async fn type_text(&self, text: &str) -> Result<String>;
    async fn key(&self, combo: &str) -> Result<String>;
    async fn open_app(&self, name: &str) -> Result<String>;
    async fn quit_app(&self, name: &str) -> Result<String>;
    /// Scroll the focused view. Default: unsupported (override per bridge).
    async fn scroll(&self, _direction: &str, _amount: i64) -> Result<String> {
        anyhow::bail!("scroll not supported by this bridge")
    }
    /// Press-drag-release between two points. Default: unsupported.
    async fn drag(&self, _from: &ClickTarget, _to: &ClickTarget) -> Result<String> {
        anyhow::bail!("drag not supported by this bridge")
    }
    /// Secondary (right) click. Default: unsupported.
    async fn right_click(&self, _target: &ClickTarget) -> Result<String> {
        anyhow::bail!("right-click not supported by this bridge")
    }
    /// Double click. Default: unsupported.
    async fn double_click(&self, _target: &ClickTarget) -> Result<String> {
        anyhow::bail!("double-click not supported by this bridge")
    }
    /// Move the pointer without clicking. Default: unsupported.
    async fn mouse_move(&self, _x: f32, _y: f32) -> Result<String> {
        anyhow::bail!("move-mouse not supported by this bridge")
    }
    /// Run an AppleScript / Apple Event (Tier-1 semantic control). Default:
    /// unsupported — only the live macOS bridge implements it.
    async fn run_applescript(&self, _script: &str) -> Result<String> {
        anyhow::bail!("AppleScript not supported by this bridge")
    }
    /// Read the system clipboard (the cross-app bus). Default: unsupported.
    async fn read_clipboard(&self) -> Result<String> {
        anyhow::bail!("clipboard not supported by this bridge")
    }
    /// Write text to the system clipboard. Default: unsupported.
    async fn write_clipboard(&self, _text: &str) -> Result<String> {
        anyhow::bail!("clipboard not supported by this bridge")
    }
    /// Capture a RECTANGULAR REGION of the screen as a base64 PNG (raw — caller
    /// must redact before any cloud send). A tighter, cheaper alternative to a
    /// full-screen `capture` when eri only needs one area (a chart, a snippet).
    /// Default: unsupported.
    async fn capture_region(&self, _x: i64, _y: i64, _w: i64, _h: i64) -> Result<String> {
        anyhow::bail!("region capture not supported by this bridge")
    }
}

/// Outcome of submitting an action to the gate.
#[derive(Clone, Debug, PartialEq)]
pub enum Disposition {
    /// Action ran; carries the bridge's result string.
    Executed(String),
    /// Action is risky and was held; carries the description to confirm.
    NeedsConfirmation(String),
    /// Action is something eri must never do (password/money/CAPTCHA/access
    /// control). It was NOT run; carries the spoken hand-back message. Unlike
    /// `NeedsConfirmation`, "yes" cannot unlock this — the user must do it.
    Refused(String),
}

/// Gates risky actions behind explicit confirmation, refuses sensitive ones
/// outright, and honors a persisted permission allowlist. `auto_confirm` exists
/// for non-interactive/headless runs and tests; the interactive default is
/// false. Refusals always apply, even with `auto_confirm` — they are not a
/// confirmation, they are a boundary.
#[derive(Clone, Debug, Default)]
pub struct ControlGate {
    auto_confirm: bool,
    permissions: crate::control_safety::PermissionStore,
    /// When set, risky actions are confirmed regardless of the granted allowlist.
    /// Used for the unattended remote channel — a permission the user granted at
    /// their keyboard must NOT auto-run a risky action triggered from their phone
    /// (security C1). The app denylist + refusals still apply.
    force_confirm_risky: bool,
    /// The signed-in user this gate acts for (`None` = anonymous / signed-out).
    /// Scopes the predict step's world-model read to one graph (ADR-0007), so a
    /// gate decision can consult the SAME world model the user's memory lives in.
    user_id: Option<String>,
    /// The action that last executed in an EARLIER turn — the cross-turn
    /// predecessor the predict step checks chain corroboration against ("after X
    /// last turn you do Y"), the common one-action-per-turn pattern that
    /// within-turn `prev` can't see. Seeded once per turn by `drive_control_loop`
    /// (the same `last_action` the proactive-chain FEED tracks). `Arc<Mutex>` so
    /// the loop updates it through the shared `&ControlGate`; a cloned gate shares
    /// the cell (only the loop writes). Anonymous gates never read it.
    last_action: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}

impl ControlGate {
    /// Build a gate with a pre-loaded permission allowlist (granted categories
    /// skip the per-action confirm). Use `ControlGate::default()` for an empty,
    /// confirm-everything gate.
    pub fn with_permissions(
        auto_confirm: bool,
        permissions: crate::control_safety::PermissionStore,
    ) -> Self {
        Self {
            auto_confirm,
            permissions,
            force_confirm_risky: false,
            user_id: None,
            last_action: Default::default(),
        }
    }

    /// Scope this gate to the signed-in user, so the predict step reads that
    /// user's world model (`None` = anonymous). Chainable; identity otherwise.
    pub fn with_user(mut self, user_id: Option<String>) -> Self {
        self.user_id = user_id;
        self
    }

    /// The user this gate acts for (`None` = anonymous), for the predict step's
    /// user-scoped world-model read.
    pub fn user_id(&self) -> Option<&str> {
        self.user_id.as_deref()
    }

    /// Seed the cross-turn predecessor the predict step reads — the action that
    /// executed in the prior turn. Called once per turn by the control loop.
    /// Best-effort: a poisoned lock is ignored (the forecast simply falls back to
    /// within-turn `prev`).
    pub fn set_last_action(&self, action: Option<String>) {
        if let Ok(mut slot) = self.last_action.lock() {
            *slot = action;
        }
    }

    /// The cross-turn predecessor action, if any, for the predict step's chain
    /// corroboration.
    pub fn last_action(&self) -> Option<String> {
        self.last_action.lock().ok().and_then(|slot| slot.clone())
    }

    /// Build a gate for the **unattended remote channel**: never auto-confirms,
    /// and granted permissions do NOT let risky actions run (every risky action
    /// is bounced to the phone). The app denylist is kept so "stay out of X"
    /// still blocks (security C1).
    pub fn for_remote(permissions: crate::control_safety::PermissionStore) -> Self {
        Self {
            auto_confirm: false,
            permissions,
            force_confirm_risky: true,
            user_id: None,
            last_action: Default::default(),
        }
    }

    /// Whether an action matches a **known/allowed pattern** — the confirmation
    /// envelope's familiarity signal (ADR-0008 Q18). A learned caution un-knows
    /// any action (the user kept undoing it); otherwise an action that needs a
    /// permission is known once it's granted, and one that needs none is
    /// inherently allowed. Read-only; used by the predict→gate shadow.
    pub fn is_known_pattern(&self, action: &ControlAction) -> bool {
        if self.permissions.is_cautioned(&action.describe()) {
            return false;
        }
        match action.permission() {
            Some(p) => self.permissions.is_granted(p),
            None => true,
        }
    }

    /// Submit an action with the **attended** default confidence (1.0) — the call
    /// shape for paths that have no per-action forecast (coding tools, the remote
    /// channel, tests). Delegates to [`submit_confident`](Self::submit_confident);
    /// at confidence 1.0 a reversible+known action runs, matching the pre-flip
    /// behavior.
    pub async fn submit(
        &self,
        bridge: &dyn ControlBridge,
        action: &ControlAction,
    ) -> Result<Disposition> {
        self.submit_confident(bridge, action, 1.0).await
    }

    /// The **single decision path** of the predict→gate→act cycle (P2 #1 — flip +
    /// unify, ADR-0006/0007 §4). Order, each a hard guarantee:
    ///
    /// 1. **Refuse** denied apps + sensitive actions (password/money/CAPTCHA/
    ///    access control) — never run; absolute and independent of confidence or
    ///    grants. "Yes" can't unlock these.
    /// 2. **Confirm** learned cautions, and risky/irreversible actions unless the
    ///    user granted that permission (the allowlist) or `auto_confirm` is set.
    /// 3. **Auto-execute** a reversible action ONLY when the predict step is
    ///    confident (`confidence >= floor`) AND it's a known pattern
    ///    ([`is_known_pattern`](Self::is_known_pattern)); otherwise ask. This is
    ///    the confidence axis the shadow envelope calibrated — it only ADDS
    ///    caution on uncertain reversible actions; it never weakens (1) or (2).
    pub async fn submit_confident(
        &self,
        bridge: &dyn ControlBridge,
        action: &ControlAction,
        confidence: f32,
    ) -> Result<Disposition> {
        // (0) App denylist — the user said "don't touch this app." A hard
        // boundary like a refusal: not run, and "yes" can't unlock it; only
        // removing the app from the denylist does.
        if let Some(app) = action.target_app()
            && self.permissions.is_app_denied(app)
        {
            return Ok(Disposition::Refused(format!(
                "You asked me to stay out of {app}, so I won't open or touch it. \
                 Tell me \"you can use {app} again\" if you want to change that."
            )));
        }
        // (1) Refusal — the independent, absolute axis. Check typed text (and
        // AppleScript source) against the sensitive-action classifier. A script
        // that types a password or moves money is refused exactly like a literal
        // keystroke would be. Never overridden by confidence or a grant.
        let sensitive_text = match action {
            ControlAction::Type(t) | ControlAction::RunAppleScript(t) => Some(t.as_str()),
            _ => None,
        };
        if let Some(text) = sensitive_text
            && let Some(kind) = crate::control_safety::classify_refusal(text)
        {
            return Ok(Disposition::Refused(kind.handback_message().to_string()));
        }
        // (1.5) P8 learned caution — the user kept UNDOING this exact action, so
        // eri asks first next time even when it's otherwise allowed (a granted
        // permission does NOT skip a learned caution). Meta-Policy Reflexion.
        if !self.auto_confirm && self.permissions.is_cautioned(&action.describe()) {
            return Ok(Disposition::NeedsConfirmation(action.describe()));
        }
        // (2) Explicit authorization bypasses the envelope: an `auto_confirm` run
        // (headless / --yes), or a risky action the user granted in the allowlist,
        // runs without asking. In remote mode (`force_confirm_risky`) a grant never
        // bypasses — an unattended risky action always bounces to the phone
        // (security C1, M1).
        let risky = if self.force_confirm_risky {
            action.is_risky_remote()
        } else {
            action.is_risky()
        };
        if self.auto_confirm {
            return Ok(Disposition::Executed(apply(bridge, action).await?));
        }
        if risky
            && !self.force_confirm_risky
            && action
                .permission()
                .is_some_and(|p| self.permissions.is_granted(p))
        {
            return Ok(Disposition::Executed(apply(bridge, action).await?));
        }
        // (3) The confirmation envelope is the decision (ADR-0006/0007 §4): a
        // reversible action auto-runs only when the forecast is confident AND it's
        // a known pattern; a risky/irreversible one always asks; refusal is the
        // envelope's independent override (already enforced at (1)). Reversibility
        // is the authoritative per-variant risk classification, so benign pointer
        // actions aren't penalized by a text heuristic.
        let prediction = crate::control_envelope::Prediction {
            reversibility: if risky {
                crate::control_envelope::Reversibility::Irreversible
            } else {
                crate::control_envelope::Reversibility::Reversible
            },
            confidence,
            known: self.is_known_pattern(action),
        };
        match crate::control_envelope::gate(
            sensitive_text.unwrap_or(""),
            &prediction,
            crate::control_envelope::DEFAULT_CONFIDENCE_FLOOR,
        ) {
            crate::control_envelope::Decision::AutoExecute => {
                Ok(Disposition::Executed(apply(bridge, action).await?))
            }
            crate::control_envelope::Decision::Refuse(kind) => {
                Ok(Disposition::Refused(kind.handback_message().to_string()))
            }
            crate::control_envelope::Decision::Confirm => {
                Ok(Disposition::NeedsConfirmation(action.describe()))
            }
        }
    }

    /// Run a previously-held action after the user said yes. Refusals can never
    /// reach here (the gate never returns `NeedsConfirmation` for them), so this
    /// stays a thin pass-through.
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

/// Does this clickable element's label look outward-facing / irreversible —
/// something that should be confirmed when clicked unattended over remote
/// control (review M1)? Conservative substring match on the element's label.
fn looks_outward_facing(label: &str) -> bool {
    let l = label.to_lowercase();
    const NEEDLES: &[&str] = &[
        "send",
        "post",
        "publish",
        "tweet",
        "reply all",
        "delete",
        "remove",
        "discard",
        "confirm",
        "pay",
        "buy",
        "order",
        "purchase",
        "checkout",
        "submit",
        "transfer",
        "withdraw",
    ];
    NEEDLES.iter().any(|n| l.contains(n))
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
        ControlAction::Scroll { direction, amount } => bridge.scroll(direction, *amount).await,
        ControlAction::Drag { from, to } => bridge.drag(from, to).await,
        ControlAction::RightClick(t) => bridge.right_click(t).await,
        ControlAction::DoubleClick(t) => bridge.double_click(t).await,
        ControlAction::MouseMove(x, y) => bridge.mouse_move(*x, *y).await,
        ControlAction::RunAppleScript(s) => bridge.run_applescript(s).await,
        ControlAction::ReadClipboard => bridge.read_clipboard().await,
        ControlAction::WriteClipboard(s) => bridge.write_clipboard(s).await,
    }
}

/// Parse an element-id-or-coordinates target from a JSON object. Shared by the
/// click/right_click/double_click/drag tools so the target shape can't drift
/// between them. `what` names the caller for a clear error.
fn parse_click_target(input: &Value, what: &str) -> Result<ClickTarget> {
    if let Some(id) = input.get("element").and_then(Value::as_str) {
        Ok(ClickTarget::Element(id.to_string()))
    } else if let (Some(x), Some(y)) = (
        input.get("x").and_then(Value::as_f64),
        input.get("y").and_then(Value::as_f64),
    ) {
        Ok(ClickTarget::Coord(x as f32, y as f32))
    } else {
        Err(anyhow!("{what} needs `element` or `x`+`y`"))
    }
}

/// Parse a model tool call `(name, input)` into a [`ControlAction`].
pub fn parse_action(name: &str, input: &Value) -> Result<ControlAction> {
    let s = |k: &str| input.get(k).and_then(Value::as_str).map(str::to_string);
    match name {
        "screen_observe" => Ok(ControlAction::Observe),
        "click" => parse_click_target(input, "click").map(ControlAction::Click),
        "right_click" => parse_click_target(input, "right_click").map(ControlAction::RightClick),
        "double_click" => parse_click_target(input, "double_click").map(ControlAction::DoubleClick),
        "scroll" => {
            let direction = s("direction").ok_or_else(|| anyhow!("scroll needs `direction`"))?;
            let direction = direction.to_lowercase();
            if !matches!(direction.as_str(), "up" | "down" | "left" | "right") {
                return Err(anyhow!(
                    "scroll `direction` must be up/down/left/right, got {direction:?}"
                ));
            }
            let amount = input
                .get("amount")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow!("scroll needs integer `amount`"))?;
            if amount <= 0 {
                return Err(anyhow!("scroll `amount` must be positive, got {amount}"));
            }
            Ok(ControlAction::Scroll { direction, amount })
        }
        "drag" => {
            let from = input
                .get("from")
                .ok_or_else(|| anyhow!("drag needs `from`"))?;
            let to = input.get("to").ok_or_else(|| anyhow!("drag needs `to`"))?;
            Ok(ControlAction::Drag {
                from: parse_click_target(from, "drag `from`")?,
                to: parse_click_target(to, "drag `to`")?,
            })
        }
        "move_mouse" => {
            if let (Some(x), Some(y)) = (
                input.get("x").and_then(Value::as_f64),
                input.get("y").and_then(Value::as_f64),
            ) {
                Ok(ControlAction::MouseMove(x as f32, y as f32))
            } else {
                Err(anyhow!("move_mouse needs `x`+`y`"))
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
        "run_applescript" => s("script")
            .map(ControlAction::RunAppleScript)
            .ok_or_else(|| anyhow!("run_applescript needs `script`")),
        "read_clipboard" => Ok(ControlAction::ReadClipboard),
        "write_clipboard" => s("text")
            .map(ControlAction::WriteClipboard)
            .ok_or_else(|| anyhow!("write_clipboard needs `text`")),
        other => Err(anyhow!("unknown control tool: {other}")),
    }
}

/// The control tool specs advertised to the model. Accessibility-first: the
/// description steers the model to `screen_observe` then click elements by id.
/// The coding-environment tools ([`crate::coding_control`]) are appended so the
/// model can drive a code editor (open files, run palette commands, steer the
/// AI chat) on top of the primitive computer-control surface.
pub fn tool_specs() -> Vec<Value> {
    let mut specs = primitive_tool_specs();
    specs.extend(crate::coding_control::coding_tool_specs());
    specs
}

/// The primitive computer-control tools (observe/click/type/key/…). Kept as its
/// own function so [`tool_specs`] can layer the coding tools on top without this
/// list growing a coding concern.
fn primitive_tool_specs() -> Vec<Value> {
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
        json!({
            "name": "scroll",
            "description": "Scroll the focused view to bring offscreen content into view. Use after screen_observe shows what you need isn't visible yet.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "direction": { "type": "string", "enum": ["up", "down", "left", "right"] },
                    "amount": { "type": "integer", "description": "How far to scroll (positive). Roughly notches/clicks." }
                },
                "required": ["direction", "amount"]
            }
        }),
        json!({
            "name": "drag",
            "description": "Press, move, and release the pointer from one point to another — to move a slider, drag a file, or select a range. Give from and to as an element id or x,y.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "from": {
                        "type": "object",
                        "properties": {
                            "element": { "type": "string", "description": "Element id from screen_observe." },
                            "x": { "type": "number" },
                            "y": { "type": "number" }
                        }
                    },
                    "to": {
                        "type": "object",
                        "properties": {
                            "element": { "type": "string", "description": "Element id from screen_observe." },
                            "x": { "type": "number" },
                            "y": { "type": "number" }
                        }
                    }
                },
                "required": ["from", "to"]
            }
        }),
        json!({
            "name": "right_click",
            "description": "Right-click (secondary click) a UI element by its id, or x,y coordinates, to open its context menu.",
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
            "name": "double_click",
            "description": "Double-click a UI element by its id, or x,y coordinates, to open or activate it.",
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
            "name": "move_mouse",
            "description": "Move the pointer to screen coordinates x,y without clicking — e.g. to hover and reveal something.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" },
                    "y": { "type": "number" }
                },
                "required": ["x", "y"]
            }
        }),
        json!({
            "name": "run_applescript",
            "description": "Run an AppleScript command to control a native macOS app SEMANTICALLY (Apple Events) — e.g. `tell application \"TextEdit\" to make new document`, compose a Mail message, set or get a field's text. PREFER this over clicking/typing for native apps that support AppleScript: it's exact and avoids dialogs (a real new document, not an Open panel; clean field replacement, not blind typing). Not for secrets or destructive commands.",
            "input_schema": {
                "type": "object",
                "properties": { "script": { "type": "string", "description": "AppleScript source to execute." } },
                "required": ["script"]
            }
        }),
        json!({
            "name": "read_clipboard",
            "description": "Read the system clipboard as text — the cross-app bus. Use to carry something you grabbed in one app (a value, a snippet) into another.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "write_clipboard",
            "description": "Put text on the system clipboard so it can be pasted (cmd+v) into another app — the other half of moving content across apps.",
            "input_schema": {
                "type": "object",
                "properties": { "text": { "type": "string", "description": "Text to place on the clipboard." } },
                "required": ["text"]
            }
        }),
        json!({
            "name": "capture_region",
            "description": "Capture a RECTANGULAR REGION of the screen as an image (faces auto-blurred). Cheaper + more focused than `look` when you only need one area — e.g. read a chart or copy a value from a specific spot. x,y = top-left; w,h = size in screen points.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number" }, "y": { "type": "number" },
                    "w": { "type": "number" }, "h": { "type": "number" }
                },
                "required": ["x", "y", "w", "h"]
            }
        }),
    ]
}

/// The API tier inside the control loop: connector (MCP / Composio Tool Router)
/// tools the model can call ALONGSIDE the computer-control primitives, so one
/// agentic run can stitch "read this email (API) → screenshot a chart (screen) →
/// reply (API)". A tiny seam so the loop never depends on `eri_mcp`/build_agent
/// types directly (tests pass `None`; the live adapter wraps the MCP client).
#[async_trait::async_trait]
pub trait McpDispatch: Send + Sync {
    /// Is this tool name one of the connected MCP/connector tools?
    fn handles(&self, tool_name: &str) -> bool;
    /// Run it; returns `(result_text, is_error)`. Errors come back as text the
    /// model can react to, never a panic.
    async fn call(&self, tool_name: &str, input: &Value) -> (String, bool);
}

/// Heuristic: does this connector call act OUTWARD / mutate (send, post, pay,
/// delete, create…) vs just read? Outward calls are confirmed before they fire
/// so an unattended "send the email" can't go out silently. Checks the tool name
/// AND the payload, because the Tool Router's execute meta-tool carries the real
/// action slug (e.g. `GMAIL_SEND_EMAIL`) in its arguments, not its own name.
/// Generous by design — a false "confirm" is safe; a missed outward action isn't.
pub(crate) fn mcp_is_outward(tool_name: &str, input: &Value) -> bool {
    const OUTWARD: &[&str] = &[
        "SEND", "CREATE", "DELETE", "REPLY", "POST", "PUBLISH", "UPDATE", "REMOVE", "MOVE",
        "ARCHIVE", "TRASH", "PAY", "TRANSFER", "INVITE", "UPSERT", "WRITE", "DRAFT", "ADD", "EDIT",
        "MERGE", "CLOSE", "CANCEL", "SCHEDULE",
    ];
    let hay = format!("{tool_name} {input}").to_uppercase();
    OUTWARD.iter().any(|verb| hay.contains(verb))
}

/// Where a goal can run — the cloud-vs-local routing seam (Phase 5). API-able
/// work runs server-side and so works **with the computer off** (the phone/cloud
/// path, via the same connectors); UI work needs the local machine's screen.
/// `Mixed` needs both (e.g. screenshot a chart locally, then email it via API).
/// Pure + heuristic; the router / cloud path consults it to decide "can eri do
/// this without the computer on?". Conservative: unknown → `Local` (don't
/// promise computer-off work we can't guarantee).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    Api,
    Local,
    Mixed,
}

pub(crate) fn classify_reach(goal: &str) -> Reach {
    let g = goal.to_lowercase();
    const API: &[&str] = &[
        "email",
        "gmail",
        "inbox",
        "calendar",
        "schedule",
        "meeting",
        "invite",
        "github",
        "pull request",
        " pr ",
        "issue",
        "slack",
        "message",
        "dm ",
        "notion",
        "reply",
        "send",
        "draft",
        "linear",
        "ticket",
        "spreadsheet",
        "sheet",
        "drive",
        "event",
        "post ",
    ];
    // Concrete screen cues only — avoid broad phrases like "what's on" that also
    // match "what's on my calendar" (which is API, not local).
    const LOCAL: &[&str] = &[
        "screen",
        "window",
        "click",
        "scroll",
        "this app",
        "highlight",
        "the button",
        "type into",
        "drag",
        "cursor",
        "desktop",
        "finder",
        "textedit",
        "menu bar",
        "this page",
    ];
    let api = API.iter().any(|k| g.contains(k));
    let local = LOCAL.iter().any(|k| g.contains(k));
    match (api, local) {
        (true, true) => Reach::Mixed,
        (true, false) => Reach::Api,
        _ => Reach::Local,
    }
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
    /// Descriptions of the actions that actually **executed** this step, in order
    /// — the input to the world-model proactive chain (P2: `observe_transition`).
    /// Excludes refused/declined/failed actions.
    pub executed: Vec<String>,
}

/// The predecessor the predict step checks an action's chain corroboration
/// against: the action that executed earlier THIS turn (`within_turn`), else the
/// cross-turn `last_action` the gate carries. Mirrors how the proactive-chain
/// FEED records consecutive executed pairs, so what predict anticipates lines up
/// with what the chain learned.
fn predict_prev<'a>(within_turn: Option<&'a str>, cross_turn: Option<&'a str>) -> Option<&'a str> {
    within_turn.or(cross_turn)
}

/// Execute one turn's tool calls through the gate + bridge. Risky actions are
/// confirmed via `confirm(description) -> bool` (interactive: prompt stdin;
/// tests: a canned closure). Shared by the live loop and the unit tests, so the
/// gate/confirm/error logic has exactly one implementation.
pub async fn execute_tool_calls(
    bridge: &dyn ControlBridge,
    gate: &ControlGate,
    confirm: &mut dyn FnMut(&str, Option<crate::control_safety::Permission>) -> bool,
    mcp: Option<&dyn McpDispatch>,
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
        // `capture_region`: like `look` but a single rectangle — capture, REDACT
        // faces locally, return the redacted image. Same fail-closed contract.
        if name == "capture_region" {
            let g = |k: &str| input.get(k).and_then(Value::as_i64);
            let (Some(x), Some(y), Some(w), Some(h)) = (g("x"), g("y"), g("w"), g("h")) else {
                out.results
                    .push(tool_result(id, "capture_region needs x, y, w, h", true));
                continue;
            };
            out.results
                .push(match bridge.capture_region(x, y, w, h).await {
                    Ok(b64) => match redact_png(&b64).await {
                        Ok(redacted) => {
                            out.log.push("looked at a region of the screen".into());
                            image_tool_result(id, &redacted)
                        }
                        Err(e) => tool_result(
                            id,
                            &format!(
                                "refused: could not redact the capture ({e}); not sending it."
                            ),
                            true,
                        ),
                    },
                    Err(e) => tool_result(id, &format!("region capture failed: {e}"), true),
                });
            continue;
        }
        // Coding-environment tools (`editor_*`): a single tool call lowers to a
        // sequence of primitive actions (Key/Type), each run THROUGH the same
        // gate — so a palette command typing something destructive still trips
        // the content-aware risk check. One tool_result summarises the sequence.
        if crate::coding_control::is_coding_tool(name) {
            run_coding_tool(bridge, gate, confirm, id, name, input, &mut out).await;
            continue;
        }
        // Connector (MCP / Composio) tools — the API tier. Outward/mutating calls
        // (send, post, pay, …) confirm first so an unattended action can't fire
        // silently; reads pass straight through. Routed through the SAME confirm
        // the gate uses, so `--yes` auto-confirms and interactive prompts.
        if let Some(m) = mcp
            && m.handles(name)
        {
            if mcp_is_outward(name, input)
                && !confirm(&format!("use a connected app: {name}"), None)
            {
                out.log.push(format!("declined: {name}"));
                out.results
                    .push(tool_result(id, "user declined this action", false));
                continue;
            }
            let (text, is_error) = m.call(name, input).await;
            // Connectors are invisible plumbing — log generically, never the
            // server-qualified tool name, to the user-facing trail.
            out.log.push("used a connected app".to_string());
            out.results.push(tool_result(id, &text, is_error));
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
        // P2 #1 (flip + unify, ADR-0007 §4): ONE decision path — the confirmation
        // envelope IS the gate. The predict step forecasts the per-action
        // confidence that drives the auto-execute-vs-confirm decision inside
        // `submit_confident`; the absolute refusal axis stays enforced there too.
        //
        // The forecast blends the engine's self-report with a real read of the
        // world model (ADR-0007 §4): is this an established next step after the
        // last one (the proactive chain), and does it name a known entity. That
        // corroboration can only RAISE confidence. We read the world model only
        // for the signed-in user (`gate.user_id()`); signed-out → the engine's
        // own number, no IO. `prev` is the previously executed action this turn,
        // else the cross-turn predecessor the loop seeded on the gate — so the
        // common one-action-per-turn pattern ("after X last turn you do Y") still
        // corroborates.
        let model_confidence = crate::predict::forecast_confidence(input);
        let (expected, grounded) = match gate.user_id() {
            Some(uid) => {
                let cross_turn = gate.last_action();
                let prev = predict_prev(
                    out.executed.last().map(String::as_str),
                    cross_turn.as_deref(),
                );
                crate::predict::anticipate(Some(uid), prev, &action)
            }
            None => (false, false),
        };
        let confidence = crate::predict::forecast(model_confidence, expected, grounded);
        let disposition = gate.submit_confident(bridge, &action, confidence).await;
        match disposition {
            Ok(Disposition::Executed(result)) => {
                out.log.push(format!("{} -> {result}", action.describe()));
                out.executed.push(action.describe());
                out.results.push(tool_result(id, &result, false));
            }
            Ok(Disposition::Refused(message)) => {
                // A boundary, not a failure: eri won't do this, and tells the
                // user why. Feed the handback back to the model (not an error)
                // so it relays the message and waits for the user instead of
                // retrying. The retracted/blocked intent is NOT recorded as a
                // goal eri is pursuing.
                out.log
                    .push(format!("refused: {} — {message}", action.describe()));
                out.results.push(tool_result(
                    id,
                    &format!("REFUSED (hand back to the user): {message}"),
                    false,
                ));
            }
            Ok(Disposition::NeedsConfirmation(desc)) => {
                if confirm(&desc, action.permission()) {
                    match gate.confirm(bridge, &action).await {
                        Ok(result) => {
                            out.log.push(format!("confirmed: {desc} -> {result}"));
                            out.executed.push(action.describe());
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

/// Execute one coding-environment tool call: parse it, lower it to its primitive
/// action sequence, and run each primitive through the gate in order. The whole
/// sequence collapses into a single `tool_result` for the model. Sequencing is
/// strict: if any primitive is refused or the user declines a confirmation, the
/// REMAINING keystrokes are dropped — half a sequence (e.g. ⌘P with no path) is
/// safer than blindly continuing to type into the wrong place.
async fn run_coding_tool(
    bridge: &dyn ControlBridge,
    gate: &ControlGate,
    confirm: &mut dyn FnMut(&str, Option<crate::control_safety::Permission>) -> bool,
    id: &str,
    name: &str,
    input: &Value,
    out: &mut StepOutcome,
) {
    let coding = match crate::coding_control::parse_coding_action(name, input) {
        Ok(c) => c,
        Err(e) => {
            out.log.push(format!("bad coding tool {name}: {e}"));
            out.results
                .push(tool_result(id, &format!("error: {e}"), true));
            return;
        }
    };
    let mut step_results: Vec<String> = Vec::new();
    for action in coding.lower() {
        match gate.submit(bridge, &action).await {
            Ok(Disposition::Executed(result)) => {
                out.log.push(format!("{} -> {result}", action.describe()));
                step_results.push(result);
            }
            Ok(Disposition::Refused(message)) => {
                // A boundary inside the sequence (e.g. a destructive palette
                // command). Hand back and abandon the rest — don't keep typing.
                out.log
                    .push(format!("refused: {} — {message}", coding.describe()));
                out.results.push(tool_result(
                    id,
                    &format!("REFUSED (hand back to the user): {message}"),
                    false,
                ));
                return;
            }
            Ok(Disposition::NeedsConfirmation(desc)) => {
                if confirm(&desc, action.permission()) {
                    match gate.confirm(bridge, &action).await {
                        Ok(result) => {
                            out.log.push(format!("confirmed: {desc} -> {result}"));
                            step_results.push(result);
                        }
                        Err(e) => {
                            out.log.push(format!("confirm failed: {e}"));
                            out.results
                                .push(tool_result(id, &format!("error: {e}"), true));
                            return;
                        }
                    }
                } else {
                    out.log.push(format!("declined: {desc}"));
                    out.results
                        .push(tool_result(id, "user declined this action", false));
                    return;
                }
            }
            Err(e) => {
                // Don't just report "error" — hand the model eri's recovery brain:
                // look at the screen, diagnose the blocker (frozen / popup / still
                // working), recover like a person — or STOP and hand back if it's an
                // API limit or a login prompt eri can't resolve itself.
                out.log.push(format!("{} failed: {e}", coding.describe()));
                out.results.push(tool_result(
                    id,
                    &crate::coding_agent::recovery_directive(&e.to_string()),
                    true,
                ));
                return;
            }
        }
    }
    out.results.push(tool_result(
        id,
        &format!("{} ({})", coding.describe(), step_results.join("; ")),
        false,
    ));
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
coordinates. Use open_app to launch/focus apps. For native apps that support \
AppleScript, PREFER run_applescript for semantic actions (make a new document, \
compose mail, set/get a field's value) -- it's exact and avoids the dialogs and \
mishaps blind clicking/typing cause (a real new document, not an Open panel). \
Keep steps minimal -- do not take unnecessary actions. When the goal is achieved, call done with a one-line \
summary. Be efficient: observe only when state may have changed.\n\
TYPE CAREFULLY: a field may ALREADY contain text. Before typing, check what is \
there (the snapshot/look shows it). Don't blindly insert at the cursor and mash \
your text onto existing content. Decide deliberately: to replace it, select all \
(cmd+a) then type; to add to it, position the cursor and add a separator \
(space/newline) first; for a fresh start, open a new document/compose window. \
The same applies to search bars, address bars, and reply boxes that may hold a \
draft.\n\n\
SAFETY (the harness enforces these in code; your job is to behave consistently \
with them and narrate clearly):\n\
- STOP/CANCEL: if the user says stop, no, wait, never mind, forget it, or \
otherwise retracts, immediately stop. Do not keep pursuing a retracted request \
or treat it as something they still want. Acknowledge briefly and wait.\n\
- REFUSE, DON'T ASK: you do NOT enter passwords, PINs, 2FA/OTP codes, API keys, \
or other secrets; you do NOT type bank/card/account/SSN/ID numbers; you do NOT \
move money or place financial trades; you do NOT solve CAPTCHAs; you do NOT \
change sharing/permission/security settings. For these, hand it back: tell the \
user plainly that this part is theirs to do, e.g. \"I won't type your password \
-- go ahead and enter it, then tell me to continue,\" and wait. A tool_result \
that begins with REFUSED means exactly this: relay the message and wait.\n\
- CONFIRM RISKY: quitting apps, delete shortcuts, and destructive commands are \
held for confirmation. If a tool_result says the user declined, do not retry; \
move on or ask what they'd prefer. If you keep needing the same confirmation, \
you may suggest they allow it permanently (\"want me to remember I can quit apps \
so I don't ask each time?\").\n\n\
CONFIDENCE: with each tool call, include a `confidence` field -- a number from 0 \
to 1 estimating how likely THAT single action achieves what you intend, given \
what's on screen and what you know about the user. Be calibrated: use >=0.8 only \
when the target is clearly present and the action is unambiguous; lower when \
you're guessing, the element is uncertain, or the step is novel. It does not \
change what runs; it helps eri decide when it can act without interrupting you."
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
            screen: None,
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
    async fn scroll(&self, direction: &str, amount: i64) -> Result<String> {
        Ok(format!("DRY RUN: would scroll {direction} {amount}"))
    }
    async fn drag(&self, from: &ClickTarget, to: &ClickTarget) -> Result<String> {
        Ok(format!("DRY RUN: would drag {from:?} -> {to:?}"))
    }
    async fn right_click(&self, target: &ClickTarget) -> Result<String> {
        Ok(format!("DRY RUN: would right-click {target:?}"))
    }
    async fn double_click(&self, target: &ClickTarget) -> Result<String> {
        Ok(format!("DRY RUN: would double-click {target:?}"))
    }
    async fn mouse_move(&self, x: f32, y: f32) -> Result<String> {
        Ok(format!("DRY RUN: would move mouse to ({x:.0}, {y:.0})"))
    }
    async fn run_applescript(&self, script: &str) -> Result<String> {
        Ok(format!(
            "DRY RUN: would run AppleScript ({} chars)",
            script.len()
        ))
    }
    async fn read_clipboard(&self) -> Result<String> {
        Ok("DRY RUN: would read the clipboard".into())
    }
    async fn write_clipboard(&self, _text: &str) -> Result<String> {
        Ok("DRY RUN: would write the clipboard".into())
    }
    async fn capture_region(&self, _x: i64, _y: i64, _w: i64, _h: i64) -> Result<String> {
        Err(anyhow!("DRY RUN: no screen capture"))
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
        ControlAction::Scroll { direction, amount } => {
            json!({ "kind": "scroll", "direction": direction, "amount": amount })
        }
        ControlAction::Drag { from, to } => {
            json!({ "kind": "drag", "from": target_to_wire(from), "to": target_to_wire(to) })
        }
        ControlAction::RightClick(t) => merge_kind("right_click", target_to_wire(t)),
        ControlAction::DoubleClick(t) => merge_kind("double_click", target_to_wire(t)),
        ControlAction::MouseMove(x, y) => json!({ "kind": "move_mouse", "x": x, "y": y }),
        ControlAction::RunAppleScript(s) => json!({ "kind": "run_applescript", "script": s }),
        ControlAction::ReadClipboard => json!({ "kind": "read_clipboard" }),
        ControlAction::WriteClipboard(s) => json!({ "kind": "write_clipboard", "text": s }),
    }
}

/// Serialize a click target to its wire fields (`{"element": id}` or
/// `{"x":..,"y":..}`). Used inside drag's nested from/to and by right/double
/// click (merged with a `kind`).
fn target_to_wire(t: &ClickTarget) -> Value {
    match t {
        ClickTarget::Element(id) => json!({ "element": id }),
        ClickTarget::Coord(x, y) => json!({ "x": x, "y": y }),
    }
}

/// Merge a `kind` discriminator into a target's wire object so right/double
/// click serialize like `click` does (flat element-or-coords + a kind).
fn merge_kind(kind: &str, mut target: Value) -> Value {
    if let Some(obj) = target.as_object_mut() {
        obj.insert("kind".to_string(), json!(kind));
    }
    target
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

/// A [`ControlBridge`] that records every successful MUTATING action eri
/// performs to a shared [`ActionLog`] — the trust layer's capture seam. It wraps
/// any inner bridge (Http/DryRun/Mock), so recording is uniform across BOTH the
/// zero-token fast lane and the reasoning loop without touching the gate, the
/// executor, or the prelude. Read-only calls (snapshot/capture) aren't recorded;
/// an action is logged only AFTER the inner bridge confirms it ran.
pub struct LoggingBridge<'a> {
    inner: &'a dyn ControlBridge,
    log: Arc<Mutex<ActionLog>>,
}

impl<'a> LoggingBridge<'a> {
    pub fn new(inner: &'a dyn ControlBridge, log: Arc<Mutex<ActionLog>>) -> Self {
        Self { inner, log }
    }
    fn record(&self, action: ControlAction) {
        if let Ok(mut log) = self.log.lock() {
            log.record(&action);
        }
    }
}

#[async_trait::async_trait]
impl ControlBridge for LoggingBridge<'_> {
    async fn snapshot(&self) -> Result<ScreenGraph> {
        self.inner.snapshot().await
    }
    async fn capture(&self) -> Result<String> {
        self.inner.capture().await
    }
    async fn gaze(&self) -> Option<eri_coreutils::services::gaze::GazePoint> {
        // Read-only ambient context — forwarded unrecorded, like snapshot.
        self.inner.gaze().await
    }
    async fn click(&self, target: &ClickTarget) -> Result<String> {
        let result = self.inner.click(target).await?;
        self.record(ControlAction::Click(target.clone()));
        Ok(result)
    }
    async fn type_text(&self, text: &str) -> Result<String> {
        let result = self.inner.type_text(text).await?;
        self.record(ControlAction::Type(text.to_string()));
        Ok(result)
    }
    async fn key(&self, combo: &str) -> Result<String> {
        let result = self.inner.key(combo).await?;
        self.record(ControlAction::Key(combo.to_string()));
        Ok(result)
    }
    async fn open_app(&self, name: &str) -> Result<String> {
        let result = self.inner.open_app(name).await?;
        self.record(ControlAction::OpenApp(name.to_string()));
        Ok(result)
    }
    async fn quit_app(&self, name: &str) -> Result<String> {
        let result = self.inner.quit_app(name).await?;
        self.record(ControlAction::QuitApp(name.to_string()));
        Ok(result)
    }
    async fn scroll(&self, direction: &str, amount: i64) -> Result<String> {
        let result = self.inner.scroll(direction, amount).await?;
        self.record(ControlAction::Scroll {
            direction: direction.to_string(),
            amount,
        });
        Ok(result)
    }
    async fn drag(&self, from: &ClickTarget, to: &ClickTarget) -> Result<String> {
        let result = self.inner.drag(from, to).await?;
        self.record(ControlAction::Drag {
            from: from.clone(),
            to: to.clone(),
        });
        Ok(result)
    }
    async fn right_click(&self, target: &ClickTarget) -> Result<String> {
        let result = self.inner.right_click(target).await?;
        self.record(ControlAction::RightClick(target.clone()));
        Ok(result)
    }
    async fn double_click(&self, target: &ClickTarget) -> Result<String> {
        let result = self.inner.double_click(target).await?;
        self.record(ControlAction::DoubleClick(target.clone()));
        Ok(result)
    }
    async fn mouse_move(&self, x: f32, y: f32) -> Result<String> {
        let result = self.inner.mouse_move(x, y).await?;
        self.record(ControlAction::MouseMove(x, y));
        Ok(result)
    }
    async fn run_applescript(&self, script: &str) -> Result<String> {
        let result = self.inner.run_applescript(script).await?;
        self.record(ControlAction::RunAppleScript(script.to_string()));
        Ok(result)
    }
    async fn read_clipboard(&self) -> Result<String> {
        // A read — forwarded unrecorded, like snapshot/capture.
        self.inner.read_clipboard().await
    }
    async fn write_clipboard(&self, text: &str) -> Result<String> {
        let result = self.inner.write_clipboard(text).await?;
        self.record(ControlAction::WriteClipboard(text.to_string()));
        Ok(result)
    }
    async fn capture_region(&self, x: i64, y: i64, w: i64, h: i64) -> Result<String> {
        // A read — forwarded unrecorded.
        self.inner.capture_region(x, y, w, h).await
    }
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
    async fn scroll(&self, direction: &str, amount: i64) -> Result<String> {
        self.act(&ControlAction::Scroll {
            direction: direction.to_string(),
            amount,
        })
        .await
    }
    async fn drag(&self, from: &ClickTarget, to: &ClickTarget) -> Result<String> {
        self.act(&ControlAction::Drag {
            from: from.clone(),
            to: to.clone(),
        })
        .await
    }
    async fn right_click(&self, target: &ClickTarget) -> Result<String> {
        self.act(&ControlAction::RightClick(target.clone())).await
    }
    async fn double_click(&self, target: &ClickTarget) -> Result<String> {
        self.act(&ControlAction::DoubleClick(target.clone())).await
    }
    async fn mouse_move(&self, x: f32, y: f32) -> Result<String> {
        self.act(&ControlAction::MouseMove(x, y)).await
    }
    async fn run_applescript(&self, script: &str) -> Result<String> {
        self.act(&ControlAction::RunAppleScript(script.to_string()))
            .await
    }
    async fn read_clipboard(&self) -> Result<String> {
        self.act(&ControlAction::ReadClipboard).await
    }
    async fn write_clipboard(&self, text: &str) -> Result<String> {
        self.act(&ControlAction::WriteClipboard(text.to_string()))
            .await
    }
    async fn capture_region(&self, x: i64, y: i64, w: i64, h: i64) -> Result<String> {
        let reply = self
            .post(json!({ "kind": "capture_region", "x": x, "y": y, "w": w, "h": h }))
            .await?;
        parse_wire_capture(&reply)
    }
    /// Ask the app for the user's latest gaze point. Best-effort: any transport
    /// error or a reply without a usable point yields `None` (the loop then
    /// runs with no gaze-focus block, exactly as before). Never propagates an
    /// error — gaze is ambient context, not a step the loop depends on.
    async fn gaze(&self) -> Option<eri_coreutils::services::gaze::GazePoint> {
        let reply = self.post(json!({ "kind": "gaze" })).await.ok()?;
        parse_wire_gaze(&reply)
    }
}

/// Parse a gaze reply: `{"gaze": {"x", "y", "confidence", "ts_ms"}}`.
///
/// Returns `None` for an error reply, a missing/empty `gaze` object, or any
/// malformed point — gaze is best-effort, so a bad reply is simply "no gaze"
/// rather than a hard error. `confidence`/`ts_ms` default to sane values so the
/// app only has to send `x`/`y` at minimum.
pub fn parse_wire_gaze(reply: &Value) -> Option<eri_coreutils::services::gaze::GazePoint> {
    use eri_coreutils::services::gaze::GazePoint;
    let g = reply.get("gaze")?;
    if g.is_null() {
        return None;
    }
    let x = g.get("x").and_then(Value::as_f64)?;
    let y = g.get("y").and_then(Value::as_f64)?;
    let confidence = g.get("confidence").and_then(Value::as_f64).unwrap_or(1.0);
    let ts_ms = g.get("ts_ms").and_then(Value::as_u64).unwrap_or(0);
    Some(GazePoint {
        x,
        y,
        confidence,
        ts_ms,
    })
}

/// Build the lower-trust context notes injected into the control loop: (a)
/// remembered facts relevant to the goal (hybrid recall, 0 model tokens), and
/// (b) a single cheap ambient snapshot of what's on screen. All best-effort —
/// any failure just yields fewer notes, never an error.
async fn context_blocks(goal: &str, bridge: &dyn ControlBridge, workspace: &Path) -> Vec<String> {
    let mut blocks = Vec::new();
    if let Ok(mut store) = MemoryStore::open()
        && let Ok(hits) = store.recall_hybrid_with_budget(
            goal,
            workspace,
            crate::memory_tools::RECALL_TOKEN_BUDGET,
        )
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
        // Gaze-focus: if the app is feeding a gaze point, fuse it with this same
        // snapshot to name WHAT the user is looking at, so deictic commands
        // ("click that", "what's this") resolve to the focused element. Reuses
        // the AX snapshot we already fetched — one extra (best-effort) gaze read.
        // No gaze (or no screen bounds) → no focus block, loop behaves as today.
        if let Some(note) = crate::gaze_focus::focus_note(bridge.gaze().await, &graph) {
            blocks.push(note);
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
/// Token-frugal fast lane (Tier 0). Resolve obvious, single-step control goals
/// to a deterministic action plan with **zero model tokens** — "open Spotify",
/// "quit Cursor" must never cost a cloud call. Returns `None` for anything
/// ambiguous or multi-step (those go to the reasoning loop). Conservative by
/// design: only matches a known app so it can never actuate a wrong target.
///
/// This is the cheapest tier of eri's router; the loop consults it before any
/// inference. Still actuated through the gate, so cancellation / refusal / the
/// per-app denylist / confirmation all apply to whatever it produces.
pub fn fast_route(goal: &str) -> Option<Vec<ControlAction>> {
    let g = goal
        .trim()
        .to_lowercase()
        .trim_end_matches(['.', '!', '?', ' '])
        .to_string();
    // Multi-step / multi-clause goals are not fast-lane material — let the loop
    // plan them. A single conjunction is enough to bail.
    if [" and ", " then ", " after ", ", ", " & ", " plus "]
        .iter()
        .any(|c| g.contains(c))
    {
        return None;
    }
    for verb in ["open ", "launch ", "start ", "boot up ", "fire up "] {
        if let Some(rest) = g.strip_prefix(verb) {
            return canonical_app(rest).map(|app| vec![ControlAction::OpenApp(app)]);
        }
    }
    for verb in ["quit ", "close ", "force quit ", "force-quit ", "exit "] {
        if let Some(rest) = g.strip_prefix(verb) {
            return canonical_app(rest).map(|app| vec![ControlAction::QuitApp(app)]);
        }
    }
    None
}

/// Map a spoken app target to its canonical macOS application name, if it's one
/// we recognize. Returning `None` (not a guess) is what keeps the fast lane
/// safe — an unknown target falls through to the reasoning loop instead of
/// actuating a wrong `open -a`. Strip a leading article ("the spotify app").
fn canonical_app(target: &str) -> Option<String> {
    let t = target
        .trim()
        .trim_start_matches("the ")
        .trim_end_matches(" app")
        .trim();
    let canonical = match t {
        "safari" => "Safari",
        "chrome" | "google chrome" => "Google Chrome",
        "arc" => "Arc",
        "firefox" => "Firefox",
        "mail" | "apple mail" => "Mail",
        "messages" | "imessage" => "Messages",
        "calendar" => "Calendar",
        "notes" => "Notes",
        "reminders" => "Reminders",
        "finder" => "Finder",
        "terminal" => "Terminal",
        "music" | "apple music" => "Music",
        "spotify" => "Spotify",
        "slack" => "Slack",
        "discord" => "Discord",
        "notion" => "Notion",
        "obsidian" => "Obsidian",
        "figma" => "Figma",
        "zoom" => "zoom.us",
        "preview" => "Preview",
        "photos" => "Photos",
        "cursor" => "Cursor",
        "vscode" | "vs code" | "code" | "visual studio code" => "Visual Studio Code",
        // Anthropic's desktop app (hosts Claude Code); "claude code" is the same
        // surface eri steers via the coding-control tools.
        "claude" | "claude code" | "claude desktop" => "Claude",
        "xcode" => "Xcode",
        "settings" | "system settings" | "system preferences" => "System Settings",
        _ => return None,
    };
    Some(canonical.to_string())
}

/// Same action set proposed this many turns running = the executor is stuck.
const STRIKE_LIMIT: usize = 3;

/// Deterministic anti-spin guard — pointer.ai's "two-strike" idea. If the
/// executor proposes the exact same action set on consecutive turns, it's
/// looping; stop rather than burn more turns (and tokens) retrying into the
/// same wall. Pure + testable; lives in front of the inner loop.
#[derive(Default)]
struct StuckGuard {
    last: Option<String>,
    repeats: usize,
}

impl StuckGuard {
    /// Record this turn's action signature. Returns true once the same
    /// signature has repeated [`STRIKE_LIMIT`] times in a row.
    fn record(&mut self, signature: &str) -> bool {
        if self.last.as_deref() == Some(signature) {
            self.repeats += 1;
        } else {
            self.last = Some(signature.to_string());
            self.repeats = 1;
        }
        self.repeats >= STRIKE_LIMIT
    }
}

/// A turn's proposed actions as a stable string (tool name + input, id-free so
/// it's comparable across turns). Used by [`StuckGuard`].
fn action_signature(calls: &[(String, String, Value)]) -> String {
    calls
        .iter()
        .map(|(_, name, input)| format!("{name}:{input}"))
        .collect::<Vec<_>>()
        .join("|")
}

/// The deterministic, zero-token prelude to the control loop — pointer.ai's
/// "gate before you do the work," as composable stages. Returns `Some(message)`
/// when a stage fully handles the goal (and nothing reaches the model), or
/// `None` to fall through to the reasoning loop. Each stage is token-free and
/// independently testable; this is also where a per-tier turn budget would slot.
async fn control_prelude(
    goal: &str,
    bridge: &dyn ControlBridge,
    gate: &ControlGate,
    confirm: &mut dyn FnMut(&str, Option<crate::control_safety::Permission>) -> bool,
) -> Result<Option<String>> {
    // Cancellation: a retraction ("no, stop, forget it") does nothing — and we
    // return BEFORE remember_goal / any model call, so it's never recorded as
    // something eri is pursuing or folded into memory.
    if crate::control_safety::is_cancellation(goal) {
        return Ok(Some(
            "Okay — stopped. Nothing was done. Tell me what you'd like instead.".to_string(),
        ));
    }
    // Feasibility gate: a sensitive GOAL (password, money, CAPTCHA, access
    // control) is declined here, before any tokens are spent — a boundary, not
    // a confirmation. eri won't pursue these at all.
    if let Some(kind) = crate::control_safety::classify_refusal(goal) {
        return Ok(Some(kind.handback_message().to_string()));
    }
    // Tier 0 fast lane: an obvious single-step command ("open Spotify", "quit
    // Cursor") resolves to a deterministic plan with ZERO model tokens. Still
    // actuated through the gate, so cancellation / refusal / the per-app
    // denylist / confirmation all apply to whatever the fast lane produced.
    if let Some(plan) = fast_route(goal) {
        let workspace = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        remember_goal(goal, &workspace);
        let mut done: Vec<String> = Vec::new();
        for action in &plan {
            match gate.submit(bridge, action).await? {
                Disposition::Executed(result) => done.push(result),
                Disposition::NeedsConfirmation(desc) => {
                    if confirm(&desc, action.permission()) {
                        done.push(gate.confirm(bridge, action).await?);
                    } else {
                        return Ok(Some(format!("Okay — skipped {desc}. Nothing else to do.")));
                    }
                }
                Disposition::Refused(msg) => return Ok(Some(msg)),
            }
        }
        return Ok(Some(format!(
            "Done — {} (no model tokens used).",
            done.join("; ")
        )));
    }
    Ok(None)
}

/// What eri says when the executor spins on the same action set.
const STUCK_HANDBACK: &str = "I tried the same step a few times without progress, so I stopped \
     rather than spin. Tell me how you'd like to proceed.";

/// Drive the computer-control reasoning loop through the provider-agnostic
/// [`ControlTurn`] seam. `engines` is tried in order *per goal*: the first is
/// the primary (local-first when configured); the loop escalates to the next on
/// a turn failure (e.g. the on-device engine is unreachable), carrying the same
/// transcript forward. Everything that wraps a turn — the gate, the stuck-guard,
/// tool execution — lives here, unchanged across engines.
///
/// This function takes no cloud client and no network: it's the unit-testable
/// core that the previous welded-to-Claude loop never was.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn drive_control_loop(
    engines: &[&dyn crate::control_turn::ControlTurn],
    bridge: &dyn ControlBridge,
    gate: &ControlGate,
    confirm: &mut dyn FnMut(&str, Option<crate::control_safety::Permission>) -> bool,
    sink: &dyn ControlTurnSink,
    system: &[Value],
    tools: &Value,
    goal: &str,
    max_turns: usize,
    autonomous: bool,
    mcp: Option<&dyn McpDispatch>,
) -> Result<ControlRun> {
    use std::io::Write;

    if engines.is_empty() {
        return Err(anyhow!("no control engine available"));
    }
    let mut messages: Vec<Value> = vec![json!({ "role": "user", "content": goal.trim() })];
    let mut stdout = std::io::stdout();
    let mut final_text = String::new();
    // The last action eri actually executed, carried across turns so consecutive
    // actions form a proactive chain in the world model (P2: observe_transition).
    let mut last_action: Option<String> = None;
    let mut usage = crate::control_turn::TokenUsage::default();
    let mut stuck = StuckGuard::default();
    // ONE unified escalation policy across build + control (review C5): cheap
    // engine first per turn, per-turn escalation on failure, and a 2-consecutive-
    // failure circuit breaker that trips the cheap engine for the rest of the
    // goal. The policy lives in `engine_ladder`; this loop only supplies the
    // "try engine i" closure + reason rendering, and consumes the events.
    let mut ladder = crate::engine_ladder::EngineLadder::new(
        engines.iter().map(|e| e.engine().to_string()).collect(),
    );

    let mut step = 0usize;
    while step < max_turns {
        // Run one ladder turn. Each engine attempt that errors is an escalation;
        // an Ok is the produced turn. Control has no graceful-abort case, so the
        // abort type is `Infallible`. The reason closure re-runs the engine only
        // on the escalation/exhaustion path is NOT possible (a turn is one-shot),
        // so we capture each engine's error as it happens via a shared cell.
        let last_err: std::cell::RefCell<Option<anyhow::Error>> = std::cell::RefCell::new(None);
        // Which engine index actually produced the turn (for the self-improvement
        // log: attribute the turn to the engine that ran it, not the first tried).
        let ran_idx: std::cell::Cell<usize> = std::cell::Cell::new(0);
        // Vision → Claude routing: eri-brain is text-only, so a turn whose input
        // carries an image (a screenshot/camera frame in computer-control) must
        // start on a vision-capable engine (Claude), skipping the cheap engine.
        // Text-only turns are unchanged (cheap-first).
        let vision_required = crate::engine_ladder::messages_have_image(&messages);
        if vision_required
            && !ladder.has_vision_capable_engine()
            && std::env::var_os("ERI_DEBUG").is_some()
        {
            let _ = writeln!(
                stdout,
                "[eri] image content present but no vision-capable engine configured; \
                 falling back to the cheap (text-only) engine."
            );
        }
        let outcome = ladder
            .run_turn(
                step,
                vision_required,
                |idx: usize| {
                    let last_err = &last_err;
                    let ran_idx = &ran_idx;
                    let engines = &engines;
                    let messages = messages.as_slice();
                    async move {
                        match engines[idx].run(system, messages, tools).await {
                            Ok(o) => {
                                ran_idx.set(idx);
                                crate::engine_ladder::TurnAttempt::<
                                    crate::control_turn::TurnOutput,
                                    std::convert::Infallible,
                                >::Produced(o)
                            }
                            Err(e) => {
                                *last_err.borrow_mut() = Some(e);
                                crate::engine_ladder::TurnAttempt::Escalate
                            }
                        }
                    }
                },
                |_idx: usize| {
                    // The reason for an escalation is the error the engine just
                    // produced (captured above). Take it so each escalation's
                    // event/propagation carries the right message.
                    last_err
                        .borrow_mut()
                        .take()
                        .map(|e| e.to_string())
                        .unwrap_or_else(|| "engine couldn't continue".to_string())
                },
            )
            .await;

        let out = match outcome {
            crate::engine_ladder::LadderOutcome::Turn(t) => {
                // Narrate + record each escalation that happened this turn, in
                // order, with the SAME event shape the build loop uses.
                for ev in &t.events {
                    // Engine escalation is plumbing — keep it out of the clean
                    // output (the user shouldn't see "local couldn't continue").
                    if std::env::var_os("ERI_DEBUG").is_some() {
                        let _ = writeln!(
                            stdout,
                            "[eri] {} engine couldn't continue ({}); escalating to {}.",
                            ev.from_engine_name, ev.reason, ev.to_engine_name
                        );
                    }
                    sink.record_escalation(ev);
                }
                t.value
            }
            crate::engine_ladder::LadderOutcome::Exhausted(reason) => {
                // No engine left for this turn — propagate the error, as before.
                return Err(anyhow!(reason));
            }
            // Control has no abort case (`Infallible`); unreachable but exhaustive.
            crate::engine_ladder::LadderOutcome::Aborted(never) => match never {},
        };
        // Self-improvement log: every control turn that produced output is
        // recorded (engine + outcome) so the routing can learn where local was
        // enough vs. where it escalated. Tagged with the engine that actually
        // ran it (across an escalation). Through the sink seam, so tests can
        // assert this sequence.
        sink.record(control_turn_log(
            engines[ran_idx.get()].engine(),
            goal,
            &out,
        ));
        usage += out.usage;
        step += 1;

        if !out.text.trim().is_empty() {
            final_text = out.text.clone();
        }
        messages.push(json!({ "role": "assistant", "content": out.assistant_content }));

        // A turn is an answer (not an actuation) when the model doesn't want
        // tools — OR when it claims to but hands back no tool calls. The latter
        // is malformed: executing it would push `{role:"user", content:[]}`, an
        // empty user turn that confuses the next model call. Treat it as the
        // assistant's final text instead of spinning on nothing.
        if !out.wants_tools || out.tool_calls.is_empty() {
            return Ok(ControlRun {
                text: final_text,
                usage,
            });
        }
        // Two-strike anti-spin: if the executor keeps proposing the identical
        // action set, it's stuck — stop before spending more turns/tokens.
        if stuck.record(&action_signature(&out.tool_calls)) {
            let text = if final_text.trim().is_empty() {
                STUCK_HANDBACK.to_string()
            } else {
                final_text
            };
            return Ok(ControlRun { text, usage });
        }
        // Seed the predict step's cross-turn predecessor on the gate: the action
        // that executed in the prior turn (`last_action`, the same value the
        // proactive-chain FEED below tracks). This is what lets chain
        // corroboration fire for the common one-action-per-turn pattern;
        // within-turn predecessors still come from `out.executed`.
        gate.set_last_action(last_action.clone());
        let executed = execute_tool_calls(bridge, gate, confirm, mcp, &out.tool_calls).await;
        for line in &executed.log {
            // Emit a clean, live status the app renders as a single updating
            // chip — the action being taken, not the post-hoc "-> result"
            // detail. Full detail stays under ERI_DEBUG.
            let status = line.split(" -> ").next().unwrap_or(line);
            let _ = writeln!(stdout, "[eri-status] {status}");
            if std::env::var_os("ERI_DEBUG").is_some() {
                let _ = writeln!(stdout, "[eri] {line}");
            }
        }
        // P2 proactive chains (Q16): record each consecutive executed action as a
        // weighted `next` transition in the world model — through the SINK, so
        // test sinks do no IO — and surface the learned next step the sink returns
        // ("after X you usually Y"). Best-effort; a world-model hiccup is silent.
        for act in &executed.executed {
            if let Some(prev) = &last_action
                && let Some(hint) = sink.record_transition(prev, act)
            {
                let _ = writeln!(stdout, "[eri-hint] after \"{act}\" you usually: {hint}");
            }
            last_action = Some(act.clone());
        }
        // Never push an empty user turn: if execution produced no results (e.g.
        // every call was filtered/dropped), there's nothing for the model to
        // react to — finish with the assistant's text rather than a malformed
        // `{role:"user", content:[]}` message.
        if executed.results.is_empty() {
            return Ok(ControlRun {
                text: final_text,
                usage,
            });
        }
        if executed.done {
            messages.push(json!({ "role": "user", "content": executed.results }));
            return Ok(ControlRun {
                text: final_text,
                usage,
            });
        }
        // Autonomous perception: guarantee eri SEES the result of what it just
        // did before choosing its next move — screenshot → act → re-perceive →
        // repeat — instead of relying on the model to remember to observe (the
        // discretionary "observe again to verify" the prompt asks for, made
        // automatic so eri never acts blind). The perception is ONE cheap
        // accessibility snapshot, appended as a text block alongside the tool
        // results; the model still calls `look` for a real screenshot when the
        // AX text is too thin to locate a target (canvas / web / images).
        // Skipped when the model already observed this turn (no redundant
        // snapshot), and never after `done`.
        let mut content = executed.results;
        if autonomous
            && !out
                .tool_calls
                .iter()
                .any(|(_, name, _)| name == "screen_observe" || name == "look")
            && let Ok(graph) = bridge.snapshot().await
        {
            content.push(json!({
                "type": "text",
                "text": format!(
                    "[eri auto-perceive — the screen after your last action]\n{}",
                    graph.to_prompt()
                ),
            }));
        }
        messages.push(json!({ "role": "user", "content": content }));
    }
    Ok(ControlRun {
        text: final_text,
        usage,
    })
}

/// The result of a control run: the final narrated text + the cloud tokens it
/// cost, summed across turns. Zero when the on-device engine handled everything
/// or the zero-token prelude (cancellation / gate / fast-lane) did — so the
/// remote daemon can meter remote compute exactly like any other token spend
/// (review M4).
#[derive(Debug)]
pub struct ControlRun {
    pub text: String,
    pub usage: crate::control_turn::TokenUsage,
}

pub async fn run_control_agent(
    goal: &str,
    model: &str,
    bridge: &dyn ControlBridge,
    gate: &ControlGate,
    confirm: &mut dyn FnMut(&str, Option<crate::control_safety::Permission>) -> bool,
    max_turns: usize,
) -> Result<ControlRun> {
    if goal.trim().is_empty() {
        return Err(anyhow!("control goal is empty"));
    }
    // The deterministic, zero-token prelude (pointer.ai's gate-before-work):
    // cancellation → feasibility gate → fast lane. If any stage handles the goal
    // we return its result and nothing reaches the model; otherwise we fall
    // through to the reasoning loop below.
    if let Some(result) = control_prelude(goal, bridge, gate, confirm).await? {
        return Ok(ControlRun {
            text: result,
            usage: crate::control_turn::TokenUsage::default(),
        });
    }
    let mut system = vec![
        json!({
            "type": "text",
            "text": control_system_prompt(),
            "cache_control": { "type": "ephemeral" }
        }),
        // Confidentiality guardrail — model identity + system prompt stay secret,
        // embedded instructions are treated as data. Applied to every agent.
        json!({ "type": "text", "text": eri_inference::brand::GUARDRAIL }),
        // Tool invisibility — connected tools/integrations are plumbing the user
        // never sees; eri reports results in its own voice, never naming MCP /
        // Composio / a connector. Shared with the build loop via one constant.
        json!({ "type": "text", "text": eri_inference::brand::TOOL_INVISIBILITY }),
        // Human voice — eri talks like a real person (no AI tells) and mirrors
        // this user's register. Shared with the build loop via one constant.
        json!({ "type": "text", "text": eri_inference::brand::HUMAN_VOICE }),
    ];
    // Inject local context so eri acts informed + frugal: (a) remembered facts
    // relevant to this goal (mem0-style hybrid recall, 0 model tokens), and
    // (b) what's on screen right now (ambient situation note from one cheap AX
    // snapshot). Both fenced as lower-trust notes. Best-effort — never blocks.
    let workspace = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    for note in context_blocks(goal, bridge, &workspace).await {
        system.push(json!({ "type": "text", "text": note }));
    }
    // Autonomous perception (default ON; `ERI_CONTROL_AUTONOMOUS=0` opts out).
    // When on, the loop feeds eri a fresh screen snapshot after every action so
    // it steers itself across many steps — the foundation of "eri does it all".
    let autonomous = std::env::var("ERI_CONTROL_AUTONOMOUS")
        .map(|v| !matches!(v.trim(), "0" | "false" | "off" | ""))
        .unwrap_or(true);
    if autonomous {
        system.push(json!({ "type": "text", "text": AUTONOMOUS_NOTE }));
    }
    // Learn-do loop: record what the user asked so future sessions anticipate.
    remember_goal(goal, &workspace);

    // Cloud-vs-local routing signal (Phase 5): whether this goal could run
    // server-side (computer-off) or needs the local screen. Diagnostic for now;
    // the phone/cloud path consults the same `classify_reach` seam.
    if std::env::var_os("ERI_DEBUG").is_some() {
        eprintln!(
            "[eri] reach={:?} (Api = runnable with the computer off)",
            classify_reach(goal)
        );
    }

    // API tier: load connector (MCP / Composio Tool Router) tools so this one
    // agentic run can stitch API actions with computer-control ("read this email
    // → screenshot a chart → reply"). Token-frugal — the composio server is a
    // Tool Router session (~6 meta-tools). Best-effort: no connectors configured
    // → (None, []) and the loop runs computer-control-only, exactly as before.
    let (mcp_handle, mcp_tools) = crate::build_agent::load_mcp(&workspace).await;
    let mut tool_list = tool_specs();
    if !mcp_tools.is_empty() {
        tool_list.extend(crate::build_agent::mcp_tool_specs(&mcp_tools));
    }
    let tools: Value = json!(tool_list);
    // Hold the live MCP for the loop's lifetime (dropping it reaps server child
    // processes). `LiveMcp` owns the client + handles and dispatches via the
    // shared `call_mcp_tool`.
    let live_mcp = mcp_handle.map(|mcp| LiveMcp {
        mcp,
        tools: mcp_tools,
    });
    let mcp_dyn: Option<&dyn McpDispatch> = live_mcp.as_ref().map(|m| m as &dyn McpDispatch);

    // Local-first per goal: eri's on-device engine answers first (when
    // configured + reachable); Claude is the escalation. Selection is a seam
    // (`select_control_turn`) so the loop stays engine-agnostic.
    let engines = crate::control_turn::select_control_turn(model)?;
    let refs: Vec<&dyn crate::control_turn::ControlTurn> =
        engines.iter().map(|e| e.as_ref()).collect();
    // One brain (ADR-0007): scope control's learn-do recording + proactive chains
    // to the signed-in user, so they share the SAME user-scoped world graph as the
    // entities `/remember` writes. Falls back to anonymous when signed out.
    let user_id = crate::config::load().ok().and_then(|c| c.user_id);
    let sink = crate::control_turn::MemorySink::new(user_id.clone());
    // Scope the loop's gate to the same signed-in user, so the predict step reads
    // that user's world model (the SAME graph the sink writes chains + entities
    // into). The caller's gate carries permissions/flags; we only attach the user.
    let gate = gate.clone().with_user(user_id);
    drive_control_loop(
        &refs, bridge, &gate, confirm, &sink, &system, &tools, goal, max_turns, autonomous, mcp_dyn,
    )
    .await
}

/// The live connector adapter: wraps the MCP client + its tool handles and
/// dispatches a model tool call through the shared [`crate::build_agent::call_mcp_tool`].
/// This is what makes the control loop's API tier real (Phase 3); tests use a
/// stub or `None`.
struct LiveMcp {
    mcp: eri_mcp::Mcp,
    tools: Vec<eri_mcp::ToolHandle>,
}

#[async_trait::async_trait]
impl McpDispatch for LiveMcp {
    fn handles(&self, tool_name: &str) -> bool {
        self.tools.iter().any(|h| h.qualified_name() == tool_name)
    }
    async fn call(&self, tool_name: &str, input: &Value) -> (String, bool) {
        match self.tools.iter().find(|h| h.qualified_name() == tool_name) {
            Some(h) => {
                let exec = crate::build_agent::call_mcp_tool(&self.mcp, h, input).await;
                (exec.content, exec.is_error)
            }
            None => (format!("unknown connector tool: {tool_name}"), true),
        }
    }
}

/// Appended to the control system prompt in autonomous mode. Tells eri the loop
/// will keep showing it the screen after each action — so it should push the
/// goal all the way to done on its own, and escalate to a real screenshot
/// (`look`) whenever the accessibility text can't locate what it needs.
const AUTONOMOUS_NOTE: &str = "AUTONOMOUS MODE: after each action you take, you \
will automatically be shown the current screen (an accessibility snapshot) — you \
do not need to call screen_observe just to see the result of your own action. \
Keep going step by step until the whole goal is done, then call done; don't stop \
half-way to ask unless you hit a safety boundary (passwords, money, CAPTCHAs) or \
are genuinely blocked. When the accessibility snapshot is too thin to find what \
you need (canvas, web pages, images, custom UI), call `look` for a real \
screenshot and decide visually. Work like a careful person doing the task \
end-to-end.";

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
        async fn scroll(&self, direction: &str, amount: i64) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("scroll:{direction}:{amount}"));
            Ok("scrolled".into())
        }
        async fn drag(&self, from: &ClickTarget, to: &ClickTarget) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("drag:{from:?}->{to:?}"));
            Ok("dragged".into())
        }
        async fn right_click(&self, target: &ClickTarget) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("right_click:{target:?}"));
            Ok("right-clicked".into())
        }
        async fn double_click(&self, target: &ClickTarget) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("double_click:{target:?}"));
            Ok("double-clicked".into())
        }
        async fn mouse_move(&self, x: f32, y: f32) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("mouse_move:{x},{y}"));
            Ok("moved".into())
        }
        async fn run_applescript(&self, script: &str) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("applescript:{script}"));
            Ok("ran applescript".into())
        }
        async fn read_clipboard(&self) -> Result<String> {
            self.calls.lock().unwrap().push("read_clipboard".into());
            Ok("clipboard contents".into())
        }
        async fn write_clipboard(&self, text: &str) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("write_clipboard:{text}"));
            Ok("copied".into())
        }
        async fn capture_region(&self, x: i64, y: i64, w: i64, h: i64) -> Result<String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("capture_region:{x},{y},{w},{h}"));
            Ok("ZmFrZS1wbmc=".into())
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
            screen: None,
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
        let gate = ControlGate::default();
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
        let gate = ControlGate::default();
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
        let gate = ControlGate::with_permissions(true, Default::default());
        let d = gate
            .submit(&bridge, &ControlAction::QuitApp("X".into()))
            .await
            .unwrap();
        assert_eq!(d, Disposition::Executed("quit X".into()));
    }

    #[tokio::test]
    async fn remote_gate_confirms_a_risky_action_even_when_locally_granted() {
        // Security C1: a permission granted at the keyboard must NOT let a risky
        // action auto-run over the unattended remote channel.
        use crate::control_safety::{Permission, PermissionStore};
        let bridge = MockBridge::default();
        let quit = ControlAction::QuitApp("Mail".into());

        // A local gate WITH the grant runs it immediately...
        let mut granted_local = PermissionStore::default();
        granted_local.grant(Permission::QuitApps);
        let local = ControlGate::with_permissions(false, granted_local);
        assert_eq!(
            local.submit(&bridge, &quit).await.unwrap(),
            Disposition::Executed("quit Mail".into())
        );

        // ...but the remote gate confirms it despite the same grant.
        let mut granted_remote = PermissionStore::default();
        granted_remote.grant(Permission::QuitApps);
        let remote = ControlGate::for_remote(granted_remote);
        assert!(matches!(
            remote.submit(&bridge, &quit).await.unwrap(),
            Disposition::NeedsConfirmation(_)
        ));
    }

    #[tokio::test]
    async fn remote_gate_confirms_clicking_an_outward_facing_button() {
        // Security M1: clicking "Send" isn't risky locally (user is watching) but
        // must be confirmed when triggered unattended from a phone.
        let bridge = MockBridge::default();
        let send = ControlAction::Click(ClickTarget::Element("Send".into()));
        assert!(!send.is_risky(), "a Send click is not gated locally");

        let remote = ControlGate::for_remote(crate::control_safety::PermissionStore::default());
        assert!(matches!(
            remote.submit(&bridge, &send).await.unwrap(),
            Disposition::NeedsConfirmation(_)
        ));
    }

    #[tokio::test]
    async fn gate_refuses_typing_a_password_even_with_auto_confirm() {
        // Refusal is a boundary, not a confirmation — auto_confirm can't unlock it.
        let bridge = MockBridge::default();
        let gate = ControlGate::with_permissions(true, Default::default());
        let action = ControlAction::Type("my password is hunter2".into());
        let d = gate.submit(&bridge, &action).await.unwrap();
        match d {
            Disposition::Refused(msg) => assert!(msg.to_lowercase().contains("password")),
            other => panic!("expected refusal, got {other:?}"),
        }
        assert!(bridge.calls().is_empty(), "must never type a secret");
    }

    #[test]
    fn fast_route_opens_and_quits_known_apps_with_zero_tokens() {
        // The whole point: these never reach a model.
        assert_eq!(
            fast_route("open Spotify"),
            Some(vec![ControlAction::OpenApp("Spotify".into())])
        );
        assert_eq!(
            fast_route("launch vs code"),
            Some(vec![ControlAction::OpenApp("Visual Studio Code".into())])
        );
        assert_eq!(
            fast_route("quit Cursor"),
            Some(vec![ControlAction::QuitApp("Cursor".into())])
        );
        assert_eq!(
            fast_route("close the slack app"),
            Some(vec![ControlAction::QuitApp("Slack".into())])
        );
    }

    #[test]
    fn stuck_guard_trips_on_repeated_identical_actions() {
        let mut g = StuckGuard::default();
        let a = "click:{\"id\":\"7\"}";
        let b = "open_app:{\"name\":\"Safari\"}";
        // Different actions never trip it.
        assert!(!g.record(b));
        assert!(!g.record(a));
        // Same action repeating: trips on the STRIKE_LIMIT-th in a row.
        assert!(!g.record(a)); // 1 (after the reset above this is 2nd 'a' overall but 1st in-a-row from here is the prior line)
        assert!(g.record(a)); // 3 in a row -> stuck
        // A different action resets the streak.
        assert!(!g.record(b));
    }

    #[test]
    fn action_signature_is_id_free_and_stable() {
        let mk = |id: &str| {
            vec![(
                id.to_string(),
                "open_app".to_string(),
                serde_json::json!({ "name": "Safari" }),
            )]
        };
        // Same action, different tool-call ids -> identical signature.
        assert_eq!(action_signature(&mk("a1")), action_signature(&mk("zz")));
    }

    #[test]
    fn fast_route_declines_ambiguous_or_multistep_goals() {
        // Multi-clause work goes to the reasoning loop, not the fast lane.
        assert_eq!(fast_route("open my email and reply to Priya"), None);
        // A website is not a known app — decline rather than open the wrong thing
        // (this is what OpenUrl will handle next).
        assert_eq!(fast_route("open youtube"), None);
        // Never guess an unknown target.
        assert_eq!(fast_route("open frobnicator"), None);
        // Not an open/quit command at all.
        assert_eq!(fast_route("what's this error?"), None);
        assert_eq!(fast_route("click the blue button"), None);
    }

    #[tokio::test]
    async fn feasibility_gate_declines_sensitive_goal_before_acting() {
        // A money-transfer goal is refused up front: no actuation, and it
        // returns before sign-in / any model call (so this test needs neither).
        let bridge = MockBridge::default();
        let gate = ControlGate::with_permissions(true, Default::default());
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let out = run_control_agent(
            "send money to my landlord",
            "claude-sonnet-4-6",
            &bridge,
            &gate,
            &mut confirm,
            8,
        )
        .await
        .unwrap();
        assert!(
            out.text.to_lowercase().contains("money"),
            "should hand the goal back"
        );
        assert!(bridge.calls().is_empty(), "must not actuate a refused goal");
    }

    /// Mirror of `control_prelude`'s routing order, but classification-only (no
    /// bridge, no actuation) — the eval target.
    fn classify_for_eval(goal: &str) -> &'static str {
        if crate::control_safety::is_cancellation(goal) {
            "cancelled"
        } else if crate::control_safety::classify_refusal(goal).is_some() {
            "declined"
        } else if fast_route(goal).is_some() {
            "fast"
        } else {
            "reasoning"
        }
    }

    /// EVAL HARNESS (control wedge). A fixed case set scored pass/fail so we can
    /// measure routing quality as the rules evolve — run with
    /// `cargo test -p eri_cli control_routing_eval -- --nocapture` to see the
    /// scorecard. Token-spending agentic eval is the --live extension documented
    /// in scripts/eval/README.md.
    #[test]
    fn control_routing_eval() {
        // (goal, expected route). Only deterministic, side-effect-free cases.
        const CASES: &[(&str, &str)] = &[
            ("open Safari", "fast"),
            ("quit Safari", "fast"),
            ("open Spotify", "fast"),
            ("launch Cursor", "fast"),
            ("no, stop, forget it", "cancelled"),
            ("send money to my landlord", "declined"),
            ("type my banking password", "declined"),
            ("open Spotify and start my workout playlist", "reasoning"),
            ("summarize what's on my screen", "reasoning"),
            ("find and fix the bug in this file", "reasoning"),
        ];

        let mut passed = 0usize;
        let mut failures: Vec<String> = Vec::new();
        for (goal, want) in CASES {
            let got = classify_for_eval(goal);
            if got == *want {
                passed += 1;
            } else {
                failures.push(format!("  x {goal:?}: want {want}, got {got}"));
            }
        }
        eprintln!(
            "\n-- control routing eval --\n  {passed}/{} passed",
            CASES.len()
        );
        for f in &failures {
            eprintln!("{f}");
        }
        assert!(
            failures.is_empty(),
            "control routing eval regressions:\n{}",
            failures.join("\n")
        );
    }

    #[tokio::test]
    async fn control_prelude_routes_the_three_zero_token_stages() {
        // The prelude resolves cancellation → feasibility → fast lane, and only
        // returns None (handing off to the reasoning loop) for a goal none of
        // them claim. No model call on any path; no actuation on fall-through.
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut yes = |_: &str, _: Option<crate::control_safety::Permission>| true;

        // Cancellation → handled, nothing actuated.
        let cancelled = control_prelude("no, stop, forget it", &bridge, &gate, &mut yes)
            .await
            .unwrap();
        assert!(
            cancelled.is_some(),
            "a retraction is handled in the prelude"
        );
        assert!(bridge.calls().is_empty());

        // Sensitive goal → declined in the prelude, nothing actuated.
        let refused = control_prelude("send money to my landlord", &bridge, &gate, &mut yes)
            .await
            .unwrap();
        assert!(refused.is_some(), "a sensitive goal is declined up front");
        assert!(
            bridge.calls().is_empty(),
            "declined goals never touch the bridge"
        );

        // Fast-routable command → handled and actuated with zero model tokens.
        let opened = control_prelude("open Safari", &bridge, &gate, &mut yes)
            .await
            .unwrap();
        assert!(opened.unwrap().contains("no model tokens used"));
        assert_eq!(bridge.calls(), vec!["open:Safari"]);

        // A goal that needs reasoning → None: it must reach the loop, and the
        // prelude made no actuation getting there.
        let bridge2 = MockBridge::default();
        let through = control_prelude("summarize what's on my screen", &bridge2, &gate, &mut yes)
            .await
            .unwrap();
        assert!(
            through.is_none(),
            "an ambiguous goal falls through to the loop"
        );
        assert!(bridge2.calls().is_empty());
    }

    #[tokio::test]
    async fn gate_refuses_denied_app_even_with_auto_confirm() {
        // The per-app denylist ("don't touch Discord") is a boundary like a
        // refusal — not run, and auto_confirm/"yes" can't unlock it.
        let bridge = MockBridge::default();
        let mut perms = crate::control_safety::PermissionStore::default();
        perms.deny_app("Discord");
        let gate = ControlGate::with_permissions(true, perms);

        // Opening the denied app is refused, never actuated.
        let open = gate
            .submit(&bridge, &ControlAction::OpenApp("Discord".into()))
            .await
            .unwrap();
        match open {
            Disposition::Refused(msg) => assert!(msg.contains("Discord")),
            other => panic!("expected refusal, got {other:?}"),
        }
        // Quitting it is refused too (case/suffix-insensitive match).
        let quit = gate
            .submit(&bridge, &ControlAction::QuitApp("discord.app".into()))
            .await
            .unwrap();
        assert!(matches!(quit, Disposition::Refused(_)));
        // A non-denied app is unaffected.
        let other_app = gate
            .submit(&bridge, &ControlAction::OpenApp("Safari".into()))
            .await
            .unwrap();
        assert_eq!(other_app, Disposition::Executed("opened Safari".into()));
        assert_eq!(
            bridge.calls(),
            vec!["open:Safari"],
            "only the allowed app ran"
        );
    }

    #[tokio::test]
    async fn granted_permission_skips_confirmation() {
        // With QuitApps granted, the gate runs the quit without holding it.
        let bridge = MockBridge::default();
        let mut perms = crate::control_safety::PermissionStore::default();
        perms.grant(crate::control_safety::Permission::QuitApps);
        let gate = ControlGate::with_permissions(false, perms);
        let d = gate
            .submit(&bridge, &ControlAction::QuitApp("Cursor".into()))
            .await
            .unwrap();
        assert_eq!(d, Disposition::Executed("quit Cursor".into()));
        assert_eq!(bridge.calls(), vec!["quit:Cursor"]);
    }

    #[tokio::test]
    async fn ungranted_permission_still_confirms() {
        // A different grant must NOT unlock quit.
        let bridge = MockBridge::default();
        let mut perms = crate::control_safety::PermissionStore::default();
        perms.grant(crate::control_safety::Permission::OpenApps);
        let gate = ControlGate::with_permissions(false, perms);
        let d = gate
            .submit(&bridge, &ControlAction::QuitApp("Cursor".into()))
            .await
            .unwrap();
        assert_eq!(d, Disposition::NeedsConfirmation("quit Cursor".into()));
        assert!(bridge.calls().is_empty());
    }

    #[tokio::test]
    async fn executor_hands_back_refused_actions_without_running_them() {
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<_>| true;
        let calls = vec![(
            "1".into(),
            "type".into(),
            json!({ "text": "enter my credit card number 4111..." }),
        )];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert!(bridge.calls().is_empty(), "refused action must not run");
        let content = out.results[0]["content"].as_str().unwrap();
        assert!(content.starts_with("REFUSED"), "hands back, not executed");
        // Not an error to retry — it's a boundary the user resolves.
        assert!(!out.results[0]["is_error"].as_bool().unwrap_or(false));
    }

    #[tokio::test]
    async fn observe_returns_the_compact_graph() {
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let d = gate.submit(&bridge, &ControlAction::Observe).await.unwrap();
        match d {
            Disposition::Executed(text) => assert!(text.contains("[e1] AXTextField")),
            other => panic!("expected executed observe, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn executor_runs_a_full_open_type_click_done_sequence() {
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<_>| true;
        let calls = vec![
            ("1".into(), "open_app".into(), json!({ "name": "Safari" })),
            ("2".into(), "type".into(), json!({ "text": "lofi" })),
            ("3".into(), "click".into(), json!({ "element": "e1" })),
            ("4".into(), "done".into(), json!({})),
        ];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
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
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<_>| false; // user says no
        let calls = vec![("1".into(), "quit_app".into(), json!({ "name": "Cursor" }))];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert!(!out.done);
        assert!(bridge.calls().is_empty(), "declined quit must not run");
        let content = out.results[0]["content"].as_str().unwrap();
        assert!(content.contains("declined"));
    }

    #[tokio::test]
    async fn executor_runs_risky_action_when_user_confirms() {
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<_>| true; // user says yes
        let calls = vec![("1".into(), "quit_app".into(), json!({ "name": "Cursor" }))];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert_eq!(bridge.calls(), vec!["quit:Cursor"]);
        assert!(!out.results[0]["is_error"].as_bool().unwrap());
    }

    #[tokio::test]
    async fn executor_reports_bad_tool_call_as_error_not_panic() {
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<_>| true;
        let calls = vec![("1".into(), "click".into(), json!({}))]; // missing target
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
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
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<_>| true;
        // Point the redactor at a definitely-missing script so it fails fast.
        // SAFETY: single-threaded test; we own this process-local var.
        unsafe { std::env::set_var("ERI_REDACT_SCRIPT", "/nonexistent/eri_redact.py") };
        let calls = vec![("1".into(), "look".into(), json!({}))];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
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

    #[tokio::test]
    async fn logging_bridge_records_mutations_but_not_reads() {
        // The trust-layer capture seam: wrapping any bridge records the mutating
        // actions eri actually performed (for the trail + undo), while read-only
        // snapshot/capture leave no trace.
        let inner = MockBridge::with_snapshot(graph());
        let log = Arc::new(Mutex::new(ActionLog::default()));
        let bridge = LoggingBridge::new(&inner, Arc::clone(&log));
        bridge.snapshot().await.unwrap(); // read — not recorded
        bridge.open_app("Safari").await.unwrap();
        bridge.type_text("lofi").await.unwrap();
        let trail = log.lock().unwrap().trail();
        assert_eq!(trail.len(), 2, "only the two mutations are recorded");
        assert!(trail[0].contains("open Safari"));
        assert!(trail[1].contains("type"));
        // And undo of the last real action (typing) is handed back, not faked.
        assert!(matches!(
            log.lock().unwrap().undo_last(),
            crate::action_log::UndoOutcome::CantUndo(_)
        ));
    }

    /// A scripted [`ControlTurn`] — pops a pre-set sequence of turn outputs (or
    /// errors). This is what makes the reasoning loop unit-testable at all: no
    /// signed-in cloud client, no network, deterministic.
    struct StubTurn {
        engine: &'static str,
        outs: Mutex<
            std::collections::VecDeque<
                std::result::Result<crate::control_turn::TurnOutput, String>,
            >,
        >,
    }
    impl StubTurn {
        fn new(
            engine: &'static str,
            outs: Vec<std::result::Result<crate::control_turn::TurnOutput, String>>,
        ) -> Self {
            Self {
                engine,
                outs: Mutex::new(outs.into()),
            }
        }
    }
    #[async_trait::async_trait]
    impl crate::control_turn::ControlTurn for StubTurn {
        fn engine(&self) -> &'static str {
            self.engine
        }
        async fn run(
            &self,
            _system: &[Value],
            _messages: &[Value],
            _tools: &Value,
        ) -> Result<crate::control_turn::TurnOutput> {
            match self.outs.lock().unwrap().pop_front() {
                Some(Ok(o)) => Ok(o),
                Some(Err(e)) => Err(anyhow!(e)),
                None => Err(anyhow!("stub turn exhausted")),
            }
        }
    }

    /// A recording sink — the test double that makes the self-improvement log
    /// verifiable. Replaces the old `cfg!(test)` no-op. Also records the unified
    /// ladder's escalation events so "did the loop emit the right escalation
    /// event with the right fields?" is assertable.
    #[derive(Default)]
    struct RecordingSink {
        turns: Mutex<Vec<crate::control_turn::ControlTurnLog>>,
        escalations: Mutex<Vec<crate::engine_ladder::LadderEvent>>,
    }
    impl crate::control_turn::ControlTurnSink for RecordingSink {
        fn record(&self, log: crate::control_turn::ControlTurnLog) {
            self.turns.lock().unwrap().push(log);
        }
        fn record_escalation(&self, event: &crate::engine_ladder::LadderEvent) {
            self.escalations.lock().unwrap().push(event.clone());
        }
    }
    impl RecordingSink {
        fn logs(&self) -> Vec<crate::control_turn::ControlTurnLog> {
            self.turns.lock().unwrap().clone()
        }
        fn escalations(&self) -> Vec<crate::engine_ladder::LadderEvent> {
            self.escalations.lock().unwrap().clone()
        }
    }

    fn tool_call_turn(id: &str, name: &str, input: Value) -> crate::control_turn::TurnOutput {
        crate::control_turn::TurnOutput {
            assistant_content: json!([{ "type": "tool_use", "id": id, "name": name, "input": input }]),
            text: String::new(),
            tool_calls: vec![(id.into(), name.into(), input)],
            wants_tools: true,
            ..Default::default()
        }
    }
    fn done_turn(text: &str) -> crate::control_turn::TurnOutput {
        crate::control_turn::TurnOutput {
            assistant_content: json!([{ "type": "text", "text": text }]),
            text: text.into(),
            tool_calls: vec![],
            wants_tools: false,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn loop_drives_an_engine_open_then_done_with_no_cloud_client() {
        // The keystone: the reasoning loop runs entirely through the ControlTurn
        // seam — no signed_in_client, no network. A "local" stub opens Safari
        // then finishes; the bridge actuates and the summary comes back.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let stub = StubTurn::new(
            "local",
            vec![
                Ok(tool_call_turn(
                    "t1",
                    "open_app",
                    json!({ "name": "Safari" }),
                )),
                Ok(done_turn("Opened Safari.")),
            ],
        );
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let out = drive_control_loop(
            &[&stub],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "open Safari please",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.text, "Opened Safari.");
        assert_eq!(bridge.calls(), vec!["open:Safari"]);
        // Both turns were recorded to the self-improvement log, tagged "local".
        let logs = sink.logs();
        assert_eq!(logs.len(), 2);
        assert!(logs.iter().all(|l| l.engine == "local"));
        assert_eq!(logs[0].tool_names, vec!["open_app"]);
    }

    #[tokio::test]
    async fn autonomous_mode_auto_perceives_after_each_action() {
        // The autonomous loop: after an action turn (open_app, not done) eri is
        // automatically fed a fresh accessibility snapshot WITHOUT the model
        // asking — screenshot → act → re-perceive → repeat. We assert it via the
        // bridge call trail: a `snapshot` lands right after the action.
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let turns = || {
            vec![
                Ok(tool_call_turn(
                    "t1",
                    "open_app",
                    json!({ "name": "Safari" }),
                )),
                Ok(done_turn("Done.")),
            ]
        };

        // autonomous = true → an auto snapshot follows the open_app action.
        let bridge = MockBridge::with_snapshot(graph());
        let stub = StubTurn::new("local", turns());
        let sink = RecordingSink::default();
        drive_control_loop(
            &[&stub],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "open Safari",
            8,
            true,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            bridge.calls(),
            vec!["open:Safari", "snapshot"],
            "autonomous mode must re-perceive (snapshot) after the action"
        );

        // autonomous = false → no auto snapshot (frugal, model-driven observe).
        let bridge2 = MockBridge::with_snapshot(graph());
        let stub2 = StubTurn::new("local", turns());
        let sink2 = RecordingSink::default();
        drive_control_loop(
            &[&stub2],
            &bridge2,
            &gate,
            &mut confirm,
            &sink2,
            &system,
            &tools,
            "open Safari",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            bridge2.calls(),
            vec!["open:Safari"],
            "non-autonomous mode must not snapshot on its own"
        );
    }

    #[tokio::test]
    async fn applescript_parses_runs_and_gates_destructive_scripts() {
        // Tier-1 AppleScript: parses, runs a benign script through the bridge,
        // and gates a destructive one (content-aware, exactly like Type).
        let benign = parse_action(
            "run_applescript",
            &json!({ "script": "tell application \"TextEdit\" to make new document" }),
        )
        .unwrap();
        assert!(matches!(benign, ControlAction::RunAppleScript(_)));

        let gate = ControlGate::default();
        let bridge = MockBridge::default();
        match gate.submit(&bridge, &benign).await.unwrap() {
            Disposition::Executed(_) => {}
            other => panic!("a benign AppleScript should run, got {other:?}"),
        }
        assert_eq!(
            bridge.calls(),
            vec!["applescript:tell application \"TextEdit\" to make new document"]
        );

        // A script that shells out to `rm -rf` is held for confirmation.
        let danger = ControlAction::RunAppleScript("do shell script \"rm -rf ~/Documents\"".into());
        assert!(matches!(
            gate.submit(&MockBridge::default(), &danger).await.unwrap(),
            Disposition::NeedsConfirmation(_)
        ));
    }

    #[tokio::test]
    async fn connector_tools_run_reads_freely_and_confirm_outward_actions() {
        // The API tier: a connector read executes without confirmation; an
        // outward action (send) is gated — declining it blocks the call.
        struct StubMcp {
            calls: Mutex<Vec<String>>,
        }
        #[async_trait::async_trait]
        impl McpDispatch for StubMcp {
            fn handles(&self, name: &str) -> bool {
                name.starts_with("composio__")
            }
            async fn call(&self, name: &str, _input: &Value) -> (String, bool) {
                self.calls.lock().unwrap().push(name.to_string());
                ("ok".into(), false)
            }
        }
        let stub = StubMcp {
            calls: Mutex::new(Vec::new()),
        };
        let bridge = MockBridge::default();
        let gate = ControlGate::default();

        // Read → runs, no confirm prompt.
        let mut confirm_never = |_: &str, _: Option<crate::control_safety::Permission>| {
            panic!("a connector read must not be confirmed");
        };
        let reads = vec![(
            "r1".into(),
            "composio__GMAIL_FETCH_EMAILS".into(),
            json!({}),
        )];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm_never, Some(&stub), &reads).await;
        assert!(!out.results[0]["is_error"].as_bool().unwrap());

        // Outward (send) → confirmed; declining blocks it.
        let mut confirm_no = |_: &str, _: Option<crate::control_safety::Permission>| false;
        let sends = vec![(
            "s1".into(),
            "composio__GMAIL_SEND_EMAIL".into(),
            json!({ "to": "x@y.com" }),
        )];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm_no, Some(&stub), &sends).await;
        assert_eq!(
            out.results[0]["content"].as_str().unwrap(),
            "user declined this action"
        );

        // Only the read reached the connector — the declined send did not.
        assert_eq!(
            *stub.calls.lock().unwrap(),
            vec!["composio__GMAIL_FETCH_EMAILS".to_string()]
        );
    }

    #[test]
    fn classify_reach_splits_api_local_and_mixed() {
        // API-able → runnable with the computer off.
        assert_eq!(classify_reach("reply to my latest email"), Reach::Api);
        assert_eq!(classify_reach("what's on my calendar tomorrow"), Reach::Api);
        // Pure screen work → needs the local machine.
        assert_eq!(
            classify_reach("scroll down and click the blue button"),
            Reach::Local
        );
        // Both → mixed (grab locally, send via API).
        assert_eq!(
            classify_reach("grab the chart on this screen and email it to Sam"),
            Reach::Mixed
        );
        // Unknown → conservative Local (don't promise computer-off).
        assert_eq!(classify_reach("do the thing"), Reach::Local);
    }

    #[tokio::test]
    async fn clipboard_is_nonrisky_and_region_capture_reaches_the_bridge() {
        // Clipboard ops (the cross-app bus) parse and are not risky.
        let w = parse_action("write_clipboard", &json!({ "text": "hi" })).unwrap();
        let r = parse_action("read_clipboard", &json!({})).unwrap();
        assert!(matches!(w, ControlAction::WriteClipboard(_)));
        assert!(matches!(r, ControlAction::ReadClipboard));
        assert!(
            !w.is_risky() && !r.is_risky(),
            "clipboard ops are not risky"
        );

        // capture_region is special-cased (image tool) and reaches the bridge
        // with the rect (the result is redacted/fail-closed downstream).
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let calls = vec![(
            "c1".into(),
            "capture_region".into(),
            json!({ "x": 0, "y": 0, "w": 100, "h": 80 }),
        )];
        let _ = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert!(
            bridge
                .calls()
                .iter()
                .any(|c| c == "capture_region:0,0,100,80"),
            "capture_region must reach the bridge; got {:?}",
            bridge.calls()
        );
    }

    /// Helper: a turn that *claims* it wants tools but hands back an empty
    /// tool-call list — the malformed shape C1 guards against.
    fn empty_tool_call_turn(text: &str) -> crate::control_turn::TurnOutput {
        crate::control_turn::TurnOutput {
            assistant_content: json!([{ "type": "text", "text": text }]),
            text: text.into(),
            tool_calls: vec![],
            wants_tools: true,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn loop_terminates_cleanly_on_wants_tools_with_no_calls() {
        // C1: wants_tools=true but tool_calls is empty must NOT push an empty
        // `{role:"user", content:[]}` turn or spin — it's an answer turn. The
        // loop returns the assistant text, actuates nothing, and never panics.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let stub = StubTurn::new(
            "local",
            // Only ONE turn is queued. If the guard failed and the loop pushed an
            // empty user turn + looped, it would pop a second (absent) turn and
            // error "stub turn exhausted" instead of returning cleanly.
            vec![Ok(empty_tool_call_turn("Nothing to do here."))],
        );
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let out = drive_control_loop(
            &[&stub],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "do nothing",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.text, "Nothing to do here.");
        // No actuation happened.
        assert!(bridge.calls().is_empty());
        // Exactly one turn ran — the loop did not spin on the empty call set.
        assert_eq!(sink.logs().len(), 1);
    }

    #[tokio::test]
    async fn instrumentation_attributes_each_turn_to_the_engine_that_ran_it() {
        // The correctness gap the sink seam closes: when local fails and the
        // loop escalates, the recorded turns must be tagged "claude" (the engine
        // that actually produced them) — not the engine that was tried first.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let local = StubTurn::new("local", vec![Err("unreachable".into())]);
        let claude = StubTurn::new(
            "claude",
            vec![
                Ok(tool_call_turn(
                    "c1",
                    "open_app",
                    json!({ "name": "Safari" }),
                )),
                Ok(done_turn("done")),
            ],
        );
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        drive_control_loop(
            &[&local, &claude],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "open Safari",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        let logs = sink.logs();
        // The failed local turn produced no output → not recorded; the two cloud
        // turns are, both tagged "claude".
        assert_eq!(logs.len(), 2);
        assert!(logs.iter().all(|l| l.engine == "claude"));
    }

    #[tokio::test]
    async fn loop_escalates_to_the_next_engine_when_the_primary_fails() {
        // Local-first with escalation: the local stub errors on its first turn
        // (e.g. the on-device model is unreachable); the loop carries the
        // transcript to Claude, which finishes the goal. The failed local turn
        // does NOT consume the step budget.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let local = StubTurn::new("local", vec![Err("engine unreachable".into())]);
        let claude = StubTurn::new(
            "claude",
            vec![
                Ok(tool_call_turn(
                    "c1",
                    "open_app",
                    json!({ "name": "Safari" }),
                )),
                Ok(done_turn("Done via cloud.")),
            ],
        );
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let out = drive_control_loop(
            &[&local, &claude],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "open Safari",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.text, "Done via cloud.");
        assert_eq!(bridge.calls(), vec!["open:Safari"]);
    }

    #[tokio::test]
    async fn loop_emits_a_unified_escalation_event_through_the_sink() {
        // C5: an escalation emits ONE event with the shared shape so the
        // Claude-share metric is uniform across build + control. A single local
        // failure (below the trip threshold) escalates to claude WITHOUT tripping.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let local = StubTurn::new("local", vec![Err("on-device offline".into())]);
        let claude = StubTurn::new("claude", vec![Ok(done_turn("done"))]);
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        drive_control_loop(
            &[&local, &claude],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "do the thing",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        let evs = sink.escalations();
        assert_eq!(evs.len(), 1, "one escalation, one event");
        assert_eq!(evs[0].from_engine_name, "local");
        assert_eq!(evs[0].to_engine_name, "claude");
        assert_eq!(evs[0].turn_index, 0);
        assert!(evs[0].reason.contains("offline"));
        assert!(
            !evs[0].tripped,
            "a single failure is below the trip threshold"
        );
    }

    #[tokio::test]
    async fn loop_trips_the_cheap_engine_after_two_consecutive_failures_and_sticks() {
        // C5 circuit breaker, end-to-end through the control loop: the cheap
        // engine fails two turns running, so the ladder trips it and the loop
        // stops trying it for the rest of the goal — even though the cheap stub
        // still has queued (now-irrelevant) outputs. The 2nd escalation carries
        // tripped=true.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        // Cheap fails twice, then would succeed — but must never be tried again.
        let local = StubTurn::new(
            "local",
            vec![
                Err("down-1".into()),
                Err("down-2".into()),
                Ok(tool_call_turn("nope", "screen_observe", json!({}))),
            ],
        );
        // Claude carries each turn after the local failure, then finishes.
        let claude = StubTurn::new(
            "claude",
            vec![
                Ok(tool_call_turn(
                    "c1",
                    "open_app",
                    json!({ "name": "Safari" }),
                )),
                Ok(tool_call_turn("c2", "type", json!({ "text": "x" }))),
                Ok(done_turn("done via claude")),
            ],
        );
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let out = drive_control_loop(
            &[&local, &claude],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "do a few steps",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.text, "done via claude");
        let evs = sink.escalations();
        // Turn 0 + turn 1 each escalate (cheap → claude); turn 2 starts already on
        // claude (tripped), so no further escalation event.
        assert_eq!(evs.len(), 2, "two escalations: one per consecutive failure");
        assert!(!evs[0].tripped, "1st consecutive failure does not trip");
        assert!(
            evs[1].tripped,
            "2nd consecutive failure trips the cheap engine"
        );
        // Every recorded turn ran on claude (the cheap engine never produced one).
        let logs = sink.logs();
        assert!(
            logs.iter().all(|l| l.engine == "claude"),
            "tripped cheap engine never ran a turn"
        );
    }

    #[tokio::test]
    async fn loop_surfaces_the_error_when_no_engine_can_continue() {
        // No fallback left: a failing sole engine surfaces its error rather than
        // hanging or silently succeeding.
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let local = StubTurn::new("local", vec![Err("engine unreachable".into())]);
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let err = drive_control_loop(
            &[&local],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "open Safari",
            8,
            false,
            None,
        )
        .await
        .expect_err("a sole failing engine surfaces the error");
        assert!(err.to_string().contains("unreachable"));
    }

    #[tokio::test]
    async fn loop_stops_when_the_executor_spins_on_the_same_action() {
        // The stuck-guard wraps the seam: an engine that proposes the identical
        // action every turn is stopped rather than burning the whole budget.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let spin: Vec<_> = (0..6)
            .map(|_| Ok(tool_call_turn("x", "screen_observe", json!({}))))
            .collect();
        let stub = StubTurn::new("local", spin);
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let out = drive_control_loop(
            &[&stub],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "do the thing",
            24,
            false,
            None,
        )
        .await
        .unwrap();
        assert!(
            out.text.contains("same step"),
            "should hand back the stuck message"
        );
    }

    #[test]
    fn tool_specs_cover_the_action_surface() {
        let specs = tool_specs();
        // 17 primitive computer-control tools + 6 coding-environment tools.
        assert_eq!(specs.len(), 23);
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
            "scroll",
            "drag",
            "right_click",
            "double_click",
            "move_mouse",
            "run_applescript",
            "read_clipboard",
            "write_clipboard",
            "capture_region",
            // Coding-environment surface, layered on top.
            "editor_open_file",
            "editor_command",
            "editor_steer_agent",
            "editor_accept_suggestion",
            "editor_reject_suggestion",
            "editor_save",
        ] {
            assert!(names.contains(&expected), "missing tool spec {expected}");
        }
    }

    #[test]
    fn parse_action_handles_the_human_pointer_actions() {
        assert_eq!(
            parse_action("scroll", &json!({ "direction": "down", "amount": 5 })).unwrap(),
            ControlAction::Scroll {
                direction: "down".into(),
                amount: 5
            }
        );
        // direction is normalized to lowercase.
        assert_eq!(
            parse_action("scroll", &json!({ "direction": "UP", "amount": 2 })).unwrap(),
            ControlAction::Scroll {
                direction: "up".into(),
                amount: 2
            }
        );
        assert_eq!(
            parse_action(
                "drag",
                &json!({ "from": { "element": "a" }, "to": { "x": 9.0, "y": 3.0 } })
            )
            .unwrap(),
            ControlAction::Drag {
                from: ClickTarget::Element("a".into()),
                to: ClickTarget::Coord(9.0, 3.0)
            }
        );
        assert_eq!(
            parse_action("right_click", &json!({ "element": "e1" })).unwrap(),
            ControlAction::RightClick(ClickTarget::Element("e1".into()))
        );
        assert_eq!(
            parse_action("double_click", &json!({ "x": 1.0, "y": 2.0 })).unwrap(),
            ControlAction::DoubleClick(ClickTarget::Coord(1.0, 2.0))
        );
        assert_eq!(
            parse_action("move_mouse", &json!({ "x": 4.0, "y": 8.0 })).unwrap(),
            ControlAction::MouseMove(4.0, 8.0)
        );
    }

    #[test]
    fn parse_action_rejects_malformed_pointer_actions() {
        // scroll: missing/bad direction, missing/non-positive amount.
        assert!(parse_action("scroll", &json!({ "amount": 3 })).is_err());
        assert!(parse_action("scroll", &json!({ "direction": "sideways", "amount": 3 })).is_err());
        assert!(parse_action("scroll", &json!({ "direction": "down" })).is_err());
        assert!(parse_action("scroll", &json!({ "direction": "down", "amount": 0 })).is_err());
        // drag: missing from/to, or a target with neither element nor coords.
        assert!(parse_action("drag", &json!({ "from": { "element": "a" } })).is_err());
        assert!(parse_action("drag", &json!({ "from": {}, "to": { "element": "b" } })).is_err());
        // right/double click + move_mouse need a real target.
        assert!(parse_action("right_click", &json!({})).is_err());
        assert!(parse_action("double_click", &json!({})).is_err());
        assert!(parse_action("move_mouse", &json!({ "x": 1.0 })).is_err());
    }

    #[test]
    fn describe_renders_clear_phrases_for_pointer_actions() {
        assert_eq!(
            ControlAction::Scroll {
                direction: "down".into(),
                amount: 5
            }
            .describe(),
            "scroll down 5"
        );
        assert_eq!(
            ControlAction::Drag {
                from: ClickTarget::Element("foo".into()),
                to: ClickTarget::Coord(10.0, 20.0)
            }
            .describe(),
            "drag from element foo to (10, 20)"
        );
        assert_eq!(
            ControlAction::RightClick(ClickTarget::Element("foo".into())).describe(),
            "right-click element foo"
        );
        assert_eq!(
            ControlAction::DoubleClick(ClickTarget::Coord(3.0, 4.0)).describe(),
            "double-click (3, 4)"
        );
        assert_eq!(
            ControlAction::MouseMove(7.0, 9.0).describe(),
            "move mouse to (7, 9)"
        );
    }

    #[test]
    fn pointer_actions_are_not_risky_locally() {
        // Navigation/pointer ops carry no per-action confirm at the keyboard.
        for a in [
            ControlAction::Scroll {
                direction: "down".into(),
                amount: 3,
            },
            ControlAction::Drag {
                from: ClickTarget::Coord(0.0, 0.0),
                to: ClickTarget::Coord(1.0, 1.0),
            },
            ControlAction::RightClick(ClickTarget::Element("e1".into())),
            ControlAction::DoubleClick(ClickTarget::Element("e1".into())),
            ControlAction::MouseMove(1.0, 2.0),
        ] {
            assert!(!a.is_risky(), "should not gate locally: {}", a.describe());
            assert!(a.permission().is_none());
            assert!(a.target_app().is_none());
        }
    }

    #[test]
    fn remote_gate_treats_outward_facing_right_and_double_click_as_risky() {
        // Right/double-clicking a "Send"/"Delete" element is bounced over the
        // unattended remote channel, just like a left click.
        assert!(ControlAction::RightClick(ClickTarget::Element("Delete".into())).is_risky_remote());
        assert!(
            ControlAction::DoubleClick(ClickTarget::Element("Send draft".into())).is_risky_remote()
        );
        // A benign element is not.
        assert!(
            !ControlAction::DoubleClick(ClickTarget::Element("Notes".into())).is_risky_remote()
        );
    }

    #[tokio::test]
    async fn gate_executes_pointer_actions_through_the_mock_bridge() {
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let actions = [
            ControlAction::Scroll {
                direction: "down".into(),
                amount: 4,
            },
            ControlAction::Drag {
                from: ClickTarget::Element("a".into()),
                to: ClickTarget::Element("b".into()),
            },
            ControlAction::RightClick(ClickTarget::Element("e1".into())),
            ControlAction::DoubleClick(ClickTarget::Coord(5.0, 6.0)),
            ControlAction::MouseMove(1.0, 2.0),
        ];
        for a in &actions {
            // None are refused or held — they execute immediately.
            assert!(matches!(
                gate.submit(&bridge, a).await.unwrap(),
                Disposition::Executed(_)
            ));
        }
        assert_eq!(
            bridge.calls(),
            vec![
                "scroll:down:4",
                "drag:Element(\"a\")->Element(\"b\")",
                "right_click:Element(\"e1\")",
                "double_click:Coord(5.0, 6.0)",
                "mouse_move:1,2",
            ]
        );
    }

    #[tokio::test]
    async fn logging_bridge_records_pointer_mutations() {
        // The trust layer captures the new pointer actions too.
        let inner = MockBridge::default();
        let log = Arc::new(Mutex::new(ActionLog::default()));
        let bridge = LoggingBridge::new(&inner, Arc::clone(&log));
        bridge.scroll("down", 3).await.unwrap();
        bridge
            .drag(
                &ClickTarget::Element("a".into()),
                &ClickTarget::Coord(1.0, 2.0),
            )
            .await
            .unwrap();
        bridge
            .right_click(&ClickTarget::Element("e1".into()))
            .await
            .unwrap();
        bridge
            .double_click(&ClickTarget::Element("e2".into()))
            .await
            .unwrap();
        bridge.mouse_move(7.0, 8.0).await.unwrap();
        let trail = log.lock().unwrap().trail();
        assert_eq!(trail.len(), 5, "all five pointer mutations are recorded");
        assert!(trail[0].contains("scroll down 3"));
        assert!(trail[1].contains("drag from"));
        assert!(trail[2].contains("right-click"));
        assert!(trail[3].contains("double-click"));
        assert!(trail[4].contains("move mouse"));
    }

    #[test]
    fn pointer_actions_wire_roundtrip_matches_the_app_contract() {
        // The Rust↔macOS-app contract for the new actions (the follow-up the app
        // side must implement).
        assert_eq!(
            action_to_wire(&ControlAction::Scroll {
                direction: "down".into(),
                amount: 5
            }),
            json!({ "kind": "scroll", "direction": "down", "amount": 5 })
        );
        assert_eq!(
            action_to_wire(&ControlAction::Drag {
                from: ClickTarget::Element("a".into()),
                to: ClickTarget::Coord(9.0, 3.0)
            }),
            json!({ "kind": "drag", "from": { "element": "a" }, "to": { "x": 9.0, "y": 3.0 } })
        );
        assert_eq!(
            action_to_wire(&ControlAction::RightClick(ClickTarget::Element(
                "e1".into()
            ))),
            json!({ "kind": "right_click", "element": "e1" })
        );
        assert_eq!(
            action_to_wire(&ControlAction::DoubleClick(ClickTarget::Coord(5.0, 6.0))),
            json!({ "kind": "double_click", "x": 5.0, "y": 6.0 })
        );
        assert_eq!(
            action_to_wire(&ControlAction::MouseMove(4.0, 8.0)),
            json!({ "kind": "move_mouse", "x": 4.0, "y": 8.0 })
        );
    }

    #[tokio::test]
    async fn executor_runs_pointer_tool_calls_end_to_end() {
        // From model tool-call JSON all the way through parse → gate → bridge.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let calls = vec![
            (
                "1".into(),
                "scroll".into(),
                json!({ "direction": "down", "amount": 3 }),
            ),
            ("2".into(), "right_click".into(), json!({ "element": "e1" })),
            ("3".into(), "done".into(), json!({})),
        ];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert!(out.done);
        assert_eq!(
            bridge.calls(),
            vec!["scroll:down:3", "right_click:Element(\"e1\")"]
        );
        assert!(!out.results[0]["is_error"].as_bool().unwrap_or(false));
    }

    #[tokio::test]
    async fn submit_is_confidence_gated_on_uncertain_reversible_actions() {
        // P2 #1 (flip + unify): the confidence axis is AUTHORITATIVE now. A
        // reversible, known action runs unprompted only when the forecast is
        // confident; an unforecast / low-confidence one is held for confirmation.
        // Refusals and risky actions are unaffected (covered by their own tests).
        let bridge = DryRunBridge;
        let gate = ControlGate::default();
        let scroll = ControlAction::Scroll {
            direction: "down".into(),
            amount: 1,
        };

        // Confident reversible + known → runs.
        assert!(matches!(
            gate.submit_confident(&bridge, &scroll, 0.95).await.unwrap(),
            Disposition::Executed(_)
        ));
        // Low-confidence (or unforecast) reversible → ask.
        assert!(matches!(
            gate.submit_confident(&bridge, &scroll, 0.40).await.unwrap(),
            Disposition::NeedsConfirmation(_)
        ));
        // The 2-arg `submit` keeps the attended default (1.0) → runs.
        assert!(matches!(
            gate.submit(&bridge, &scroll).await.unwrap(),
            Disposition::Executed(_)
        ));
    }

    #[tokio::test]
    async fn a_world_corroborated_forecast_crosses_the_auto_floor_and_runs() {
        // The predict step (ADR-0007 §4) feeds the gate's confidence axis: a
        // reversible, known action the world model anticipates — an established
        // chain step (`expected`) that names a known entity (`grounded`) — is
        // vouched over the auto floor and runs unprompted, even when the engine
        // alone was unsure. The SAME action with no corroboration is held to ask.
        // (The world read is covered by `world::expectation`; here we compose the
        // pure forecast with the live gate, IO-free.)
        let bridge = DryRunBridge;
        let gate = ControlGate::default();
        let scroll = ControlAction::Scroll {
            direction: "down".into(),
            amount: 1,
        };

        // Engine unsure (0.5) but the world model anticipates an established,
        // grounded step → vouched over the floor → runs.
        let corroborated = crate::predict::forecast(0.5, true, true);
        assert!(matches!(
            gate.submit_confident(&bridge, &scroll, corroborated)
                .await
                .unwrap(),
            Disposition::Executed(_)
        ));
        // Same engine confidence, no world corroboration → asks.
        let uncorroborated = crate::predict::forecast(0.5, false, false);
        assert!(matches!(
            gate.submit_confident(&bridge, &scroll, uncorroborated)
                .await
                .unwrap(),
            Disposition::NeedsConfirmation(_)
        ));
    }

    #[test]
    fn gate_carries_and_clones_the_cross_turn_last_action() {
        // The predict step's cross-turn predecessor rides on the gate (seeded once
        // per turn by the loop). It round-trips, and a clone keeps it — the clone
        // run_control_agent makes to attach the signed-in user.
        let gate = ControlGate::default();
        assert_eq!(gate.last_action(), None);
        gate.set_last_action(Some("open editor".into()));
        assert_eq!(gate.last_action().as_deref(), Some("open editor"));

        let scoped = gate.clone().with_user(Some("u1".into()));
        assert_eq!(scoped.last_action().as_deref(), Some("open editor"));
        assert_eq!(scoped.user_id(), Some("u1"));
    }

    #[test]
    fn predict_prev_prefers_within_turn_then_falls_back_to_cross_turn() {
        // Within a turn, the immediately prior executed action is the predecessor;
        // for a turn's first action (none executed yet), the cross-turn seed is.
        assert_eq!(predict_prev(Some("B"), Some("A")), Some("B"));
        assert_eq!(predict_prev(None, Some("A")), Some("A"));
        assert_eq!(predict_prev(None, None), None);
    }

    #[tokio::test]
    async fn executor_records_only_executed_actions_for_the_proactive_chain() {
        // `out.executed` feeds the world-model chain (observe_transition): only
        // actions that actually RAN are listed, in order; a refused action is not.
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        // `confirm` returns true, so confidence-gated reversible actions run via
        // the confirmed path; the refusal boundary still holds independently.
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let calls = vec![
            (
                "1".into(),
                "scroll".into(),
                json!({ "direction": "down", "amount": 1 }),
            ),
            (
                "2".into(),
                "type".into(),
                json!({ "text": "my password is hunter2" }),
            ),
            ("3".into(), "right_click".into(), json!({ "element": "e1" })),
        ];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert_eq!(
            out.executed,
            vec![
                "scroll down 1".to_string(),
                "right-click element e1".to_string(),
            ],
            "only executed actions, in order; the refused password is excluded"
        );
    }

    /// A bridge that supplies BOTH a snapshot (with screen bounds) and a live
    /// gaze point — the shape the macOS app will have once it feeds gaze. Lets
    /// us assert the loop's assembled context actually grows a focus block.
    struct GazingBridge {
        graph: ScreenGraph,
        gaze: Option<eri_coreutils::services::gaze::GazePoint>,
    }

    #[async_trait::async_trait]
    impl ControlBridge for GazingBridge {
        async fn snapshot(&self) -> Result<ScreenGraph> {
            Ok(self.graph.clone())
        }
        async fn capture(&self) -> Result<String> {
            Ok("ZmFrZS1wbmc=".into())
        }
        async fn gaze(&self) -> Option<eri_coreutils::services::gaze::GazePoint> {
            self.gaze
        }
        async fn click(&self, _t: &ClickTarget) -> Result<String> {
            Ok("clicked".into())
        }
        async fn type_text(&self, _text: &str) -> Result<String> {
            Ok("typed".into())
        }
        async fn key(&self, _combo: &str) -> Result<String> {
            Ok("pressed".into())
        }
        async fn open_app(&self, name: &str) -> Result<String> {
            Ok(format!("opened {name}"))
        }
        async fn quit_app(&self, name: &str) -> Result<String> {
            Ok(format!("quit {name}"))
        }
    }

    fn gazing_graph() -> ScreenGraph {
        ScreenGraph {
            app: "Mail".into(),
            window: "Inbox".into(),
            elements: vec![AxElement {
                id: "send".into(),
                role: "button".into(),
                label: "Send".into(),
                actionable: true,
                frame: [100.0, 100.0, 200.0, 50.0], // normalised x∈[.1,.3] y∈[.1,.15]
            }],
            screen: Some([0.0, 0.0, 1000.0, 1000.0]),
        }
    }

    #[tokio::test]
    async fn context_blocks_include_focus_when_gaze_present() {
        // Gaze inside "Send" → the assembled system context grows a focus block.
        let bridge = GazingBridge {
            graph: gazing_graph(),
            gaze: Some(eri_coreutils::services::gaze::GazePoint {
                x: 0.2,
                y: 0.12,
                confidence: 1.0,
                ts_ms: 0,
            }),
        };
        let ws = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let blocks = context_blocks("send the email", &bridge, &ws).await;
        assert!(
            blocks.iter().any(|b| b.contains("<eri:focus")
                && b.contains("You're looking at: button \"Send\" (id send)")),
            "expected a gaze-focus block, got: {blocks:?}"
        );
    }

    #[tokio::test]
    async fn context_blocks_omit_focus_when_no_gaze() {
        // No gaze (the default seam state) → no focus block, exactly as before.
        let bridge = GazingBridge {
            graph: gazing_graph(),
            gaze: None,
        };
        let ws = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let blocks = context_blocks("send the email", &bridge, &ws).await;
        assert!(
            !blocks.iter().any(|b| b.contains("<eri:focus")),
            "no gaze must mean no focus block, got: {blocks:?}"
        );
    }

    // ───────────────────── coding-environment control ─────────────────────

    #[tokio::test]
    async fn coding_open_file_lowers_to_quick_open_path_enter_through_the_gate() {
        // editor_open_file tool JSON → lowered primitives → gate → bridge. The
        // ordering (⌘P, then the path, then Enter) is the load-bearing contract.
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let calls = vec![(
            "1".into(),
            "editor_open_file".into(),
            json!({ "path": "src/main.rs" }),
        )];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert_eq!(
            bridge.calls(),
            vec!["key:cmd+p", "type:src/main.rs", "key:enter"],
            "open_file must emit quick-open, the path, then submit, in order"
        );
        // One tool_result summarises the whole sequence, not an error.
        assert_eq!(out.results.len(), 1);
        assert!(!out.results[0]["is_error"].as_bool().unwrap_or(false));
    }

    #[tokio::test]
    async fn coding_command_and_steer_agent_emit_their_palette_sequences() {
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let calls = vec![
            (
                "1".into(),
                "editor_command".into(),
                json!({ "command": "Format Document" }),
            ),
            (
                "2".into(),
                "editor_steer_agent".into(),
                json!({ "prompt": "write a test for parse_action" }),
            ),
        ];
        let _ = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert_eq!(
            bridge.calls(),
            vec![
                "key:cmd+shift+p",
                "type:Format Document",
                "key:enter",
                "key:cmd+l",
                "type:write a test for parse_action",
                "key:enter",
            ]
        );
    }

    #[tokio::test]
    async fn coding_accept_reject_save_emit_single_keys() {
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let calls = vec![
            ("1".into(), "editor_accept_suggestion".into(), json!({})),
            ("2".into(), "editor_reject_suggestion".into(), json!({})),
            ("3".into(), "editor_save".into(), json!({})),
        ];
        let _ = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert_eq!(
            bridge.calls(),
            vec!["key:cmd+enter", "key:esc", "key:cmd+s"]
        );
    }

    #[tokio::test]
    async fn benign_editor_command_executes_without_confirmation() {
        // A normal palette command ("Run Tests") is navigation/typing — it runs
        // straight through, no confirm prompt.
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| {
            panic!("benign editor command must not ask for confirmation")
        };
        let calls = vec![(
            "1".into(),
            "editor_command".into(),
            json!({ "command": "Run Tests" }),
        )];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert_eq!(
            bridge.calls(),
            vec!["key:cmd+shift+p", "type:Run Tests", "key:enter"]
        );
        assert!(!out.results[0]["is_error"].as_bool().unwrap_or(false));
    }

    #[tokio::test]
    async fn destructive_editor_command_still_trips_the_risk_gate() {
        // A palette command whose typed text looks destructive ("rm -rf") MUST
        // still flow through the content-aware risk check: the ⌘⇧P keystroke runs,
        // but the Type("rm -rf ...") step is held for confirmation. With the user
        // declining, the rest of the sequence (Enter) is dropped.
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut declined: Option<String> = None;
        let mut confirm = |desc: &str, _: Option<crate::control_safety::Permission>| {
            declined = Some(desc.to_string());
            false // user says no
        };
        let calls = vec![(
            "1".into(),
            "editor_command".into(),
            json!({ "command": "rm -rf node_modules" }),
        )];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        // ⌘⇧P opened the palette; the destructive Type was held and declined, so
        // Enter never ran. The dangerous keystroke was never actuated.
        assert_eq!(
            bridge.calls(),
            vec!["key:cmd+shift+p"],
            "destructive typing must be gated, not actuated"
        );
        assert!(
            declined.is_some_and(|d| d.contains("rm -rf")),
            "the destructive text is what was held for confirmation"
        );
        let content = out.results[0]["content"].as_str().unwrap_or("");
        assert!(content.contains("declined"), "got: {content}");
    }

    #[tokio::test]
    async fn destructive_steer_agent_prompt_is_refused_or_gated() {
        // Steering the editor's AI with a prompt carrying a destructive command
        // ("DROP TABLE users") must also pass the risk gate on the Type step.
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut held = false;
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| {
            held = true;
            false
        };
        let calls = vec![(
            "1".into(),
            "editor_steer_agent".into(),
            json!({ "prompt": "run DROP TABLE users; for me" }),
        )];
        let _ = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert!(held, "the destructive prompt text must be gated");
        assert_eq!(
            bridge.calls(),
            vec!["key:cmd+l"],
            "only the chat-open keystroke ran before the gate held the prompt"
        );
    }

    #[tokio::test]
    async fn malformed_coding_tool_is_an_error_not_a_panic() {
        // Missing required field → a clean error tool_result, no actuation.
        let bridge = MockBridge::default();
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let calls = vec![("1".into(), "editor_open_file".into(), json!({}))];
        let out = execute_tool_calls(&bridge, &gate, &mut confirm, None, &calls).await;
        assert!(out.results[0]["is_error"].as_bool().unwrap());
        assert!(bridge.calls().is_empty());
    }

    #[tokio::test]
    async fn loop_drives_a_coding_tool_end_to_end_with_no_cloud_client() {
        // Model-driven path: a stubbed engine emits editor_open_file then done.
        // The tool JSON flows through the gate to the bridge as the right
        // keystroke sequence, entirely through the ControlTurn seam (no network).
        let bridge = MockBridge::with_snapshot(graph());
        let gate = ControlGate::default();
        let mut confirm = |_: &str, _: Option<crate::control_safety::Permission>| true;
        let stub = StubTurn::new(
            "local",
            vec![
                Ok(tool_call_turn(
                    "t1",
                    "editor_open_file",
                    json!({ "path": "Cargo.toml" }),
                )),
                Ok(done_turn("Opened Cargo.toml.")),
            ],
        );
        let sink = RecordingSink::default();
        let system = vec![json!({ "type": "text", "text": "sys" })];
        let tools = json!(tool_specs());
        let out = drive_control_loop(
            &[&stub],
            &bridge,
            &gate,
            &mut confirm,
            &sink,
            &system,
            &tools,
            "open Cargo.toml in the editor",
            8,
            false,
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.text, "Opened Cargo.toml.");
        assert_eq!(
            bridge.calls(),
            vec!["key:cmd+p", "type:Cargo.toml", "key:enter"]
        );
    }
}
