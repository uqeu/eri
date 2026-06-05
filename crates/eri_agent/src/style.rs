//! Output styles -- swap the agent's posture (builder / reviewer / explainer /
//! concise) while keeping the same tools + safety. The host prepends
//! [`SystemStyle::directive`] to its base persona for non-default styles.

/// Output style / system-prompt preset. Default is `Builder`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum SystemStyle {
    /// Construct complete, production-quality artifacts (default).
    #[default]
    Builder,
    /// Review existing code: find bugs/security/quality, propose minimal diffs.
    Reviewer,
    /// Teach: explain the code and the "why"; prefer reading over writing.
    Explainer,
    /// Minimal narration: do the work and report briefly.
    Concise,
}

impl SystemStyle {
    /// Parse a config/flag string. Unknown -> Builder (the safe default).
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "reviewer" | "review" => SystemStyle::Reviewer,
            "explainer" | "explain" | "teacher" => SystemStyle::Explainer,
            "concise" | "brief" => SystemStyle::Concise,
            _ => SystemStyle::Builder,
        }
    }

    /// The extra directive prepended for non-default styles (None for Builder,
    /// whose persona is already the base prompt). Vendor-neutral.
    pub fn directive(self) -> Option<&'static str> {
        match self {
            SystemStyle::Builder => None,
            SystemStyle::Reviewer => Some(
                "OUTPUT STYLE: REVIEWER. Prioritize reviewing the existing code over building \
new. Read and search first; find correctness bugs, security issues, and quality/maintainability \
problems; cite file:line. When you change code, prefer the smallest correct diff (str_replace / \
apply_patch) over wholesale rewrites, and explain why. Group findings by severity.",
            ),
            SystemStyle::Explainer => Some(
                "OUTPUT STYLE: EXPLAINER. Teach as you go. Explain what the code does and WHY, in \
clear plain language, before and after any change. Prefer reading/searching to writing; make only \
minimal, well-justified edits. Favor understanding over volume of output.",
            ),
            SystemStyle::Concise => Some(
                "OUTPUT STYLE: CONCISE. Minimize narration. Do the work with tools and report \
results briefly -- short, information-dense summaries, no preamble or restating the request.",
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_directives() {
        assert_eq!(SystemStyle::parse("reviewer"), SystemStyle::Reviewer);
        assert_eq!(SystemStyle::parse("REVIEW"), SystemStyle::Reviewer);
        assert_eq!(SystemStyle::parse("teacher"), SystemStyle::Explainer);
        assert_eq!(SystemStyle::parse("brief"), SystemStyle::Concise);
        assert_eq!(SystemStyle::parse("whatever"), SystemStyle::Builder);
        assert_eq!(SystemStyle::default(), SystemStyle::Builder);

        assert!(SystemStyle::Builder.directive().is_none());
        let mut seen = std::collections::HashSet::new();
        for s in [
            SystemStyle::Reviewer,
            SystemStyle::Explainer,
            SystemStyle::Concise,
        ] {
            let d = s.directive().expect("non-builder has a directive");
            assert!(!d.trim().is_empty());
            assert!(d.contains("OUTPUT STYLE"));
            assert!(seen.insert(d), "directives must be distinct");
            let low = d.to_lowercase();
            for banned in ["claude", "anthropic", "sonnet", "haiku", "mercury"] {
                assert!(
                    !low.contains(banned),
                    "directive leaked vendor name: {banned}"
                );
            }
        }
    }
}
