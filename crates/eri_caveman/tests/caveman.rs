use eri_caveman::{CompressionLevel, Compressor};

#[test]
fn light_strips_fillers_only() {
    let c = Compressor::new(CompressionLevel::Light);
    let input = "This is really very important and actually pretty simple.";
    let out = c.compress(input);
    assert!(!out.to_lowercase().contains(" really "), "got: {out}");
    assert!(!out.to_lowercase().contains(" very "), "got: {out}");
    assert!(!out.to_lowercase().contains(" actually "), "got: {out}");
    // Light must NOT strip articles.
    assert!(out.to_lowercase().contains("this"), "got: {out}");
}

#[test]
fn medium_collapses_articles() {
    let c = Compressor::new(CompressionLevel::Medium);
    let input = "Build me a coffee shop with a hero and the products grid and a contact form.";
    let out = c.compress(input).to_lowercase();
    // No bare articles surrounded by spaces.
    for art in [" a ", " an ", " the "] {
        assert!(
            !out.contains(art),
            "expected article {art:?} stripped, got: {out}"
        );
    }
    // Core nouns survive.
    for keep in [
        "coffee", "shop", "hero", "products", "grid", "contact", "form",
    ] {
        assert!(out.contains(keep), "expected {keep:?} kept, got: {out}");
    }
}

#[test]
fn aggressive_drops_unambiguous_pronouns() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "It crashes when this happens because the cache is stale.";
    let out = c.compress(input).to_lowercase();
    assert!(!out.contains(" it "), "got: {out}");
    assert!(!out.contains(" this "), "got: {out}");
    // Leading "It" at sentence start: caveman drops it too.
    assert!(!out.starts_with("it "), "got: {out}");
    assert!(out.contains("crashes"), "got: {out}");
    assert!(out.contains("cache"), "got: {out}");
}

#[test]
fn aggressive_replaces_list_conjunctions_with_commas() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Build hero, products, and contact form.";
    let out = c.compress(input).to_lowercase();
    assert!(!out.contains(" and "), "got: {out}");
    assert!(out.contains("contact form"), "got: {out}");
}

#[test]
fn preserves_code_fences_byte_for_byte() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Here is a very important code block:\n\n```rust\nlet the_value = a + the + 1;\n// really keep this comment\n```\n\nAnd really that is the end.";
    let out = c.compress(input);
    let fence = "```rust\nlet the_value = a + the + 1;\n// really keep this comment\n```";
    assert!(out.contains(fence), "fence mutated. got:\n{out}");
}

#[test]
fn preserves_indented_code_fences() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Item:\n   ```\n   the a really raw text\n   ```\nAfter.";
    let out = c.compress(input);
    assert!(out.contains("   the a really raw text\n"), "got:\n{out}");
}

#[test]
fn preserves_inline_code_spans() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Use `get the a value` to fetch it really fast.";
    let out = c.compress(input);
    assert!(
        out.contains("`get the a value`"),
        "inline code mutated. got: {out}"
    );
}

#[test]
fn preserves_html_tags() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Render <a href=\"/the/path\" class=\"the-link really\">click</a> here please.";
    let out = c.compress(input);
    assert!(
        out.contains("<a href=\"/the/path\" class=\"the-link really\">"),
        "HTML tag mutated. got: {out}"
    );
    assert!(out.contains("</a>"), "got: {out}");
}

#[test]
fn preserves_template_placeholders() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Greet the user with {{ the.user.name }} and the {{ greeting }} message.";
    let out = c.compress(input);
    assert!(out.contains("{{ the.user.name }}"), "got: {out}");
    assert!(out.contains("{{ greeting }}"), "got: {out}");
}

#[test]
fn preserves_quoted_string_literals() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Set the title to \"The Real Deal\" and pass 'really do it' as a flag.";
    let out = c.compress(input);
    assert!(
        out.contains("\"The Real Deal\""),
        "double-quoted mutated. got: {out}"
    );
    assert!(
        out.contains("'really do it'"),
        "single-quoted mutated. got: {out}"
    );
}

#[test]
fn compress_then_decompress_is_lossy_but_semantically_close() {
    // Eyeball check from task spec: "build me a coffee shop with a hero,
    // a products grid, and a contact form" → "build coffee shop hero
    // products grid contact form" (roughly).
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Build me a coffee shop with a hero, a products grid, and a contact form.";
    let out = c.compress(input).to_lowercase();
    for keep in [
        "build", "coffee", "shop", "hero", "products", "grid", "contact", "form",
    ] {
        assert!(out.contains(keep), "missing {keep:?} in: {out}");
    }
    for drop in [" a ", " an ", " the ", " me "] {
        assert!(!out.contains(drop), "leaked {drop:?} in: {out}");
    }
    assert!(out.len() < input.len(), "compressed not shorter: {out}");
}

#[test]
fn estimate_savings_returns_positive_ratio_on_verbose_text() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let verbose = "I would really, really like you to actually go ahead and \
        very carefully build a coffee shop website with a hero section, \
        a products grid, and a contact form. Just make it really clean \
        and the styling should basically be very minimal.";
    let stats = c.estimate_savings(verbose);
    assert!(stats.ratio < 1.0, "no savings: {stats:?}");
    assert!(stats.ratio > 0.0, "ratio sanity: {stats:?}");
    assert!(
        stats.compressed_tokens_est < stats.original_tokens_est,
        "no token reduction: {stats:?}"
    );
    // Verbose text should compress noticeably.
    assert!(stats.ratio < 0.9, "compression too weak: {stats:?}");
}

#[test]
fn deterministic_same_input_same_output() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "Build the very nice and really clean coffee shop with the hero.";
    let a = c.compress(input);
    let b = c.compress(input);
    let d = c.compress(input);
    assert_eq!(a, b);
    assert_eq!(b, d);
}

#[test]
fn empty_input_round_trips() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    assert_eq!(c.compress(""), "");
    let stats = c.estimate_savings("");
    assert_eq!(stats.original_tokens_est, 0);
    assert_eq!(stats.compressed_tokens_est, 0);
}

#[test]
fn pure_code_input_is_passthrough() {
    let c = Compressor::new(CompressionLevel::Aggressive);
    let input = "```python\nfor the in really:\n    print('a')\n```\n";
    let out = c.compress(input);
    assert_eq!(out, input);
}
