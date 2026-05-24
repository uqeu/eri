use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use eri_core::{GazeTarget, PromptCtx};

#[derive(Debug, Clone)]
pub struct HandoffFile {
    pub path: PathBuf,
    pub markdown: String,
}

impl HandoffFile {
    /// Serialize the iterator's [`PromptCtx`] into a markdown handoff document
    /// and persist it under `root`. The file is timestamped so each handoff is
    /// distinct, and the path is returned for the caller to feed to Claude /
    /// Codex / Kimi from the integrated terminal.
    pub fn write_for(ctx: &PromptCtx, root: &Path) -> Result<Self> {
        fs::create_dir_all(root)
            .with_context(|| format!("creating handoff directory {}", root.display()))?;
        let markdown = serialize_markdown(ctx);
        let file_path = root.join(format!("eri-handoff-{}.md", timestamp()));
        fs::write(&file_path, &markdown)
            .with_context(|| format!("writing handoff file {}", file_path.display()))?;
        Ok(Self {
            path: file_path,
            markdown,
        })
    }
}

fn serialize_markdown(ctx: &PromptCtx) -> String {
    let mut buf = String::new();
    buf.push_str("# eri handoff\n\n");
    buf.push_str(
        "This is an eri-built prompt. Implement the request below in the project root.\n\n",
    );

    buf.push_str("## Target\n");
    buf.push_str(&format_gaze_target(ctx.gaze_target()));
    buf.push_str("\n\n");

    if let Some(selection) = ctx.editor_selection() {
        buf.push_str(&format!(
            "## Editor selection\n`{}:{}-{}`\n\n",
            selection.path.display(),
            selection.line_range.start,
            selection.line_range.end
        ));
    }

    if !ctx.transcript().is_empty() {
        buf.push_str("## Committed voice turns\n");
        for turn in ctx.transcript() {
            buf.push_str("- ");
            buf.push_str(turn);
            buf.push('\n');
        }
        buf.push('\n');
    }

    if let Some(partial) = ctx.partial_transcript() {
        buf.push_str("## Currently saying\n");
        buf.push_str(partial);
        buf.push_str("\n\n");
    }

    if !ctx.current_draft().is_empty() {
        buf.push_str("## Diffusion draft\n```\n");
        buf.push_str(ctx.current_draft());
        if !ctx.current_draft().ends_with('\n') {
            buf.push('\n');
        }
        buf.push_str("```\n\n");
    }

    if !ctx.candidate_patches().is_empty() {
        buf.push_str("## Candidate patches\n");
        for patch in ctx.candidate_patches() {
            buf.push_str(&format!(
                "### Patch #{} · {}\n```diff\n",
                patch.id,
                patch.path.display()
            ));
            for line in patch.old_text.lines() {
                buf.push('-');
                buf.push_str(line);
                buf.push('\n');
            }
            for line in patch.new_text.lines() {
                buf.push('+');
                buf.push_str(line);
                buf.push('\n');
            }
            buf.push_str("```\n");
        }
        buf.push('\n');
    }

    if !ctx.open_files().is_empty() {
        buf.push_str("## Open files\n");
        for file in ctx.open_files() {
            buf.push_str(&format!(
                "### {}\n```\n{}\n```\n",
                file.path.display(),
                file.text
            ));
        }
    }

    buf
}

fn format_gaze_target(target: &GazeTarget) -> String {
    match target {
        GazeTarget::Preview {
            element_label,
            confidence,
            source_hint,
            ..
        } => {
            let element = element_label.as_deref().unwrap_or("unknown");
            if let Some(hint) = source_hint {
                format!(
                    "Preview `{}` ({}:{}-{}) · confidence {:.0}%",
                    element,
                    hint.path.display(),
                    hint.line_range.start,
                    hint.line_range.end,
                    confidence * 100.0
                )
            } else {
                format!(
                    "Preview `{element}` · confidence {:.0}%",
                    confidence * 100.0
                )
            }
        }
        GazeTarget::Editor {
            path,
            line_range,
            confidence,
        } => format!(
            "Editor `{}:{}-{}` · confidence {:.0}%",
            path.display(),
            line_range.start,
            line_range.end,
            confidence * 100.0
        ),
        GazeTarget::Panel {
            panel_id,
            confidence,
        } => format!("Panel `{panel_id}` · confidence {:.0}%", confidence * 100.0),
        GazeTarget::Unknown { confidence } => {
            format!("Unknown · confidence {:.0}%", confidence * 100.0)
        }
    }
}

fn timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use eri_core::{Bounds, LineRange, SourceHint};
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn handoff_markdown_includes_turns_target_and_patch() -> Result<()> {
        let dir = tempdir()?;
        let mut ctx = PromptCtx::default();
        ctx.set_file_context(
            PathBuf::from("App.tsx"),
            "button { background: blue; }".into(),
        );
        ctx.set_gaze_target(GazeTarget::Preview {
            element_label: Some("Subscribe".into()),
            bounds: Bounds::new(10.0, 20.0, 120.0, 36.0),
            source_hint: Some(SourceHint::new(
                PathBuf::from("App.tsx"),
                LineRange::new(1, 1),
                Some("button.subscribe".into()),
            )),
            confidence: 0.82,
        });
        ctx.commit_transcript_chunk("make the subscribe button red");

        let handoff = HandoffFile::write_for(&ctx, dir.path())?;
        assert!(handoff.path.exists());
        assert!(handoff.markdown.contains("# eri handoff"));
        assert!(handoff.markdown.contains("Subscribe"));
        assert!(handoff.markdown.contains("make the subscribe button red"));
        assert!(handoff.markdown.contains("App.tsx"));
        Ok(())
    }
}
