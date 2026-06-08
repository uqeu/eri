//! Dictation post-processing — the local, deterministic layer that turns a raw
//! whisper transcript into clean text (Wispr-Flow-style), with a user
//! dictionary, voice snippets, cleanup, and a "fix that word" correction.
//!
//! All pure + offline + zero-token: this is the *deterministic* half. The
//! optional LLM "style transform" (rewrite into polished prose) is a separate
//! cloud step that runs on top of this — kept out of here so the local path
//! always works without a model.
//!
//! Config is a tiny line format (no serde dep), e.g. `~/.eri/dictation.txt`:
//! ```text
//! # dictionary   (fix terms whisper mishears)
//! cube khaos => Kubernetes
//! eri => eri
//! # snippets     (spoken trigger -> expansion)
//! my email :: khai@tryeri.ca
//! sign off :: Best, Khai
//! ```

/// Filler words removed as standalone tokens during cleanup.
const FILLERS: &[&str] = &["um", "uh", "erm", "umm", "uhh", "hmm"];

/// Replace every whole-word, case-insensitive occurrence of `from` with `to`.
/// "whole word" = not flanked by alphanumeric chars, so "cat" won't hit
/// "category". `from` may be multi-word (e.g. "cube khaos").
fn replace_word(text: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return text.to_string();
    }
    let hay = text.to_lowercase();
    let needle = from.to_lowercase();
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if hay[i..].starts_with(&needle) {
            let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
            let end = i + needle.len();
            let after_ok = end >= text.len() || !bytes[end].is_ascii_alphanumeric();
            if before_ok && after_ok {
                out.push_str(to);
                i = end;
                continue;
            }
        }
        // advance one char (respect UTF-8 boundaries)
        let ch_len = text[i..].chars().next().map(char::len_utf8).unwrap_or(1);
        out.push_str(&text[i..i + ch_len]);
        i += ch_len;
    }
    out
}

/// Collapse whitespace, drop filler words, and capitalize sentence starts.
pub fn clean_transcript(text: &str) -> String {
    // Tokenize on whitespace, drop standalone fillers, rejoin single-spaced.
    let kept: Vec<&str> = text
        .split_whitespace()
        .filter(|w| {
            let bare = w
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            !FILLERS.contains(&bare.as_str())
        })
        .collect();
    let joined = kept.join(" ");

    // Capitalize the first letter and the start of each new sentence. A
    // sentence boundary is `.`/`!`/`?` FOLLOWED BY whitespace (or end) — so we
    // don't capitalize inside emails/URLs/decimals like "tryeri.ca" or "3.14".
    let mut out = String::with_capacity(joined.len());
    let mut cap_next = true;
    let mut chars = joined.chars().peekable();
    while let Some(ch) = chars.next() {
        if cap_next && ch.is_alphabetic() {
            out.extend(ch.to_uppercase());
            cap_next = false;
        } else {
            out.push(ch);
            if matches!(ch, '.' | '!' | '?') && chars.peek().is_none_or(|n| n.is_whitespace()) {
                cap_next = true;
            }
        }
    }
    out
}

/// Replace the LAST whole-word occurrence of `wrong` with `right` — the
/// "eri, fix that word" correction (most recent mistake is what the user means).
pub fn fix_last(text: &str, wrong: &str, right: &str) -> String {
    if wrong.is_empty() {
        return text.to_string();
    }
    let hay = text.to_lowercase();
    let needle = wrong.to_lowercase();
    let bytes = text.as_bytes();
    let mut last: Option<usize> = None;
    let mut search = 0;
    while let Some(rel) = hay[search..].find(&needle) {
        let i = search + rel;
        let before_ok = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        let end = i + needle.len();
        let after_ok = end >= text.len() || !bytes[end].is_ascii_alphanumeric();
        if before_ok && after_ok {
            last = Some(i);
        }
        search = i + needle.len();
    }
    match last {
        Some(i) => format!("{}{}{}", &text[..i], right, &text[i + needle.len()..]),
        None => text.to_string(),
    }
}

/// User dictionary + snippets, parsed from the tiny line format.
#[derive(Debug, Default, Clone)]
pub struct DictationRules {
    /// (misheard term, correction) — applied longest-first so multi-word terms win.
    dictionary: Vec<(String, String)>,
    /// (spoken trigger, expansion).
    snippets: Vec<(String, String)>,
}

impl DictationRules {
    pub fn parse(config: &str) -> Self {
        let mut rules = DictationRules::default();
        for raw in config.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            if let Some((k, v)) = line.split_once("::") {
                rules
                    .snippets
                    .push((k.trim().to_string(), v.trim().to_string()));
            } else if let Some((k, v)) = line.split_once("=>") {
                rules
                    .dictionary
                    .push((k.trim().to_string(), v.trim().to_string()));
            }
        }
        // Apply longer keys first so "cube khaos" beats a hypothetical "cube".
        rules
            .dictionary
            .sort_by_key(|(k, _)| std::cmp::Reverse(k.len()));
        rules
            .snippets
            .sort_by_key(|(k, _)| std::cmp::Reverse(k.len()));
        rules
    }

    pub fn dictionary_len(&self) -> usize {
        self.dictionary.len()
    }
    pub fn snippets_len(&self) -> usize {
        self.snippets.len()
    }

    /// Full deterministic pipeline: expand snippets → apply dictionary → clean.
    pub fn process(&self, raw: &str) -> String {
        let mut t = raw.to_string();
        for (trigger, expansion) in &self.snippets {
            t = replace_word(&t, trigger, expansion);
        }
        for (term, fix) in &self.dictionary {
            t = replace_word(&t, term, fix);
        }
        clean_transcript(&t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_word_is_whole_word_and_case_insensitive() {
        assert_eq!(replace_word("the cat sat", "cat", "dog"), "the dog sat");
        assert_eq!(replace_word("category", "cat", "dog"), "category"); // no partial
        assert_eq!(replace_word("Cat CAT cat", "cat", "dog"), "dog dog dog");
        assert_eq!(
            replace_word("cube khaos rocks", "cube khaos", "Kubernetes"),
            "Kubernetes rocks"
        );
    }

    #[test]
    fn clean_drops_fillers_and_capitalizes() {
        assert_eq!(clean_transcript("um hello   world"), "Hello world");
        assert_eq!(clean_transcript("first. uh second"), "First. Second");
        assert_eq!(clean_transcript("  spaced   out  "), "Spaced out");
    }

    #[test]
    fn fix_last_replaces_most_recent() {
        assert_eq!(
            fix_last("set the var then set it", "set", "reset"),
            "set the var then reset it"
        );
        assert_eq!(fix_last("no match here", "xyz", "abc"), "no match here");
        assert_eq!(
            fix_last("kubernetes is kube", "kube", "Kubernetes"),
            "kubernetes is Kubernetes"
        );
    }

    #[test]
    fn rules_parse_and_process_end_to_end() {
        let cfg = "\
# dictionary
cube khaos => Kubernetes
react => React
# snippets
my email :: khai@tryeri.ca
";
        let rules = DictationRules::parse(cfg);
        assert_eq!(rules.dictionary_len(), 2);
        assert_eq!(rules.snippets_len(), 1);
        // snippet expands, dictionary fixes the term, cleanup capitalizes.
        let out = rules.process("um send my email about cube khaos and react");
        assert_eq!(out, "Send khai@tryeri.ca about Kubernetes and React");
    }

    #[test]
    fn parse_ignores_comments_and_blank_lines() {
        let rules = DictationRules::parse("\n  # just a comment\n\n");
        assert_eq!(rules.dictionary_len(), 0);
        assert_eq!(rules.snippets_len(), 0);
    }

    #[test]
    fn empty_inputs_are_safe() {
        assert_eq!(replace_word("abc", "", "x"), "abc");
        assert_eq!(fix_last("abc", "", "x"), "abc");
        assert_eq!(DictationRules::default().process(""), "");
    }
}
