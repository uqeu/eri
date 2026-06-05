//! OS-level sandboxing for the privileged `bash` tool (macOS `sandbox-exec`).
//!
//! `bash` is eri's one non-sandboxed capability: a prompt-injected file or
//! AGENTS.md could steer it to write outside the workspace or exfiltrate over
//! the network. `--allow-shell` already makes it opt-in; `--sandbox` adds
//! defense-in-depth by running each shell command under a restrictive seatbelt
//! profile that:
//!   - allows reads anywhere (builds need to read toolchains, headers, ...),
//!   - allows writes ONLY under the workspace + standard temp dirs + null/tty,
//!   - denies all network access.
//!
//! Implemented on macOS via `/usr/bin/sandbox-exec` (SBPL). On other platforms
//! `sandbox-exec` doesn't exist; `is_available()` returns false and the caller
//! fails closed (refuses sandboxed bash) rather than silently running unsandboxed.
//!
//! The profile builder is a pure function (unit-tested); the wrapper just shapes
//! the `sandbox-exec -p <profile> sh -c <command>` argv.

use std::path::Path;

/// True when OS sandboxing for shell is available (macOS with sandbox-exec).
pub fn is_available() -> bool {
    cfg!(target_os = "macos") && Path::new("/usr/bin/sandbox-exec").exists()
}

/// Build an SBPL ("seatbelt") profile: allow-by-default, then deny writes +
/// network, then re-allow writes under the workspace and the standard temp /
/// device paths a build legitimately needs. `workspace` MUST be canonical
/// (symlinks resolved) -- on macOS `/tmp` -> `/private/tmp`, and `subpath`
/// matches the real path, so a non-canonical workspace would block its own writes.
pub fn profile(workspace: &Path) -> String {
    let ws = workspace.display();
    // Writable roots beyond the workspace: macOS temp (TMPDIR lives under
    // /private/var/folders), the classic temp dirs, and the std write devices.
    let mut sbpl = String::from(
        "(version 1)\n\
         (allow default)\n\
         (deny file-write*)\n\
         (deny network*)\n",
    );
    let writable = [
        ws.to_string(),
        "/private/var/folders".to_string(),
        "/private/tmp".to_string(),
        "/tmp".to_string(),
        "/dev/null".to_string(),
        "/dev/stdout".to_string(),
        "/dev/stderr".to_string(),
        "/dev/tty".to_string(),
        "/dev/dtracehelper".to_string(),
    ];
    for w in writable {
        // Quote the path; SBPL string literals are double-quoted.
        sbpl.push_str(&format!("(allow file-write* (subpath \"{w}\"))\n"));
    }
    sbpl
}

/// Shape the argv to run `command` sandboxed: `sandbox-exec -p <profile> sh -c
/// <command>`. The profile is passed inline (`-p`) -- no temp file. Caller
/// supplies a canonical workspace. Returns `(program, args)`.
pub fn wrap(workspace: &Path, command: &str) -> (String, Vec<String>) {
    let prof = profile(workspace);
    (
        "/usr/bin/sandbox-exec".to_string(),
        vec![
            "-p".to_string(),
            prof,
            "sh".to_string(),
            "-c".to_string(),
            command.to_string(),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    #[cfg(target_os = "macos")]
    use tempfile::TempDir;

    #[test]
    fn profile_allows_workspace_denies_network() {
        let p = profile(&PathBuf::from("/private/tmp/ws"));
        assert!(p.contains("(version 1)"));
        assert!(p.contains("(deny network*)"));
        assert!(p.contains("(deny file-write*)"));
        // Workspace is re-allowed for writes...
        assert!(p.contains("(allow file-write* (subpath \"/private/tmp/ws\"))"));
        // ...and the deny precedes the workspace re-allow (SBPL: last match wins).
        let deny_at = p.find("(deny file-write*)").unwrap();
        let allow_ws = p.find("subpath \"/private/tmp/ws\"").unwrap();
        assert!(deny_at < allow_ws);
        // Temp + null devices are writable for real builds.
        assert!(p.contains("/private/var/folders"));
        assert!(p.contains("/dev/null"));
    }

    #[test]
    fn wrap_shapes_sandbox_exec_argv() {
        let (prog, args) = wrap(&PathBuf::from("/private/tmp/ws"), "echo hi");
        assert_eq!(prog, "/usr/bin/sandbox-exec");
        assert_eq!(args[0], "-p");
        assert!(args[1].contains("(version 1)")); // the profile
        assert_eq!(args[2], "sh");
        assert_eq!(args[3], "-c");
        assert_eq!(args[4], "echo hi");
    }

    /// Real enforcement check (macOS only): the sandbox must allow a write
    /// inside the workspace yet block network egress. Uses only safe operations
    /// (a workspace-local file + a short-timeout curl) so a sandbox failure has
    /// no side effects outside the temp workspace.
    #[cfg(target_os = "macos")]
    #[test]
    fn sandbox_enforces_workspace_write_and_blocks_network() {
        use std::process::Command;
        if !is_available() {
            return;
        }
        let ws = TempDir::new().unwrap();
        let ws_real = ws.path().canonicalize().unwrap();

        // Write inside the workspace is allowed.
        let (prog, args) = wrap(
            &ws_real,
            &format!("echo hi > '{}/ok.txt' && echo INSIDE_OK", ws_real.display()),
        );
        let out = Command::new(&prog)
            .args(&args)
            .current_dir(&ws_real)
            .output()
            .expect("run sandboxed");
        assert!(
            String::from_utf8_lossy(&out.stdout).contains("INSIDE_OK"),
            "workspace write should be allowed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(ws_real.join("ok.txt").exists());

        // Network egress is denied.
        let (prog, args) = wrap(
            &ws_real,
            "curl -s --max-time 4 http://example.com >/dev/null && echo NET_OK || echo NET_BLOCKED",
        );
        let out = Command::new(&prog)
            .args(&args)
            .output()
            .expect("run sandboxed");
        assert!(
            String::from_utf8_lossy(&out.stdout).contains("NET_BLOCKED"),
            "network must be blocked under the sandbox"
        );
    }
}
