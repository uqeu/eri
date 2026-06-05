//! The agent's permission posture -- the named capability ladder the loop gates
//! on. Transport-agnostic: it answers "may writes run?" / "may shell run?" and
//! nothing else, so the host maps it onto whatever its loop options are.

/// Ordered least- to most-privileged. Modeled on Claude Code's permission modes
/// and Codex's sandbox levels: the default writes files but never runs shell,
/// and each step up is an explicit opt-in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PermissionMode {
    /// Read-only: explore + plan, no writes, no shell.
    Plan,
    /// Default: file writes allowed; shell still off.
    #[default]
    AcceptEdits,
    /// Writes + shell, scoped to the workspace.
    WorkspaceWrite,
    /// Writes + shell with no extra friction. Named for intent + future
    /// approval-skipping; today its capabilities equal WorkspaceWrite.
    Bypass,
}

impl PermissionMode {
    /// May file-writing tools (write_file / str_replace / apply_patch) run?
    pub fn allows_writes(self) -> bool {
        !matches!(self, PermissionMode::Plan)
    }

    /// Is the privileged, non-sandboxed `bash` tool available?
    pub fn allows_shell(self) -> bool {
        matches!(
            self,
            PermissionMode::WorkspaceWrite | PermissionMode::Bypass
        )
    }

    /// Derive a mode from the legacy `--plan` / `--allow-shell` flags so both
    /// the new `--permission-mode` flag and the old flags map to one model.
    /// `--allow-shell` wins over `--plan` if (incoherently) both are set.
    pub fn from_legacy_flags(plan: bool, allow_shell: bool) -> Self {
        match (plan, allow_shell) {
            (_, true) => PermissionMode::WorkspaceWrite,
            (true, false) => PermissionMode::Plan,
            (false, false) => PermissionMode::AcceptEdits,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_ladder_and_legacy_mapping() {
        assert!(!PermissionMode::Plan.allows_writes());
        assert!(!PermissionMode::Plan.allows_shell());
        assert!(PermissionMode::AcceptEdits.allows_writes());
        assert!(!PermissionMode::AcceptEdits.allows_shell());
        assert!(PermissionMode::WorkspaceWrite.allows_writes());
        assert!(PermissionMode::WorkspaceWrite.allows_shell());
        assert!(PermissionMode::Bypass.allows_writes());
        assert!(PermissionMode::Bypass.allows_shell());
        assert_eq!(PermissionMode::default(), PermissionMode::AcceptEdits);

        assert_eq!(
            PermissionMode::from_legacy_flags(false, false),
            PermissionMode::AcceptEdits
        );
        assert_eq!(
            PermissionMode::from_legacy_flags(true, false),
            PermissionMode::Plan
        );
        assert_eq!(
            PermissionMode::from_legacy_flags(false, true),
            PermissionMode::WorkspaceWrite
        );
        assert_eq!(
            PermissionMode::from_legacy_flags(true, true),
            PermissionMode::WorkspaceWrite
        );
    }
}
