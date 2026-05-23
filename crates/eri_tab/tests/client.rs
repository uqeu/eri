//! Integration tests for the `eri_tab` client.
//!
//! These tests exercise the pure (network-free) surface: FIM prompt
//! selection, stop-sequence cleanup, and health-tag parsing.

use eri_tab::{build_fim_prompt, clean_completion, parse_tags_response};

#[test]
fn fim_template_selection_picks_qwen_deepseek_or_fallback() {
    let qwen = build_fim_prompt("qwen2.5-coder:1.5b", "let x = ", "\nreturn x;");
    assert!(qwen.contains("<|fim_prefix|>"));
    assert!(qwen.contains("<|fim_suffix|>"));
    assert!(qwen.contains("<|fim_middle|>"));
    assert!(qwen.contains("let x = "));
    assert!(qwen.contains("\nreturn x;"));

    let ds = build_fim_prompt("deepseek-coder:6.7b", "fn add(", ") -> i32 { }");
    // DeepSeek tokens use full-width pipe (U+FF5C) + lower-one-eighth block (U+2581).
    assert!(ds.contains("\u{ff5c}fim\u{2581}begin\u{ff5c}"));
    assert!(ds.contains("\u{ff5c}fim\u{2581}hole\u{ff5c}"));
    assert!(ds.contains("\u{ff5c}fim\u{2581}end\u{ff5c}"));
    assert!(ds.contains("fn add("));

    let plain = build_fim_prompt("llama3", "console.log(", ");");
    assert_eq!(plain, "console.log(");
}

#[test]
fn stop_sequence_truncates_at_separator_and_strips_terminators() {
    let raw = "println!(\"hi\");\n\nfn other() {}";
    let cleaned = clean_completion(raw, &["\n\n".to_string()]);
    assert_eq!(cleaned, "println!(\"hi\");");

    // Terminator stripping is independent of the stop list.
    let with_eot = "value<|endoftext|>garbage";
    assert_eq!(clean_completion(with_eot, &[]), "value");

    // Empty stop entries are ignored.
    let with_empty = "abc\ndef";
    assert_eq!(
        clean_completion(with_empty, &["".to_string(), "\n".to_string()]),
        "abc"
    );
}

#[test]
fn health_tags_parses_installed_model_names() {
    let raw = r#"{
        "models": [
            {"name": "qwen2.5-coder:1.5b", "size": 0},
            {"name": "deepseek-coder:6.7b", "size": 0}
        ]
    }"#;
    let names = parse_tags_response(raw).expect("parses ok");
    assert_eq!(names, vec!["qwen2.5-coder:1.5b", "deepseek-coder:6.7b"]);

    // Empty / missing `models` should yield an empty vec rather than error.
    let empty = parse_tags_response("{}").expect("parses default");
    assert!(empty.is_empty());
}
