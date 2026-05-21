use eri_control::{ActionDisposition, ActionGateway};
use eri_core::{GazeTarget, IdeAction};

#[test]
fn non_destructive_actions_execute_immediately() {
    let mut gateway = ActionGateway::default();

    let disposition = gateway.submit(IdeAction::HighlightTarget {
        target: GazeTarget::Unknown { confidence: 0.0 },
    });

    assert_eq!(disposition, ActionDisposition::Executed);
    assert_eq!(gateway.executed_actions().len(), 1);
    assert!(gateway.pending_confirmation().is_none());
}

#[test]
fn destructive_actions_wait_for_explicit_confirmation() {
    let mut gateway = ActionGateway::default();

    let disposition = gateway.submit(IdeAction::ApplyPatch { patch_id: 42 });

    assert_eq!(disposition, ActionDisposition::PendingConfirmation);
    assert_eq!(
        gateway.pending_confirmation(),
        Some(&IdeAction::ApplyPatch { patch_id: 42 })
    );
    assert!(gateway.executed_actions().is_empty());

    let confirmed = gateway.confirm_pending().unwrap();

    assert_eq!(confirmed, IdeAction::ApplyPatch { patch_id: 42 });
    assert_eq!(
        gateway.executed_actions(),
        &[IdeAction::ApplyPatch { patch_id: 42 }]
    );
    assert!(gateway.pending_confirmation().is_none());
}

#[test]
fn rejected_pending_action_is_not_executed() {
    let mut gateway = ActionGateway::default();

    gateway.submit(IdeAction::OpenTerminal);
    let rejected = gateway.reject_pending().unwrap();

    assert_eq!(rejected, IdeAction::OpenTerminal);
    assert!(gateway.executed_actions().is_empty());
    assert!(gateway.pending_confirmation().is_none());
}
