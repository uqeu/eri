//! Trust layer — eri's record of what it actually *did*, and how to take it back.
//!
//! An agent that clicks and types on your machine has to be accountable: you
//! need to see "what did eri just do?" and have a one-step undo for anything
//! reversible. This module is that core — an append-only [`ActionLog`] of
//! [`ActionRecord`]s plus a pure [`undo_plan_for`] mapper.
//!
//! Undo is honest about its limits: opening/quitting an app is reversible (the
//! inverse is quitting/reopening), but a click or a keystroke can't be
//! faithfully un-done — eri says so instead of pretending. The log is the seam
//! the live control loop records into, and the future "activity feed + undo"
//! surface reads from.

use crate::control_agent::ControlAction;

/// How (if at all) an action eri performed can be reversed. Total over
/// [`ControlAction`] so every action eri can take has a defined undo story.
#[derive(Clone, Debug, PartialEq)]
pub enum UndoPlan {
    /// Reversible by performing this inverse action (e.g. open → quit).
    Inverse(ControlAction),
    /// It happened, but can't be auto-undone (typing, clicking). Carries why,
    /// so eri can hand it back to the user clearly.
    Irreversible(String),
    /// Nothing to undo — a perception/wait step that changed no state.
    Noop,
}

/// The conservative inverse of a control action. Pure + total. Reopening a
/// quit app loses its state (a partial undo), but it's the honest best effort;
/// typing/clicking are explicitly irreversible rather than faked.
pub fn undo_plan_for(action: &ControlAction) -> UndoPlan {
    match action {
        ControlAction::OpenApp(a) => UndoPlan::Inverse(ControlAction::QuitApp(a.clone())),
        ControlAction::QuitApp(a) => UndoPlan::Inverse(ControlAction::OpenApp(a.clone())),
        ControlAction::Type(t) => UndoPlan::Irreversible(format!("typed {t:?}")),
        ControlAction::Click(_) => UndoPlan::Irreversible("a click".to_string()),
        ControlAction::Key(k) => UndoPlan::Irreversible(format!("pressed {k}")),
        ControlAction::Observe | ControlAction::Wait(_) => UndoPlan::Noop,
    }
}

/// One entry in the trail: what eri did, and whether/how it can be undone.
#[derive(Clone, Debug)]
pub struct ActionRecord {
    pub seq: u64,
    /// Human-readable, e.g. "open Safari" (from [`ControlAction::describe`]).
    pub description: String,
    pub undo: UndoPlan,
    pub undone: bool,
}

/// What [`ActionLog::undo_last`] resolved: the inverse to actuate, a clear
/// "can't undo that" hand-back, or nothing to undo.
#[derive(Clone, Debug, PartialEq)]
pub enum UndoOutcome {
    /// Actuate this inverse action; the `String` describes what's being undone.
    Undo(ControlAction, String),
    /// The most recent real action can't be reversed; carries the explanation.
    CantUndo(String),
    /// The log holds no user-meaningful action to undo.
    Nothing,
}

/// Append-only trail of what eri did this session. The live control loop calls
/// [`record`] for each executed action; [`undo_last`] resolves the most recent
/// reversible one. Pure (no I/O) so it's fully unit-testable; persistence and
/// the visible feed are layered on top.
#[derive(Default)]
pub struct ActionLog {
    records: Vec<ActionRecord>,
    next_seq: u64,
}

impl ActionLog {
    /// Record an action eri just performed. Returns its sequence number.
    pub fn record(&mut self, action: &ControlAction) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.records.push(ActionRecord {
            seq,
            description: action.describe(),
            undo: undo_plan_for(action),
            undone: false,
        });
        seq
    }

    /// The human-readable trail ("what eri did"), oldest → newest, with an
    /// `(undone)` marker on reversed entries.
    pub fn trail(&self) -> Vec<String> {
        self.records
            .iter()
            .map(|r| {
                let mark = if r.undone { "  (undone)" } else { "" };
                format!("#{} {}{}", r.seq, r.description, mark)
            })
            .collect()
    }

    /// Resolve undo for the most recent not-yet-undone, user-meaningful action.
    /// Perception/wait steps are skipped (nothing to undo); a reversible action
    /// yields its inverse (and is marked undone); an irreversible one is handed
    /// back with an explanation rather than silently doing nothing.
    pub fn undo_last(&mut self) -> UndoOutcome {
        for r in self.records.iter_mut().rev() {
            if r.undone {
                continue;
            }
            match &r.undo {
                UndoPlan::Noop => continue,
                UndoPlan::Inverse(inverse) => {
                    let inverse = inverse.clone();
                    let desc = r.description.clone();
                    r.undone = true;
                    return UndoOutcome::Undo(inverse, desc);
                }
                UndoPlan::Irreversible(why) => {
                    return UndoOutcome::CantUndo(format!(
                        "I {} ({}) — that can't be auto-undone; you'll need to reverse it yourself.",
                        r.description, why
                    ));
                }
            }
        }
        UndoOutcome::Nothing
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_agent::ClickTarget;

    #[test]
    fn open_and_quit_are_each_other_s_inverse() {
        assert_eq!(
            undo_plan_for(&ControlAction::OpenApp("Safari".into())),
            UndoPlan::Inverse(ControlAction::QuitApp("Safari".into()))
        );
        assert_eq!(
            undo_plan_for(&ControlAction::QuitApp("Cursor".into())),
            UndoPlan::Inverse(ControlAction::OpenApp("Cursor".into()))
        );
    }

    #[test]
    fn typing_clicking_keys_are_irreversible_not_faked() {
        assert!(matches!(
            undo_plan_for(&ControlAction::Type("hi".into())),
            UndoPlan::Irreversible(_)
        ));
        assert!(matches!(
            undo_plan_for(&ControlAction::Click(ClickTarget::Element("e1".into()))),
            UndoPlan::Irreversible(_)
        ));
        assert!(matches!(
            undo_plan_for(&ControlAction::Key("cmd+s".into())),
            UndoPlan::Irreversible(_)
        ));
    }

    #[test]
    fn observe_and_wait_are_noops() {
        assert_eq!(undo_plan_for(&ControlAction::Observe), UndoPlan::Noop);
        assert_eq!(undo_plan_for(&ControlAction::Wait(500)), UndoPlan::Noop);
    }

    #[test]
    fn trail_shows_what_eri_did_in_order() {
        let mut log = ActionLog::default();
        log.record(&ControlAction::OpenApp("Safari".into()));
        log.record(&ControlAction::Type("lofi".into()));
        let trail = log.trail();
        assert_eq!(trail.len(), 2);
        assert!(trail[0].contains("open Safari"));
        assert!(trail[1].contains("type"));
        assert!(trail[0].starts_with("#0"));
        assert!(trail[1].starts_with("#1"));
    }

    #[test]
    fn undo_last_returns_the_inverse_of_a_reversible_action() {
        let mut log = ActionLog::default();
        log.record(&ControlAction::OpenApp("Safari".into()));
        match log.undo_last() {
            UndoOutcome::Undo(inverse, desc) => {
                assert_eq!(inverse, ControlAction::QuitApp("Safari".into()));
                assert!(desc.contains("Safari"));
            }
            other => panic!("expected Undo, got {other:?}"),
        }
        // The record is now marked undone, and there's nothing left to undo.
        assert!(log.trail()[0].contains("(undone)"));
        assert_eq!(log.undo_last(), UndoOutcome::Nothing);
    }

    #[test]
    fn undo_skips_noops_to_reach_the_real_action() {
        let mut log = ActionLog::default();
        log.record(&ControlAction::OpenApp("Safari".into()));
        log.record(&ControlAction::Observe); // perception — not undoable
        log.record(&ControlAction::Wait(200)); // wait — not undoable
        match log.undo_last() {
            UndoOutcome::Undo(inverse, _) => {
                assert_eq!(inverse, ControlAction::QuitApp("Safari".into()))
            }
            other => panic!("expected to undo the open past the noops, got {other:?}"),
        }
    }

    #[test]
    fn undo_hands_back_an_irreversible_last_action() {
        let mut log = ActionLog::default();
        log.record(&ControlAction::OpenApp("Notes".into()));
        log.record(&ControlAction::Type("dear diary".into()));
        // The last real action was typing — eri must say it can't undo it,
        // NOT silently quit Notes (the older reversible action).
        match log.undo_last() {
            UndoOutcome::CantUndo(msg) => {
                assert!(msg.to_lowercase().contains("type"));
                assert!(msg.contains("yourself"));
            }
            other => panic!("expected CantUndo, got {other:?}"),
        }
        // And it did NOT mark anything undone.
        assert!(!log.trail().iter().any(|l| l.contains("(undone)")));
    }

    #[test]
    fn empty_log_has_nothing_to_undo() {
        let mut log = ActionLog::default();
        assert!(log.is_empty());
        assert_eq!(log.undo_last(), UndoOutcome::Nothing);
    }
}
