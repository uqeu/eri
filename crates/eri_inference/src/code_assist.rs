//! Cursor-style code productivity helpers: write tests, explain, refactor,
//! and document a piece of code. Each public function builds a Claude Code
//! CLI prompt that the panel hands to [`crate::ClaudeCliBackend::run_code_assist`].
//!
//! The prompts are written to keep Claude's output mechanically extractable:
//!
//! * **Test generation** and **refactor** return a single fenced code block.
//!   The fence language tag is chosen up-front by the prompt so the panel can
//!   just strip the fences.
//! * **Explainer** returns plain prose with no markdown — eri's brain pipes
//!   the result straight through TTS, so any `#` heading would be read aloud.
//! * **Doc generator** returns the input code annotated with inline doc
//!   comments in the requested style (JSDoc, Rustdoc, docstring, or inline
//!   `//`).
//!
//! Voice triggers live in `eri_core::ControlCommand`
//! (`WriteTests`, `ExplainThis`, `RefactorThis`, `DocumentThis`); brain
//! events live in `script/eri_brain_sidecar.py`.

use std::path::Path;

/// Documentation style requested by the user. The panel picks the variant
/// based on the spoken phrasing — "add jsdoc" → [`DocStyle::Jsdoc`],
/// "add docstrings" → [`DocStyle::Docstring`], "add rustdoc" →
/// [`DocStyle::Rustdoc`], plain "document this" / "add docs" →
/// [`DocStyle::Inline`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocStyle {
    Jsdoc,
    Docstring,
    Rustdoc,
    Inline,
}

impl DocStyle {
    fn label(self) -> &'static str {
        match self {
            DocStyle::Jsdoc => "JSDoc",
            DocStyle::Docstring => "Python docstring",
            DocStyle::Rustdoc => "Rustdoc",
            DocStyle::Inline => "inline",
        }
    }

    /// Heuristic mapping from a file extension to the most natural doc
    /// style. Used by the panel when the user voices a bare "document this"
    /// without naming the format.
    pub fn from_path(path: &Path) -> Self {
        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());
        match extension.as_deref() {
            Some("js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs") => DocStyle::Jsdoc,
            Some("py") => DocStyle::Docstring,
            Some("rs") => DocStyle::Rustdoc,
            _ => DocStyle::Inline,
        }
    }
}

/// Classify a file by extension + a quick content sniff for the
/// test-generation prompt. The returned tuple is
/// `(spoken_language_name, fence_tag, test_framework_hint,
/// suggested_test_filename)`.
///
/// `framework_hint` (from the user / panel) wins over the heuristic when
/// present, so a user who says "use vitest" still gets vitest even if we'd
/// have guessed jest.
fn classify_for_tests<'a>(
    file_path: &Path,
    code: &str,
    framework_hint: Option<&'a str>,
) -> (&'static str, &'static str, String, String) {
    let extension = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    let stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("module");
    let parent = file_path.parent();

    let looks_like_html_with_js =
        extension.as_deref() == Some("html") && code.contains("<script");

    let (language, fence, framework_default, ext_for_test): (
        &'static str,
        &'static str,
        &'static str,
        &'static str,
    ) = match extension.as_deref() {
        Some("rs") => ("Rust", "rust", "Rust built-in #[test]", "rs"),
        Some("py") => ("Python", "python", "pytest", "py"),
        Some("ts" | "tsx") => ("TypeScript", "ts", "vitest", "test.ts"),
        Some("js" | "jsx" | "mjs" | "cjs") => ("JavaScript", "js", "vitest", "test.js"),
        Some("html") if looks_like_html_with_js => {
            ("JavaScript (extracted from HTML)", "js", "vitest", "test.js")
        }
        Some("go") => ("Go", "go", "Go's testing package", "_test.go"),
        Some("rb") => ("Ruby", "ruby", "RSpec", "_spec.rb"),
        Some("swift") => ("Swift", "swift", "XCTest", "Tests.swift"),
        _ => ("plain text", "text", "the project's idiomatic test runner", "test"),
    };

    let framework = framework_hint
        .map(|hint| hint.to_string())
        .unwrap_or_else(|| framework_default.to_string());

    // Compose the suggested test filename. Rust and Go use special naming
    // conventions (`mod tests {}` inline, or `<name>_test.go`); JS/TS uses
    // `<name>.test.js`. The prompt embeds this as a hint so Claude doesn't
    // invent a path that breaks the project's test discovery.
    let suggested_filename = match (extension.as_deref(), looks_like_html_with_js) {
        (Some("rs"), _) => format!("tests in a `#[cfg(test)] mod tests` block at the bottom of {stem}.rs"),
        (Some("go"), _) => format!("{stem}_test.go"),
        (Some("html"), true) => format!("{stem}.test.js"),
        _ => format!("{stem}.{ext_for_test}"),
    };

    let suggested_path = match parent {
        Some(dir) if !dir.as_os_str().is_empty() => {
            format!("{} (adjacent to the source file at {})", suggested_filename, dir.display())
        }
        _ => suggested_filename,
    };

    (language, fence, framework, suggested_path)
}

/// Build the "write tests for this" prompt. Embeds the source path so
/// Claude can pick the right test-filename convention for the project and
/// the right test framework (vitest/jest for JS, pytest for Python,
/// `#[test]` for Rust, etc.).
pub fn build_test_generation_prompt(
    file_path: &Path,
    code: &str,
    framework_hint: Option<&str>,
) -> String {
    let (language, fence, framework, suggested_path) =
        classify_for_tests(file_path, code, framework_hint);
    let path_display = file_path.display();

    format!(
        "You are eri's voice-driven test writer. Generate a complete test \
file for the {language} source below.\n\
\n\
SOURCE FILE PATH: {path_display}\n\
SUGGESTED TEST FILE PATH: {suggested_path}\n\
TEST FRAMEWORK: {framework}\n\
\n\
REQUIREMENTS:\n\
- Cover the happy path for every exported / top-level function or \
component, plus 2-3 edge cases per major unit.\n\
- Match the project's existing test patterns if any are visible in the source.\n\
- Use the suggested test file path so the project's test discovery picks \
the file up automatically (`<name>.test.js` adjacent to the source for \
JavaScript / TypeScript, `<name>_test.go` for Go, `#[cfg(test)] mod tests` \
at the bottom of the source for Rust, pytest `test_<name>.py` for Python).\n\
- Do NOT include explanatory prose, headings, or markdown around the code.\n\
- Output EXACTLY one fenced code block tagged ```{fence}` with the full \
contents of the test file. Nothing before or after the block.\n\
\n\
SOURCE CODE:\n\
```{fence}\n\
{code}\n\
```\n"
    )
}

/// Build the "explain this code" prompt. The result is piped directly
/// through TTS, so the prompt explicitly bans markdown headers and asks
/// for 3-5 sentences of plain prose.
pub fn build_code_explainer_prompt(code: &str, focus: Option<&str>) -> String {
    let focus_clause = match focus {
        Some(focus) if !focus.trim().is_empty() => format!(
            "\n\nFOCUS: concentrate your explanation on {focus}. Mention the \
rest of the code only when it directly explains that region."
        ),
        _ => String::new(),
    };

    format!(
        "You are eri's voice-driven code explainer. Read the code below and \
return a 3 to 5 sentence plain-English explanation of WHAT the code does \
and WHY it is written that way.\n\
\n\
STRICT OUTPUT RULES:\n\
- No markdown headers, no bullet lists, no code blocks, no backticks.\n\
- Plain prose only. This will be spoken aloud through text-to-speech, so \
anything that isn't pronounceable is wrong.\n\
- 3 to 5 sentences. No more, no fewer.\n\
- Refer to identifiers by name in plain words (say \"the handle click \
function\" rather than reading symbols).{focus_clause}\n\
\n\
CODE:\n\
{code}\n"
    )
}

/// Build the "refactor this to X" prompt. Returns the refactored code as a
/// single fenced block, with a one-line comment above each non-obvious
/// change explaining why.
pub fn build_refactor_prompt(code: &str, instruction: &str) -> String {
    let trimmed_instruction = instruction.trim();
    format!(
        "You are eri's voice-driven refactor agent. Apply the following \
refactor to the code below WITHOUT changing its observable behavior.\n\
\n\
REFACTOR INSTRUCTION: {trimmed_instruction}\n\
\n\
STRICT OUTPUT RULES:\n\
- Preserve behavior. Public API, return values, side effects, and error \
semantics must stay equivalent.\n\
- Above each NON-OBVIOUS change, add a single line comment explaining \
why. Use the language's comment syntax. Do NOT comment every line — only \
the ones a careful reviewer would otherwise question.\n\
- Output EXACTLY one fenced code block containing the full refactored \
code. Nothing before the block, nothing after it.\n\
- No prose, no headings, no recap.\n\
\n\
CODE:\n\
{code}\n"
    )
}

/// Build the "document this" prompt. The returned code mirrors the input
/// but is annotated with inline documentation comments in the requested
/// style.
pub fn build_doc_generator_prompt(code: &str, style: DocStyle) -> String {
    let style_label = style.label();
    let style_rules = match style {
        DocStyle::Jsdoc => {
            "Use JSDoc `/** ... */` blocks above every exported function, \
class, and method. Document `@param`, `@returns`, and `@throws` where they \
apply. Keep the summary line under 80 characters."
        }
        DocStyle::Docstring => {
            "Use Python docstrings (triple-quoted strings) immediately \
inside every public function, method, and class. Follow PEP 257 — first \
line is a one-line summary, blank line, then optional details. Document \
parameters using the Google or NumPy style if any of them are non-obvious."
        }
        DocStyle::Rustdoc => {
            "Use Rustdoc `///` lines above every public item (`pub fn`, \
`pub struct`, `pub enum`, public trait methods). First line is a single \
short summary; follow it with additional paragraphs only when something \
non-obvious is going on. Use `# Errors` / `# Panics` sections where they \
apply."
        }
        DocStyle::Inline => {
            "Use the language's native single-line comment syntax (`//`, \
`#`, `--`, etc.) immediately above each non-obvious top-level item or \
block. One short comment per item — do not annotate every line."
        }
    };

    format!(
        "You are eri's voice-driven documentation generator. Return the code \
below verbatim except for the addition of {style_label}-style \
documentation comments.\n\
\n\
STYLE: {style_label}\n\
{style_rules}\n\
\n\
STRICT OUTPUT RULES:\n\
- Do NOT change executable code. Only ADD documentation comments.\n\
- Output EXACTLY one fenced code block containing the annotated code. \
Nothing before or after the block.\n\
- No prose recap, no headings.\n\
\n\
CODE:\n\
{code}\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generation_prompt_includes_file_path() {
        let path = Path::new("src/widgets/counter.tsx");
        let prompt = build_test_generation_prompt(
            path,
            "export function add(a: number, b: number) { return a + b }",
            None,
        );
        assert!(
            prompt.contains("src/widgets/counter.tsx"),
            "prompt should embed the source file path so Claude picks the right \
test filename: {prompt}"
        );
        assert!(
            prompt.contains("vitest"),
            "tsx files should default to vitest framework"
        );
        assert!(
            prompt.contains("counter.test.ts"),
            "should suggest <stem>.test.ts adjacent to source"
        );
    }

    #[test]
    fn test_generation_picks_pytest_for_python() {
        let path = Path::new("app/services/billing.py");
        let prompt = build_test_generation_prompt(path, "def total(x): return x", None);
        assert!(prompt.contains("pytest"));
        assert!(prompt.contains("```python"));
    }

    #[test]
    fn test_generation_picks_rust_test_attribute_for_rs() {
        let path = Path::new("crates/widget/src/widget.rs");
        let prompt =
            build_test_generation_prompt(path, "pub fn add(a: i32, b: i32) -> i32 { a + b }", None);
        assert!(prompt.contains("#[test]"));
        assert!(prompt.contains("```rust"));
    }

    #[test]
    fn test_generation_html_with_inline_script_detected_as_js() {
        let path = Path::new("public/index.html");
        let code = r#"<!doctype html><html><body><script>function add(a,b){return a+b}</script></body></html>"#;
        let prompt = build_test_generation_prompt(path, code, None);
        assert!(prompt.contains("vitest"));
        assert!(prompt.contains("index.test.js"));
    }

    #[test]
    fn test_generation_respects_explicit_framework_hint() {
        let path = Path::new("src/lib.js");
        let prompt = build_test_generation_prompt(path, "function f(){}", Some("jest"));
        assert!(prompt.contains("jest"));
    }

    #[test]
    fn code_explainer_prompt_specifies_plain_prose_no_markdown() {
        let prompt = build_code_explainer_prompt("function f(){}", None);
        let lowered = prompt.to_ascii_lowercase();
        assert!(
            lowered.contains("no markdown") || lowered.contains("no markdown headers"),
            "explainer must forbid markdown so TTS doesn't read symbols"
        );
        assert!(
            lowered.contains("plain prose"),
            "explainer must demand plain prose"
        );
        assert!(
            lowered.contains("spoken aloud") || lowered.contains("text-to-speech"),
            "explainer must say the output will be spoken — that's why the \
markdown ban exists"
        );
    }

    #[test]
    fn code_explainer_includes_focus_when_provided() {
        let prompt = build_code_explainer_prompt("for x in xs: pass", Some("the loop on line 23"));
        assert!(prompt.contains("the loop on line 23"));
    }

    #[test]
    fn code_explainer_omits_focus_clause_when_empty() {
        let prompt_blank = build_code_explainer_prompt("x = 1", Some("   "));
        let prompt_none = build_code_explainer_prompt("x = 1", None);
        // Both should produce the same prompt — a whitespace-only focus is
        // treated as "no focus".
        assert_eq!(prompt_blank, prompt_none);
    }

    #[test]
    fn refactor_prompt_preserves_behavior_directive() {
        let prompt = build_refactor_prompt("function f(){}", "use map instead of a for loop");
        let lowered = prompt.to_ascii_lowercase();
        assert!(
            lowered.contains("without changing")
                && (lowered.contains("behavior") || lowered.contains("behaviour")),
            "refactor prompt must instruct Claude not to change behavior"
        );
        assert!(
            prompt.contains("use map instead of a for loop"),
            "refactor prompt must embed the user's instruction"
        );
        assert!(
            lowered.contains("non-obvious"),
            "refactor prompt must require comments on non-obvious changes"
        );
    }

    #[test]
    fn doc_generator_prompt_picks_jsdoc_for_js_file() {
        // Voice path: panel resolves the doc style from the file path via
        // DocStyle::from_path, then passes it in.
        let style = DocStyle::from_path(Path::new("src/api/users.js"));
        assert_eq!(style, DocStyle::Jsdoc);
        let prompt = build_doc_generator_prompt("export function f(){}", style);
        assert!(prompt.contains("JSDoc"));
        assert!(prompt.contains("@param") || prompt.contains("@returns"));
    }

    #[test]
    fn doc_generator_style_from_path_dispatch() {
        assert_eq!(DocStyle::from_path(Path::new("a.ts")), DocStyle::Jsdoc);
        assert_eq!(DocStyle::from_path(Path::new("a.tsx")), DocStyle::Jsdoc);
        assert_eq!(DocStyle::from_path(Path::new("a.py")), DocStyle::Docstring);
        assert_eq!(DocStyle::from_path(Path::new("a.rs")), DocStyle::Rustdoc);
        assert_eq!(DocStyle::from_path(Path::new("a.go")), DocStyle::Inline);
        assert_eq!(DocStyle::from_path(Path::new("noext")), DocStyle::Inline);
    }

    #[test]
    fn doc_generator_rustdoc_prompt_mentions_triple_slash() {
        let prompt = build_doc_generator_prompt("pub fn add(){}", DocStyle::Rustdoc);
        assert!(prompt.contains("///"));
        assert!(prompt.contains("Rustdoc"));
    }

    #[test]
    fn doc_generator_docstring_prompt_mentions_pep257() {
        let prompt = build_doc_generator_prompt("def f(): pass", DocStyle::Docstring);
        assert!(prompt.contains("PEP 257") || prompt.contains("docstring"));
    }
}
