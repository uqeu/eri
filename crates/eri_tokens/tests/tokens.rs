use eri_tokens::{count_tokens, count_tokens_batch};

#[test]
fn gpt_4o_uses_o200k_base_and_is_exact() {
    let count = count_tokens("hello world", "gpt-4o").expect("count");
    assert_eq!(count.tokenizer, "o200k_base");
    assert!(!count.approximate);
    assert!(count.tokens > 0);
}

#[test]
fn mercury_2_uses_cl100k_base_and_is_marked_approximate() {
    let count = count_tokens("hello world", "mercury-2").expect("count");
    assert_eq!(count.tokenizer, "cl100k_base");
    assert!(count.approximate);
    assert!(count.tokens > 0);
}

#[test]
fn claude_uses_cl100k_base_and_is_marked_approximate() {
    let count = count_tokens("hello world", "claude-3.5-sonnet").expect("count");
    assert_eq!(count.tokenizer, "cl100k_base");
    assert!(count.approximate);
}

#[test]
fn unknown_model_falls_back_to_cl100k_and_is_approximate() {
    let count = count_tokens("hello world", "completely-made-up-model").expect("count");
    assert_eq!(count.tokenizer, "cl100k_base");
    assert!(count.approximate);
}

#[test]
fn batch_count_returns_one_count_per_input() {
    let inputs = ["alpha", "beta gamma", ""];
    let counts = count_tokens_batch(&inputs, "gpt-4o").expect("batch");
    assert_eq!(counts.len(), 3);
    assert_eq!(counts[2].tokens, 0);
    for c in &counts {
        assert_eq!(c.tokenizer, "o200k_base");
        assert!(!c.approximate);
    }
}

#[test]
fn empty_string_returns_zero_tokens() {
    let count = count_tokens("", "gpt-4o").expect("count");
    assert_eq!(count.tokens, 0);

    let count = count_tokens("", "claude-3.5-sonnet").expect("count");
    assert_eq!(count.tokens, 0);
}

#[test]
fn count_is_stable_across_invocations() {
    let text = "The quick brown fox jumps over the lazy dog.";
    let first = count_tokens(text, "gpt-4o").expect("first");
    let second = count_tokens(text, "gpt-4o").expect("second");
    let third = count_tokens(text, "gpt-4o").expect("third");
    assert_eq!(first.tokens, second.tokens);
    assert_eq!(second.tokens, third.tokens);
    assert!(first.tokens > 0);
}

#[test]
fn elevenlabs_models_return_char_count() {
    let text = "hello"; // 5 chars
    let count = count_tokens(text, "eleven_multilingual_v2").expect("count");
    assert_eq!(count.tokenizer, "char");
    assert!(count.approximate);
    assert_eq!(count.tokens, 5);
}
