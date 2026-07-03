//! The coding agent's **recovery brain**.
//!
//! Driving a coder (Cursor / VS Code / Claude Code / a terminal) the human way
//! means things go wrong mid-flight: the AI agent hits an API/usage limit, the
//! editor freezes, a dialog pops up and steals focus, or the agent is simply
//! still thinking. A naive loop blindly re-sends keystrokes into whatever is now
//! on screen — which is how autonomous agents corrupt state.
//!
//! eri's edge is that it has *eyes*. So when a coding step fails, instead of a
//! bare "error" we feed the model a **recovery directive**: look at the screen,
//! classify the blocker, and recover the way a person would — restart a frozen
//! editor, dismiss a popup, wait out a working agent. And for the blockers eri
//! genuinely cannot resolve itself — an API/usage limit (can't pay) or a
//! sign-in prompt (can't authenticate as the user) — it STOPS and hands back,
//! the same boundary discipline as [`crate::control_safety`].
//!
//! Everything here is pure + unit-tested; the live loop in
//! [`crate::control_agent::run_coding_tool`] consults [`recovery_directive`] on a
//! failed coding step.

/// What eri's eyes diagnose when a coding step stalls or fails. Inferred from the
/// failure text now (and, in the loop, the screen the model then captures).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Blocker {
    /// The coding agent hit an API rate/usage limit or ran out of credits.
    ApiLimit,
    /// A sign-in / authentication prompt is blocking progress.
    AuthExpired,
    /// The editor or its agent is unresponsive / hung / timed out.
    Frozen,
    /// A dialog, modal, or permission popup is in the way.
    Popup,
    /// The agent is still working (thinking / generating / loading) — not a
    /// failure, just not done.
    StillWorking,
    /// Couldn't tell from the text — eri must look at the screen to decide.
    Unknown,
}

/// What eri should do about a [`Blocker`]. `HandBackToUser` is the boundary: eri
/// cannot pay a bill or sign in as the user, so it stops and tells them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Recovery {
    /// eri can't fix this itself (billing / login) — stop and tell the user.
    HandBackToUser,
    /// Restart the frozen editor/agent (close + reopen, or force-quit + rejoin).
    Restart,
    /// Read and dismiss/answer the blocking dialog, then resume.
    Dismiss,
    /// Wait for the agent to finish, then re-check before acting.
    Wait,
    /// Look at the screen, then retry / recover as the screen dictates.
    Retry,
}

impl Blocker {
    /// Classify a blocker from failure/screen text. Case-insensitive substring
    /// cues, ordered so the eri-can't-fix-it blockers (limit, auth) win over the
    /// softer ones. Pure.
    pub fn classify(text: &str) -> Blocker {
        let t = text.to_lowercase();
        let has = |needles: &[&str]| needles.iter().any(|n| t.contains(n));
        if has(&[
            "rate limit",
            "usage limit",
            "limit reached",
            "quota",
            "too many requests",
            "429",
            "out of credit",
            "insufficient credit",
            "upgrade your plan",
        ]) {
            Blocker::ApiLimit
        } else if has(&[
            "sign in",
            "sign-in",
            "log in",
            "login",
            "authenticate",
            "session expired",
            "unauthorized",
            "401",
            "not authenticated",
        ]) {
            Blocker::AuthExpired
        } else if has(&[
            "not responding",
            "frozen",
            "unresponsive",
            "timed out",
            "timeout",
            "hung",
            "deadline exceeded",
        ]) {
            Blocker::Frozen
        } else if has(&[
            "dialog",
            "pop-up",
            "popup",
            "modal",
            "allow access",
            "grant permission",
            "do you want to",
        ]) {
            Blocker::Popup
        } else if has(&[
            "thinking",
            "generating",
            "in progress",
            "still working",
            "please wait",
            "loading",
            "streaming",
        ]) {
            Blocker::StillWorking
        } else {
            Blocker::Unknown
        }
    }
}

impl Recovery {
    /// The recovery eri should attempt for a blocker.
    pub fn for_blocker(b: Blocker) -> Recovery {
        match b {
            // eri can neither pay nor sign in as the user — these are boundaries.
            Blocker::ApiLimit | Blocker::AuthExpired => Recovery::HandBackToUser,
            Blocker::Frozen => Recovery::Restart,
            Blocker::Popup => Recovery::Dismiss,
            Blocker::StillWorking => Recovery::Wait,
            Blocker::Unknown => Recovery::Retry,
        }
    }

    /// True when this recovery is a user boundary eri must not try to power
    /// through (mirrors the sensitive-action boundary in control_safety).
    pub fn is_user_boundary(self) -> bool {
        matches!(self, Recovery::HandBackToUser)
    }
}

/// Build the directive fed back to the model when a coding step fails, so eri
/// diagnoses with its eyes and recovers like a person — rather than blindly
/// re-typing into whatever is now on screen. Pure (classify → recover → message).
pub fn recovery_directive(error_text: &str) -> String {
    let blocker = Blocker::classify(error_text);
    let recovery = Recovery::for_blocker(blocker);
    let head = format!("That coding step failed ({}).", error_text.trim());

    // The boundary blockers (limit / auth) short-circuit: eri can't pay or sign
    // in, so it must stop and hand back rather than "recover".
    if recovery.is_user_boundary() {
        let what = match blocker {
            Blocker::ApiLimit => "an API/usage limit (the coding agent is out of quota)",
            _ => "a sign-in / authentication prompt",
        };
        return format!(
            "{head} This looks like {what} — you can't resolve billing or sign in as the user. \
             STOP here: tell the user plainly what's blocking and exactly what they need to do."
        );
    }

    let body = match recovery {
        Recovery::Restart => {
            "Take a screenshot. The editor or its agent looks frozen — restart it \
             (close and reopen, or force-quit and get back into the session), then resume the task."
        }
        Recovery::Dismiss => {
            "Take a screenshot. A dialog or popup is likely blocking — read it, \
             dismiss or answer it appropriately, then resume."
        }
        Recovery::Wait => {
            "The agent is probably still working — wait a few seconds, then look at \
             the screen again before acting (don't re-send into a half-finished response)."
        }
        // Unknown → look first, then recover as the screen dictates.
        _ => {
            "Take a screenshot to see what's actually on screen, diagnose what went wrong, and \
             recover: restart if it's frozen, dismiss if a dialog is blocking, wait if it's still \
             thinking. If it's an API/usage limit or a login prompt, STOP and tell the user."
        }
    };
    format!("{head} {body}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_the_blockers_eri_cannot_fix_first() {
        assert_eq!(
            Blocker::classify("Error: rate limit exceeded"),
            Blocker::ApiLimit
        );
        assert_eq!(
            Blocker::classify("You are out of credits"),
            Blocker::ApiLimit
        );
        assert_eq!(
            Blocker::classify("HTTP 429 Too Many Requests"),
            Blocker::ApiLimit
        );
        assert_eq!(
            Blocker::classify("Please sign in to continue"),
            Blocker::AuthExpired
        );
        assert_eq!(Blocker::classify("401 unauthorized"), Blocker::AuthExpired);
    }

    #[test]
    fn classifies_softer_blockers() {
        assert_eq!(
            Blocker::classify("Cursor is not responding"),
            Blocker::Frozen
        );
        assert_eq!(
            Blocker::classify("A dialog asks: do you want to allow access"),
            Blocker::Popup
        );
        assert_eq!(
            Blocker::classify("the agent is still generating a response"),
            Blocker::StillWorking
        );
        assert_eq!(
            Blocker::classify("element not found at point"),
            Blocker::Unknown
        );
    }

    #[test]
    fn recovery_maps_each_blocker() {
        assert_eq!(
            Recovery::for_blocker(Blocker::ApiLimit),
            Recovery::HandBackToUser
        );
        assert_eq!(
            Recovery::for_blocker(Blocker::AuthExpired),
            Recovery::HandBackToUser
        );
        assert_eq!(Recovery::for_blocker(Blocker::Frozen), Recovery::Restart);
        assert_eq!(Recovery::for_blocker(Blocker::Popup), Recovery::Dismiss);
        assert_eq!(Recovery::for_blocker(Blocker::StillWorking), Recovery::Wait);
        assert_eq!(Recovery::for_blocker(Blocker::Unknown), Recovery::Retry);
    }

    #[test]
    fn only_billing_and_auth_are_user_boundaries() {
        assert!(Recovery::for_blocker(Blocker::ApiLimit).is_user_boundary());
        assert!(Recovery::for_blocker(Blocker::AuthExpired).is_user_boundary());
        assert!(!Recovery::for_blocker(Blocker::Frozen).is_user_boundary());
        assert!(!Recovery::for_blocker(Blocker::Popup).is_user_boundary());
    }

    #[test]
    fn directive_hands_back_on_api_limit_and_tells_model_to_stop() {
        let d = recovery_directive("Claude usage limit reached for this session");
        assert!(d.contains("STOP"), "must tell the model to stop on a limit");
        assert!(d.to_lowercase().contains("limit"));
    }

    #[test]
    fn directive_tells_eri_to_look_and_restart_when_frozen() {
        let d = recovery_directive("the editor is not responding");
        assert!(
            d.to_lowercase().contains("screenshot"),
            "eri should look first"
        );
        assert!(d.to_lowercase().contains("restart"));
        assert!(
            !d.contains("STOP"),
            "a frozen editor is recoverable, not a hand-back"
        );
    }

    #[test]
    fn directive_always_echoes_the_failure() {
        let d = recovery_directive("element not found");
        assert!(d.contains("element not found"));
        assert!(d.to_lowercase().contains("screenshot"));
    }
}
