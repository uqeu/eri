//! Pure unit tests for the FIM template + completion cleanup.
//! No network, no GPU, no model load.

use eri_tab::{build_fim_prompt, clean_completion};

#[test]
fn fim_template_selection_picks_qwen_deepseek_or_fallback() {
    let qwen = build_fim_prompt("qwen2.5-coder:1.5b", "let x = ", "\nreturn x;");
    assert!(qwen.contains("<|fim_prefix|>"));
    assert!(qwen.contains("<|fim_suffix|>"));
    assert!(qwen.contains("<|fim_middle|>"));
    assert!(qwen.contains("let x = "));
    assert!(qwen.contains("\nreturn x;"));

    let ds = build_fim_prompt("deepseek-coder:6.7b", "fn add(", ") -> i32 { }");
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

    let with_eot = "value<|endoftext|>garbage";
    assert_eq!(clean_completion(with_eot, &[]), "value");

    let with_empty = "abc\ndef";
    assert_eq!(
        clean_completion(with_empty, &["".to_string(), "\n".to_string()]),
        "abc"
    );
}
