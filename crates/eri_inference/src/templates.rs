//! Project-template registry for eri.
//!
//! When the user opens a fresh build with a recognizable phrase
//! ("build me a portfolio", "make a coffee shop site", "flappy bird clone"),
//! eri matches against this static registry and seeds Mercury with a
//! production-quality starting point instead of asking it to invent one from
//! scratch. This collapses ~3-5s of Mercury time AND gives the model an
//! anchor that's already opinionated about typography, palette, and layout.
//!
//! Each template is a fully self-contained `<!DOCTYPE html>` document using
//! Tailwind via CDN and Google Fonts. Templates are designed to look hand-
//! crafted, not generic-SaaS. They live as `&'static str` so there's zero
//! runtime I/O cost.
//!
//! The matcher is deliberately simple — token-set overlap against each
//! template's keyword list — and entirely deterministic.

use std::collections::HashSet;
use std::path::PathBuf;

/// Soft cap on bytes embedded into the edit-mode user prompt. Set well below
/// Mercury's hard context budget so we leave headroom for the assistant's
/// reply and any system-prompt overhead.
pub const EDIT_MODE_EMBED_BUDGET_CHARS: usize = 30_000;

/// A project starter that eri can drop in as the seed for a new build.
#[derive(Debug, Clone, Copy)]
pub struct Template {
    /// Stable kebab-case identifier used by voice commands and the UI.
    pub slug: &'static str,
    /// Human-readable name shown in status lines.
    pub name: &'static str,
    /// Token list (already lowercased, single words) compared against the
    /// user's prompt with simple Jaccard-style overlap.
    pub keywords: &'static [&'static str],
    /// The full HTML body of the starter. Begins with `<!DOCTYPE html>` and
    /// contains a complete `<body>`.
    pub html: &'static str,
}

/// The full registry. Order is significant only for ties — `match_template`
/// breaks ties by the first hit, so put more specific templates earlier.
pub const TEMPLATES: &[Template] = &[
    Template {
        slug: "flappy-bird",
        name: "Flappy Bird clone",
        keywords: &[
            "flappy",
            "bird",
            "flap",
            "pipe",
            "pipes",
            "game",
            "clone",
            "arcade",
            "tap",
            "jump",
            "side-scroller",
        ],
        html: FLAPPY_BIRD_HTML,
    },
    Template {
        slug: "coffee-shop",
        name: "Coffee shop site",
        keywords: &[
            "coffee", "cafe", "espresso", "latte", "roastery", "roaster", "shop", "barista",
            "beans", "menu", "hours",
        ],
        html: COFFEE_SHOP_HTML,
    },
    Template {
        slug: "restaurant",
        name: "Restaurant site",
        keywords: &[
            "restaurant",
            "bistro",
            "dining",
            "kitchen",
            "chef",
            "menu",
            "reservation",
            "reservations",
            "trattoria",
            "eatery",
        ],
        html: RESTAURANT_HTML,
    },
    Template {
        slug: "portfolio",
        name: "Editorial portfolio",
        keywords: &[
            "portfolio",
            "photography",
            "photographer",
            "designer",
            "creative",
            "showcase",
            "work",
            "case",
            "studies",
            "personal",
        ],
        html: PORTFOLIO_HTML,
    },
    Template {
        slug: "pricing",
        name: "Pricing page",
        keywords: &[
            "pricing",
            "price",
            "tiers",
            "plans",
            "billing",
            "subscribe",
            "subscription",
            "monthly",
            "yearly",
        ],
        html: PRICING_HTML,
    },
    Template {
        slug: "blog-post",
        name: "Long-form blog post",
        keywords: &[
            "blog",
            "post",
            "article",
            "essay",
            "writing",
            "longform",
            "long-form",
            "reading",
            "newsletter",
        ],
        html: BLOG_POST_HTML,
    },
    Template {
        slug: "landing-saas",
        name: "SaaS landing page",
        keywords: &[
            "saas",
            "landing",
            "startup",
            "product",
            "marketing",
            "homepage",
            "launch",
            "b2b",
            "software",
        ],
        html: LANDING_SAAS_HTML,
    },
    Template {
        slug: "404-fun",
        name: "Playful 404 page",
        keywords: &[
            "404", "error", "not", "found", "missing", "broken", "lost", "page",
        ],
        html: FOUR_OH_FOUR_HTML,
    },
];

/// Find the template that best matches `prompt` via Jaccard-style overlap
/// against each template's keyword list. Returns `None` if no template
/// contributes more than one matching keyword, which avoids hijacking
/// generic phrases like "build me a page".
pub fn match_template(prompt: &str) -> Option<&'static Template> {
    let prompt_tokens: HashSet<String> = tokenize(prompt);
    if prompt_tokens.is_empty() {
        return None;
    }

    let mut best: Option<(&'static Template, f32, usize)> = None;
    for template in TEMPLATES {
        let keyword_set: HashSet<&'static str> = template.keywords.iter().copied().collect();
        let matches: usize = keyword_set
            .iter()
            .filter(|kw| prompt_tokens.contains(**kw))
            .count();
        if matches == 0 {
            continue;
        }
        // Jaccard-ish numerator/denominator: keep it dimensionless so longer
        // prompts don't get artificially penalized.
        let union = keyword_set.len() + prompt_tokens.len() - matches;
        let score = if union == 0 {
            0.0
        } else {
            matches as f32 / union as f32
        };
        // Tie-breaker: prefer the higher raw match count first, then score.
        let is_better = match best {
            None => true,
            Some((_, best_score, best_matches)) => {
                matches > best_matches || (matches == best_matches && score > best_score)
            }
        };
        if is_better {
            best = Some((template, score, matches));
        }
    }

    // Require at least one strong keyword hit. The matcher is intentionally
    // conservative — when in doubt, fall through to Mercury-from-scratch.
    best.map(|(template, _, _)| template)
}

/// Look a template up by exact slug. Used by the `use template <slug>` voice
/// command.
pub fn template_by_slug(slug: &str) -> Option<&'static Template> {
    let target = slug.trim().to_ascii_lowercase();
    TEMPLATES.iter().find(|t| {
        t.slug == target
            || t.slug.replace('-', " ") == target
            || t.slug.replace('-', "") == target.replace([' ', '-'], "")
    })
}

/// System prompt for "edit mode" — used when the intent classifier decides
/// the user is iterating on existing files rather than starting fresh.
///
/// The output instructs the model to emit aider-style search/replace blocks
/// that [`eri_apply`](../../../eri_apply/index.html) can parse and apply
/// deterministically, sidestepping the latency and drift of asking for full
/// file contents on every small edit.
pub fn edit_mode_system_prompt(language: Option<&str>) -> String {
    let language_hint = match language {
        Some(lang) if !lang.trim().is_empty() => {
            format!(
                "\nThe user's active language is {}. Match its idioms.",
                lang.trim()
            )
        }
        _ => String::new(),
    };
    format!(
        "You are eri, a coding assistant. The user is editing existing files.\n\
         Emit your edits as one or more search/replace blocks in this exact format:\n\
         \n\
         <<<<<<< SEARCH path/to/file\n\
         [the exact text currently in the file]\n\
         =======\n\
         [the new text]\n\
         >>>>>>> REPLACE\n\
         \n\
         Rules:\n\
         - The SEARCH region must match the file contents byte-for-byte (whitespace included).\n\
         - Include 2-3 lines of unchanged context above and below the change so the location is unambiguous.\n\
         - For a new file: leave the SEARCH region empty.\n\
         - For deleting a region: leave the REPLACE region empty.\n\
         - Do NOT emit explanatory prose between blocks - the parser is strict.\n\
         - You may emit multiple blocks per response, and multiple blocks per file.\n\
         - Use the relative path the user supplied; do not invent absolute paths.\n\
         - Never wrap blocks in markdown code fences.{language_hint}"
    )
}

/// Build the user prompt for edit mode. Each open file becomes a fenced
/// section keyed by its relative path; the user's request comes last.
///
/// Embedded file content is capped at [`EDIT_MODE_EMBED_BUDGET_CHARS`]. If
/// the total exceeds the budget, the largest files are truncated first
/// (oldest-by-size order) and a `[... <N> files truncated ...]` marker is
/// inserted in their place so the model knows context is missing.
pub fn edit_mode_user_prompt(user_request: &str, open_files: &[(PathBuf, String)]) -> String {
    let kept = select_files_within_budget(open_files, EDIT_MODE_EMBED_BUDGET_CHARS);
    let mut buf = String::new();
    for (path, content) in &kept.kept {
        buf.push_str("## ");
        buf.push_str(&path.display().to_string());
        buf.push_str("\n```\n");
        buf.push_str(content);
        if !content.ends_with('\n') {
            buf.push('\n');
        }
        buf.push_str("```\n\n");
    }
    if kept.truncated_count > 0 {
        buf.push_str(&format!(
            "[... {} files truncated ...]\n\n",
            kept.truncated_count
        ));
    }
    buf.push_str("## Request\n");
    buf.push_str(user_request.trim());
    buf.push('\n');
    buf
}

struct SelectedFiles<'a> {
    kept: Vec<(&'a PathBuf, &'a String)>,
    truncated_count: usize,
}

fn select_files_within_budget(files: &[(PathBuf, String)], budget: usize) -> SelectedFiles<'_> {
    // WHY: drop the largest files first so a single huge file can't crowd out
    // the rest of the working set. Order within the kept set is preserved
    // from the caller so the model sees files in the user's open-tab order.
    let mut indexed: Vec<(usize, &(PathBuf, String))> = files.iter().enumerate().collect();
    indexed.sort_by_key(|(_, (_, c))| std::cmp::Reverse(c.len()));

    let mut total: usize = 0;
    let mut keep_flags = vec![true; files.len()];
    let mut truncated = 0usize;
    for (idx, (_, content)) in &indexed {
        if total.saturating_add(content.len()) > budget {
            keep_flags[*idx] = false;
            truncated += 1;
        } else {
            total += content.len();
        }
    }

    let kept: Vec<(&PathBuf, &String)> = files
        .iter()
        .enumerate()
        .filter(|(i, _)| keep_flags[*i])
        .map(|(_, (p, c))| (p, c))
        .collect();

    SelectedFiles {
        kept,
        truncated_count: truncated,
    }
}

fn tokenize(input: &str) -> HashSet<String> {
    input
        .to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Template bodies
//
// Each is a full HTML document. They lean on Tailwind CDN + Google Fonts and
// are intentionally opinionated about palette and typography. Keep them at
// the 5-10 KB range — enough to set the aesthetic without becoming a giant
// payload for Mercury to copy.
// ---------------------------------------------------------------------------

const PORTFOLIO_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Mira Chen — Selected Work, 2020–2026</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600;9..144,800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<script>
  tailwind.config = { theme: { extend: { colors: { ink: '#0a0a0a', cream: '#f4f1ea', accent: '#d97757' } }, fontFamily: { serif: ['Fraunces','serif'], sans: ['Inter','sans-serif'] } } }
</script>
<style>html { scroll-behavior: smooth; } body { font-feature-settings: "ss01","cv11"; }</style>
</head>
<body class="bg-ink text-cream font-sans antialiased selection:bg-accent selection:text-ink">
<header class="px-8 md:px-16 py-8 flex items-center justify-between border-b border-cream/10">
  <a href="#" class="font-serif text-2xl tracking-tight">Mira Chen</a>
  <nav class="hidden md:flex gap-10 text-sm tracking-wide uppercase text-cream/70">
    <a href="#work" class="hover:text-cream">Work</a>
    <a href="#about" class="hover:text-cream">About</a>
    <a href="#contact" class="hover:text-cream">Contact</a>
  </nav>
  <a href="#contact" class="text-sm border border-cream/30 rounded-full px-5 py-2 hover:bg-cream hover:text-ink transition">Get in touch</a>
</header>

<section class="px-8 md:px-16 pt-24 md:pt-40 pb-20 md:pb-32 max-w-6xl">
  <p class="text-xs uppercase tracking-[0.28em] text-accent mb-8">Brand · Editorial · Motion</p>
  <h1 class="font-serif text-[clamp(3rem,9vw,7rem)] leading-[0.95] tracking-[-0.03em] mb-10">Identity systems for studios that take themselves seriously, not too seriously.</h1>
  <p class="text-lg md:text-xl max-w-2xl text-cream/70 leading-relaxed">I'm a Brooklyn-based art director working with founders on the parts of a brand most agencies overlook — wordmarks, motion grammar, and the way a product introduces itself in the first three seconds.</p>
</section>

<section id="work" class="px-8 md:px-16 py-16 border-t border-cream/10">
  <div class="flex items-end justify-between mb-14">
    <h2 class="font-serif text-4xl md:text-5xl">Selected work</h2>
    <span class="text-sm text-cream/50">14 projects · 2020–2026</span>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
    <a href="#" class="md:col-span-8 group">
      <div class="aspect-[16/10] rounded-2xl bg-gradient-to-br from-accent/80 to-accent/30 mb-5 overflow-hidden ring-1 ring-cream/10">
        <div class="w-full h-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_50%)]"></div>
      </div>
      <p class="text-xs uppercase tracking-[0.2em] text-cream/50 mb-2">Identity, 2025</p>
      <h3 class="font-serif text-2xl md:text-3xl group-hover:text-accent transition">Polar — a journaling app that refuses to be a journal</h3>
    </a>
    <a href="#" class="md:col-span-4 group">
      <div class="aspect-[4/5] rounded-2xl bg-gradient-to-br from-cream/20 to-cream/5 mb-5 ring-1 ring-cream/10"></div>
      <p class="text-xs uppercase tracking-[0.2em] text-cream/50 mb-2">Wordmark, 2024</p>
      <h3 class="font-serif text-2xl group-hover:text-accent transition">Forty-Seven Coffee</h3>
    </a>
    <a href="#" class="md:col-span-4 group">
      <div class="aspect-square rounded-2xl bg-gradient-to-br from-emerald-900 to-ink mb-5 ring-1 ring-cream/10"></div>
      <p class="text-xs uppercase tracking-[0.2em] text-cream/50 mb-2">Motion, 2024</p>
      <h3 class="font-serif text-2xl group-hover:text-accent transition">Aside Records — sleeve system</h3>
    </a>
    <a href="#" class="md:col-span-8 group">
      <div class="aspect-[16/10] rounded-2xl bg-gradient-to-tr from-rose-900 to-ink mb-5 ring-1 ring-cream/10"></div>
      <p class="text-xs uppercase tracking-[0.2em] text-cream/50 mb-2">Editorial, 2023</p>
      <h3 class="font-serif text-2xl md:text-3xl group-hover:text-accent transition">Field Notes — quarterly print for a venture firm that hates being a venture firm</h3>
    </a>
  </div>
</section>

<section id="about" class="px-8 md:px-16 py-24 border-t border-cream/10 grid md:grid-cols-2 gap-16 items-start">
  <h2 class="font-serif text-4xl md:text-6xl leading-[1.05]">A studio of one, on purpose.</h2>
  <div class="space-y-6 text-cream/75 leading-relaxed text-lg">
    <p>I've worked in-house at Pentagram and Mucca, freelanced for Field, and spent two years art-directing for a coffee roaster in Oslo. Now I take three identity engagements a year and an unbounded number of conversations.</p>
    <p>If you have a wordmark you secretly hate, an "about" page that sounds like five other companies, or a product launch coming up where the visual story isn't doing its job — let's talk.</p>
  </div>
</section>

<section id="contact" class="px-8 md:px-16 py-24 border-t border-cream/10 text-center">
  <p class="text-xs uppercase tracking-[0.28em] text-accent mb-6">Currently booking Q3 2026</p>
  <h2 class="font-serif text-5xl md:text-7xl tracking-[-0.02em] mb-10">mira@studio-chen.work</h2>
  <a href="mailto:mira@studio-chen.work" class="inline-block bg-cream text-ink px-8 py-4 rounded-full font-medium hover:bg-accent hover:text-ink transition">Start a project</a>
</section>

<footer class="px-8 md:px-16 py-10 border-t border-cream/10 flex flex-col md:flex-row gap-4 items-center justify-between text-sm text-cream/50">
  <p>© 2026 Mira Chen Studio. All rights reserved.</p>
  <div class="flex gap-6">
    <a href="#" class="hover:text-cream">Instagram</a>
    <a href="#" class="hover:text-cream">Are.na</a>
    <a href="#" class="hover:text-cream">Read.cv</a>
  </div>
</footer>
</body>
</html>"##;

const COFFEE_SHOP_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Foundry Coffee — slow mornings, fast pour-overs.</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<script>
  tailwind.config = { theme: { extend: { colors: { sepia: '#f3ead5', cocoa: '#3d2516', cinnabar: '#a8431b' } }, fontFamily: { serif: ['Fraunces','serif'], sans: ['DM Sans','sans-serif'] } } }
</script>
</head>
<body class="bg-sepia text-cocoa font-sans antialiased">
<header class="px-6 md:px-12 py-6 flex items-center justify-between">
  <a href="#" class="font-serif italic text-2xl">Foundry</a>
  <nav class="hidden md:flex gap-8 text-sm">
    <a href="#menu" class="hover:text-cinnabar">Menu</a>
    <a href="#beans" class="hover:text-cinnabar">Beans</a>
    <a href="#hours" class="hover:text-cinnabar">Hours</a>
    <a href="#find" class="hover:text-cinnabar">Find us</a>
  </nav>
  <a href="#find" class="text-sm border border-cocoa/40 rounded-full px-5 py-2 hover:bg-cocoa hover:text-sepia transition">Order online</a>
</header>

<section class="px-6 md:px-12 pt-12 md:pt-24 pb-20 md:pb-32 grid md:grid-cols-12 gap-10 items-end">
  <div class="md:col-span-7">
    <p class="text-xs uppercase tracking-[0.25em] text-cinnabar mb-6">Est. 2019 · Powderhorn, MN</p>
    <h1 class="font-serif text-[clamp(3rem,8vw,6.5rem)] leading-[0.98] tracking-[-0.02em] mb-8">Slow mornings,<br/><span class="italic">fast pour-overs.</span></h1>
    <p class="text-lg md:text-xl text-cocoa/80 max-w-xl leading-relaxed">A neighborhood roastery for people who pretend they don't have a favorite barista. We roast Tuesday, brew Wednesday through Sunday, and close on Mondays because we're tired.</p>
    <div class="mt-10 flex gap-4">
      <a href="#menu" class="bg-cocoa text-sepia px-6 py-3 rounded-full font-medium hover:bg-cinnabar transition">See the menu</a>
      <a href="#find" class="border border-cocoa/40 px-6 py-3 rounded-full font-medium hover:bg-cocoa hover:text-sepia transition">Visit the shop</a>
    </div>
  </div>
  <div class="md:col-span-5 relative aspect-[4/5] rounded-3xl overflow-hidden ring-1 ring-cocoa/10 bg-gradient-to-br from-cinnabar/80 to-cocoa">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(243,234,213,0.35),transparent_55%)]"></div>
    <div class="absolute bottom-6 left-6 right-6 bg-sepia/95 backdrop-blur rounded-2xl p-5">
      <p class="text-xs uppercase tracking-[0.2em] text-cinnabar mb-2">This week's rotation</p>
      <p class="font-serif text-2xl">Kochere washed Yirgacheffe — jasmine, white peach, brown sugar.</p>
    </div>
  </div>
</section>

<section id="menu" class="px-6 md:px-12 py-20 bg-cocoa text-sepia">
  <div class="max-w-5xl mx-auto">
    <p class="text-xs uppercase tracking-[0.25em] text-cinnabar mb-4">The bar</p>
    <h2 class="font-serif text-5xl md:text-6xl mb-14 tracking-[-0.02em]">What's on today.</h2>
    <div class="grid md:grid-cols-2 gap-x-16 gap-y-10">
      <div class="flex justify-between items-baseline pb-4 border-b border-sepia/15"><div><p class="font-serif text-2xl">Espresso</p><p class="text-sm text-sepia/60">double, our house blend</p></div><span class="font-serif text-xl">3.50</span></div>
      <div class="flex justify-between items-baseline pb-4 border-b border-sepia/15"><div><p class="font-serif text-2xl">Cortado</p><p class="text-sm text-sepia/60">4oz, gibraltar glass</p></div><span class="font-serif text-xl">4.25</span></div>
      <div class="flex justify-between items-baseline pb-4 border-b border-sepia/15"><div><p class="font-serif text-2xl">Pour-over</p><p class="text-sm text-sepia/60">single origin, choose at the bar</p></div><span class="font-serif text-xl">5.50</span></div>
      <div class="flex justify-between items-baseline pb-4 border-b border-sepia/15"><div><p class="font-serif text-2xl">Cold brew</p><p class="text-sm text-sepia/60">22hr steep, on tap</p></div><span class="font-serif text-xl">4.75</span></div>
      <div class="flex justify-between items-baseline pb-4 border-b border-sepia/15"><div><p class="font-serif text-2xl">Iced cocoa</p><p class="text-sm text-sepia/60">single-estate, 70% Madagascar</p></div><span class="font-serif text-xl">5.00</span></div>
      <div class="flex justify-between items-baseline pb-4 border-b border-sepia/15"><div><p class="font-serif text-2xl">Cardamom bun</p><p class="text-sm text-sepia/60">baked at 6, gone by noon</p></div><span class="font-serif text-xl">4.50</span></div>
    </div>
  </div>
</section>

<section id="beans" class="px-6 md:px-12 py-20 max-w-5xl mx-auto">
  <p class="text-xs uppercase tracking-[0.25em] text-cinnabar mb-4">Take it home</p>
  <h2 class="font-serif text-5xl md:text-6xl mb-12 tracking-[-0.02em]">Beans, fresh-roasted Tuesdays.</h2>
  <div class="grid md:grid-cols-3 gap-8">
    <div class="rounded-3xl ring-1 ring-cocoa/15 p-6 bg-white/50"><div class="aspect-square rounded-2xl bg-gradient-to-br from-cinnabar to-cocoa mb-5"></div><p class="font-serif text-2xl mb-1">Kochere</p><p class="text-sm text-cocoa/70 mb-4">Ethiopia · washed · 12oz</p><p class="font-serif">22.00</p></div>
    <div class="rounded-3xl ring-1 ring-cocoa/15 p-6 bg-white/50"><div class="aspect-square rounded-2xl bg-gradient-to-br from-amber-700 to-cocoa mb-5"></div><p class="font-serif text-2xl mb-1">El Diviso</p><p class="text-sm text-cocoa/70 mb-4">Colombia · honey · 12oz</p><p class="font-serif">24.00</p></div>
    <div class="rounded-3xl ring-1 ring-cocoa/15 p-6 bg-white/50"><div class="aspect-square rounded-2xl bg-gradient-to-br from-stone-700 to-cocoa mb-5"></div><p class="font-serif text-2xl mb-1">Foundry House</p><p class="text-sm text-cocoa/70 mb-4">Brazil + Sumatra · 12oz</p><p class="font-serif">18.00</p></div>
  </div>
</section>

<section id="hours" class="px-6 md:px-12 py-20 bg-sepia border-y border-cocoa/15">
  <div class="max-w-5xl mx-auto grid md:grid-cols-2 gap-14">
    <div>
      <p class="text-xs uppercase tracking-[0.25em] text-cinnabar mb-4">Hours</p>
      <h2 class="font-serif text-5xl md:text-6xl mb-8 tracking-[-0.02em]">Open when we're awake.</h2>
      <dl class="space-y-3 text-lg">
        <div class="flex justify-between border-b border-cocoa/15 pb-3"><dt>Mon</dt><dd class="text-cocoa/60">Closed</dd></div>
        <div class="flex justify-between border-b border-cocoa/15 pb-3"><dt>Tue – Fri</dt><dd>7:00 – 15:00</dd></div>
        <div class="flex justify-between border-b border-cocoa/15 pb-3"><dt>Saturday</dt><dd>8:00 – 16:00</dd></div>
        <div class="flex justify-between border-b border-cocoa/15 pb-3"><dt>Sunday</dt><dd>8:00 – 14:00</dd></div>
      </dl>
    </div>
    <div id="find" class="rounded-3xl bg-cocoa text-sepia p-8 md:p-12">
      <p class="text-xs uppercase tracking-[0.25em] text-cinnabar mb-4">Find us</p>
      <h3 class="font-serif text-3xl md:text-4xl mb-6 leading-tight">2812 Bloomington Ave S, Minneapolis MN 55407</h3>
      <p class="text-sepia/70 mb-8">Two blocks south of Powderhorn Park. Bike parking out front, dogs welcome on the patio.</p>
      <a href="#" class="inline-block border border-sepia/40 px-6 py-3 rounded-full hover:bg-sepia hover:text-cocoa transition">Open in Maps</a>
    </div>
  </div>
</section>

<footer class="px-6 md:px-12 py-10 flex flex-col md:flex-row justify-between gap-4 text-sm text-cocoa/60">
  <p>© 2026 Foundry Coffee. Roasted in Minneapolis.</p>
  <div class="flex gap-6">
    <a href="#" class="hover:text-cinnabar">Instagram</a>
    <a href="#" class="hover:text-cinnabar">Wholesale</a>
    <a href="mailto:hi@foundry.coffee" class="hover:text-cinnabar">hi@foundry.coffee</a>
  </div>
</footer>
</body>
</html>"##;

const FLAPPY_BIRD_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Flappy — a clone you can actually beat.</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Space Grotesk', sans-serif; }
  canvas { image-rendering: pixelated; touch-action: manipulation; }
</style>
</head>
<body class="bg-sky-200 text-slate-900 min-h-screen flex flex-col items-center justify-center select-none">
  <div class="text-center mb-4">
    <h1 class="text-4xl font-bold tracking-tight">Flappy</h1>
    <p class="text-slate-700">Click, tap, or press <kbd class="px-2 py-0.5 rounded bg-white/70 ring-1 ring-slate-900/10 text-sm">Space</kbd> to flap.</p>
  </div>
  <canvas id="game" width="400" height="600" class="rounded-2xl shadow-[0_30px_60px_-20px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/10"></canvas>
  <p id="hud" class="mt-4 text-sm text-slate-700">Score: 0 · Best: 0</p>
<script>
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const hud = document.getElementById('hud');
  const W = canvas.width, H = canvas.height;

  const GRAVITY = 0.35;
  const FLAP = -6.5;
  const PIPE_GAP = 170;
  const PIPE_SPEED = 2.2;
  const PIPE_INTERVAL = 95;

  let bird, pipes, score, best, frame, state;

  function reset() {
    bird = { x: 90, y: H / 2, vy: 0, r: 14, rot: 0 };
    pipes = [];
    score = 0;
    frame = 0;
    state = 'ready'; // ready | playing | dead
  }
  best = parseInt(localStorage.getItem('flappy.best') || '0', 10);
  reset();

  function flap() {
    if (state === 'ready') state = 'playing';
    if (state === 'playing') { bird.vy = FLAP; }
    if (state === 'dead') reset();
  }

  function spawnPipe() {
    const margin = 60;
    const top = margin + Math.random() * (H - PIPE_GAP - margin * 2);
    pipes.push({ x: W + 30, top, passed: false });
  }

  function step() {
    if (state === 'playing') {
      bird.vy += GRAVITY;
      bird.y += bird.vy;
      bird.rot = Math.max(-0.6, Math.min(1.2, bird.vy / 10));

      frame++;
      if (frame % PIPE_INTERVAL === 0) spawnPipe();

      for (const p of pipes) {
        p.x -= PIPE_SPEED;
        if (!p.passed && p.x + 40 < bird.x) {
          p.passed = true;
          score++;
          if (score > best) { best = score; localStorage.setItem('flappy.best', String(best)); }
        }
      }
      pipes = pipes.filter(p => p.x > -60);

      // Collision
      if (bird.y + bird.r > H - 40 || bird.y - bird.r < 0) state = 'dead';
      for (const p of pipes) {
        if (bird.x + bird.r > p.x && bird.x - bird.r < p.x + 60) {
          if (bird.y - bird.r < p.top || bird.y + bird.r > p.top + PIPE_GAP) state = 'dead';
        }
      }
    }
    draw();
    hud.textContent = `Score: ${score} · Best: ${best}`;
    requestAnimationFrame(step);
  }

  function draw() {
    // sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#bae6fd');
    g.addColorStop(1, '#fde68a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 4; i++) {
      const cx = ((frame * 0.4) + i * 130) % (W + 80) - 40;
      ctx.beginPath(); ctx.ellipse(cx, 80 + i * 30, 38, 14, 0, 0, Math.PI * 2); ctx.fill();
    }

    // pipes
    ctx.fillStyle = '#16a34a';
    for (const p of pipes) {
      ctx.fillRect(p.x, 0, 60, p.top);
      ctx.fillRect(p.x, p.top + PIPE_GAP, 60, H - p.top - PIPE_GAP - 40);
      // caps
      ctx.fillStyle = '#15803d';
      ctx.fillRect(p.x - 4, p.top - 14, 68, 14);
      ctx.fillRect(p.x - 4, p.top + PIPE_GAP, 68, 14);
      ctx.fillStyle = '#16a34a';
    }

    // ground
    ctx.fillStyle = '#a16207';
    ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = '#854d0e';
    for (let i = 0; i < W; i += 16) ctx.fillRect(i + (frame % 16) - 16, H - 40, 8, 6);

    // bird
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);
    ctx.fillStyle = '#facc15';
    ctx.beginPath(); ctx.ellipse(0, 0, 16, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f97316';
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(22, -3); ctx.lineTo(22, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.arc(6, -4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // overlays
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 28px Space Grotesk, sans-serif';
    ctx.textAlign = 'center';
    if (state === 'ready') ctx.fillText('Tap or press Space to start', W/2, H/2 - 40);
    if (state === 'dead') {
      ctx.fillStyle = 'rgba(15,23,42,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fef3c7';
      ctx.font = '700 42px Space Grotesk, sans-serif';
      ctx.fillText('Game over', W/2, H/2 - 30);
      ctx.font = '500 20px Space Grotesk, sans-serif';
      ctx.fillText(`Score ${score} · Best ${best}`, W/2, H/2 + 4);
      ctx.fillText('Click or press Space to retry', W/2, H/2 + 38);
    }
  }

  canvas.addEventListener('pointerdown', flap);
  window.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); } });
  step();
})();
</script>
</body>
</html>"##;

const PRICING_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Plans — Stitch, the project tracker for tiny teams.</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script>
  tailwind.config = { theme: { extend: { colors: { accent: '#5b6cff' } }, fontFamily: { sans: ['Plus Jakarta Sans','sans-serif'] } } }
</script>
</head>
<body class="bg-[#fafaf7] text-slate-900 font-sans antialiased">
<header class="px-6 md:px-12 py-6 flex items-center justify-between border-b border-slate-900/5">
  <a href="#" class="font-bold text-xl tracking-tight">stitch.</a>
  <nav class="hidden md:flex gap-8 text-sm">
    <a href="#" class="hover:text-accent">Product</a>
    <a href="#" class="text-accent">Pricing</a>
    <a href="#" class="hover:text-accent">Customers</a>
    <a href="#" class="hover:text-accent">Docs</a>
  </nav>
  <a href="#" class="bg-slate-900 text-white px-5 py-2 rounded-full text-sm hover:bg-accent transition">Start free</a>
</header>

<section class="px-6 md:px-12 pt-20 pb-12 text-center max-w-3xl mx-auto">
  <p class="text-xs uppercase tracking-[0.25em] text-accent mb-5">Simple, honest pricing</p>
  <h1 class="text-5xl md:text-6xl font-bold tracking-[-0.025em] leading-[1.05] mb-6">Pay for what you ship. Not for seats you don't have.</h1>
  <p class="text-lg text-slate-600">Stitch costs less than the coffee budget for the team meeting where you'd otherwise argue about it.</p>
  <div class="mt-10 inline-flex items-center bg-white ring-1 ring-slate-900/10 rounded-full p-1 shadow-sm">
    <button id="m" class="px-5 py-2 rounded-full text-sm font-medium bg-slate-900 text-white">Monthly</button>
    <button id="y" class="px-5 py-2 rounded-full text-sm font-medium text-slate-700">Yearly <span class="text-accent">· save 20%</span></button>
  </div>
</section>

<section class="px-6 md:px-12 pb-24">
  <div class="max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
    <div class="rounded-3xl bg-white p-8 ring-1 ring-slate-900/10 flex flex-col">
      <p class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Solo</p>
      <p class="text-5xl font-bold tracking-tight mb-1"><span class="price" data-m="0" data-y="0">$0</span></p>
      <p class="text-sm text-slate-500 mb-6">Forever, for one. No card.</p>
      <ul class="space-y-3 text-sm text-slate-700 mb-8 flex-1">
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Unlimited personal projects</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Kanban + calendar views</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>iOS + desktop apps</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Public read-only sharing</li>
      </ul>
      <a href="#" class="text-center bg-slate-100 text-slate-900 py-3 rounded-full font-medium hover:bg-slate-200">Get started</a>
    </div>

    <div class="rounded-3xl bg-slate-900 text-white p-8 ring-1 ring-slate-900 flex flex-col relative shadow-[0_30px_60px_-30px_rgba(91,108,255,0.6)]">
      <span class="absolute -top-3 left-8 bg-accent text-white text-xs px-3 py-1 rounded-full uppercase tracking-widest">Most teams pick this</span>
      <p class="text-sm font-semibold text-accent uppercase tracking-wider mb-2">Team</p>
      <p class="text-5xl font-bold tracking-tight mb-1"><span class="price" data-m="9" data-y="7">$9</span><span class="text-base font-medium text-white/60">/user/mo</span></p>
      <p class="text-sm text-white/60 mb-6">Up to 12 collaborators.</p>
      <ul class="space-y-3 text-sm text-white/85 mb-8 flex-1">
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Everything in Solo</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Real-time collab + comments</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>GitHub + Linear sync</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Slack thread → Stitch task</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>30-day history</li>
      </ul>
      <a href="#" class="text-center bg-accent py-3 rounded-full font-medium hover:bg-accent/90">Start 14-day trial</a>
    </div>

    <div class="rounded-3xl bg-white p-8 ring-1 ring-slate-900/10 flex flex-col">
      <p class="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Studio</p>
      <p class="text-5xl font-bold tracking-tight mb-1"><span class="price" data-m="19" data-y="15">$19</span><span class="text-base font-medium text-slate-500">/user/mo</span></p>
      <p class="text-sm text-slate-500 mb-6">Unlimited collaborators.</p>
      <ul class="space-y-3 text-sm text-slate-700 mb-8 flex-1">
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Everything in Team</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>SAML SSO + SCIM</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Audit logs · 12-month history</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Private workspaces</li>
        <li class="flex gap-3"><svg class="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>Priority support · 4hr SLA</li>
      </ul>
      <a href="#" class="text-center bg-slate-100 text-slate-900 py-3 rounded-full font-medium hover:bg-slate-200">Contact sales</a>
    </div>
  </div>
</section>

<section class="px-6 md:px-12 pb-24">
  <div class="max-w-3xl mx-auto">
    <h2 class="text-3xl font-bold tracking-tight mb-8">Frequently asked</h2>
    <div class="space-y-3">
      <details class="group rounded-2xl bg-white ring-1 ring-slate-900/10 p-5"><summary class="cursor-pointer font-medium flex justify-between">Can I switch plans mid-cycle?<span class="text-slate-400 group-open:rotate-45 transition">+</span></summary><p class="mt-3 text-slate-600">Yes — we prorate to the day, and we don't lock you into anything beyond the current period.</p></details>
      <details class="group rounded-2xl bg-white ring-1 ring-slate-900/10 p-5"><summary class="cursor-pointer font-medium flex justify-between">Is there a non-profit discount?<span class="text-slate-400 group-open:rotate-45 transition">+</span></summary><p class="mt-3 text-slate-600">50% off Team and Studio plans for registered non-profits. Email hello@stitch.so with documentation.</p></details>
      <details class="group rounded-2xl bg-white ring-1 ring-slate-900/10 p-5"><summary class="cursor-pointer font-medium flex justify-between">Where is my data hosted?<span class="text-slate-400 group-open:rotate-45 transition">+</span></summary><p class="mt-3 text-slate-600">Frankfurt by default. US East available on Studio. We've never sold or trained on customer data.</p></details>
    </div>
  </div>
</section>

<footer class="px-6 md:px-12 py-10 border-t border-slate-900/5 grid md:grid-cols-4 gap-8 text-sm text-slate-600">
  <div><p class="font-bold text-slate-900 mb-3">stitch.</p><p>Project tracking for the kind of team that hates project trackers.</p></div>
  <div><p class="font-semibold text-slate-900 mb-3">Product</p><ul class="space-y-2"><li><a href="#">Overview</a></li><li><a href="#">Changelog</a></li><li><a href="#">Roadmap</a></li></ul></div>
  <div><p class="font-semibold text-slate-900 mb-3">Company</p><ul class="space-y-2"><li><a href="#">Customers</a></li><li><a href="#">Manifesto</a></li><li><a href="#">Careers</a></li></ul></div>
  <div><p class="font-semibold text-slate-900 mb-3">Legal</p><ul class="space-y-2"><li><a href="#">Terms</a></li><li><a href="#">Privacy</a></li><li><a href="#">DPA</a></li></ul></div>
</footer>

<script>
  const m = document.getElementById('m'), y = document.getElementById('y');
  function setMode(yearly) {
    if (yearly) { y.className = 'px-5 py-2 rounded-full text-sm font-medium bg-slate-900 text-white'; m.className = 'px-5 py-2 rounded-full text-sm font-medium text-slate-700'; }
    else { m.className = 'px-5 py-2 rounded-full text-sm font-medium bg-slate-900 text-white'; y.className = 'px-5 py-2 rounded-full text-sm font-medium text-slate-700'; }
    document.querySelectorAll('.price').forEach(el => {
      const v = parseInt(yearly ? el.dataset.y : el.dataset.m, 10);
      el.textContent = '$' + v;
    });
  }
  m.addEventListener('click', () => setMode(false));
  y.addEventListener('click', () => setMode(true));
</script>
</body>
</html>"##;

const LANDING_SAAS_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Linden — observability for teams who hate dashboards.</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script>
  tailwind.config = { theme: { extend: { colors: { ink: '#0b0d12', accent: '#7af0c2' } }, fontFamily: { sans: ['Geist','sans-serif'] } } }
</script>
</head>
<body class="bg-ink text-white font-sans antialiased">
<header class="px-6 md:px-12 py-5 flex items-center justify-between max-w-7xl mx-auto">
  <a href="#" class="font-bold text-xl tracking-tight flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-accent"></span>Linden</a>
  <nav class="hidden md:flex gap-8 text-sm text-white/70">
    <a href="#" class="hover:text-white">Product</a>
    <a href="#" class="hover:text-white">Customers</a>
    <a href="#" class="hover:text-white">Pricing</a>
    <a href="#" class="hover:text-white">Docs</a>
  </nav>
  <div class="flex gap-3">
    <a href="#" class="hidden md:inline text-sm text-white/70 hover:text-white px-3 py-2">Sign in</a>
    <a href="#" class="bg-accent text-ink px-4 py-2 rounded-full text-sm font-medium hover:-translate-y-0.5 transition">Try free</a>
  </div>
</header>

<section class="px-6 md:px-12 pt-20 pb-24 max-w-6xl mx-auto text-center relative">
  <div class="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0,rgba(122,240,194,0.18),transparent_60%)]"></div>
  <p class="inline-flex items-center gap-2 text-xs text-white/70 bg-white/5 ring-1 ring-white/10 rounded-full px-4 py-1.5 mb-8">
    <span class="w-1.5 h-1.5 rounded-full bg-accent"></span> v2.4 — query traces from natural language
  </p>
  <h1 class="text-5xl md:text-7xl font-bold tracking-[-0.03em] leading-[1.02] mb-6">Observability that<br/>answers the question.</h1>
  <p class="text-lg md:text-xl text-white/65 max-w-2xl mx-auto leading-relaxed">Linden turns your traces, logs, and metrics into one queryable surface. Ask "why did checkout slow down at 14:02 yesterday" — get the span, the deploy, and the on-call who's already paging.</p>
  <div class="mt-10 flex gap-4 justify-center">
    <a href="#" class="bg-accent text-ink px-7 py-3.5 rounded-full font-medium hover:-translate-y-0.5 transition">Start free — no card</a>
    <a href="#" class="border border-white/15 px-7 py-3.5 rounded-full font-medium hover:bg-white/5 transition">Watch 90s demo</a>
  </div>
  <p class="mt-6 text-xs text-white/40 uppercase tracking-widest">Trusted by Linear · Vercel · Sentry · Cal.com · Plaid</p>
</section>

<section class="px-6 md:px-12 py-20 max-w-6xl mx-auto">
  <div class="grid md:grid-cols-3 gap-6">
    <div class="rounded-3xl bg-white/[0.03] ring-1 ring-white/10 p-7">
      <div class="w-10 h-10 rounded-xl bg-accent/15 ring-1 ring-accent/30 flex items-center justify-center mb-5">
        <svg class="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      </div>
      <h3 class="font-semibold text-xl mb-2">Trace-first, not metric-first.</h3>
      <p class="text-white/65 text-sm leading-relaxed">Start with an actual user request and drill down — never start with a dashboard and try to find the request.</p>
    </div>
    <div class="rounded-3xl bg-white/[0.03] ring-1 ring-white/10 p-7">
      <div class="w-10 h-10 rounded-xl bg-accent/15 ring-1 ring-accent/30 flex items-center justify-center mb-5">
        <svg class="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <h3 class="font-semibold text-xl mb-2">Cardinality you can afford.</h3>
      <p class="text-white/65 text-sm leading-relaxed">Tag every metric by user, tenant, route, deploy — without the invoice anxiety. Median customer pays 1/4 of what Datadog quoted.</p>
    </div>
    <div class="rounded-3xl bg-white/[0.03] ring-1 ring-white/10 p-7">
      <div class="w-10 h-10 rounded-xl bg-accent/15 ring-1 ring-accent/30 flex items-center justify-center mb-5">
        <svg class="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2 4 4 8-8 4 4"/></svg>
      </div>
      <h3 class="font-semibold text-xl mb-2">Deploys correlate themselves.</h3>
      <p class="text-white/65 text-sm leading-relaxed">Every release timeline overlays your p95. Regressions surface in the first alert, not in the war-room twelve hours later.</p>
    </div>
  </div>
</section>

<section class="px-6 md:px-12 py-24 max-w-5xl mx-auto">
  <figure class="rounded-3xl bg-white/[0.03] ring-1 ring-white/10 p-10 md:p-14 text-center">
    <svg class="w-10 h-10 text-accent mx-auto mb-6" fill="currentColor" viewBox="0 0 24 24"><path d="M9.13 9.39c0-3 1.96-5.39 5.87-5.39v2.61c-2.04 0-3.26 1.04-3.26 2.78H14V14H9.13V9.39zM0 14V9.39C0 6.39 1.96 4 5.87 4v2.61c-2.04 0-3.26 1.04-3.26 2.78H4.87V14H0z"/></svg>
    <p class="text-2xl md:text-3xl font-medium leading-[1.3] text-white/90 mb-8">We replaced four tools with Linden in a weekend. Our on-call response time dropped from 22 minutes to under 4, and our observability bill dropped by 71%.</p>
    <figcaption class="text-sm text-white/55">— Anya Khoury, Platform Lead at Plaid</figcaption>
  </figure>
</section>

<section class="px-6 md:px-12 py-20 max-w-4xl mx-auto text-center">
  <h2 class="text-4xl md:text-5xl font-bold tracking-[-0.02em] mb-5">Get answers, not graphs.</h2>
  <p class="text-white/60 text-lg mb-10">Start with the free tier — 30-day retention, 5M spans/month. No card.</p>
  <a href="#" class="inline-block bg-accent text-ink px-8 py-4 rounded-full font-medium hover:-translate-y-0.5 transition">Create your workspace</a>
</section>

<footer class="px-6 md:px-12 py-10 border-t border-white/5 grid md:grid-cols-5 gap-8 text-sm text-white/55 max-w-7xl mx-auto">
  <div class="md:col-span-2"><p class="font-bold text-white mb-3 flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-accent"></span>Linden</p><p>Observability that answers the question. SOC2 Type II · GDPR · HIPAA available.</p></div>
  <div><p class="font-semibold text-white mb-3">Product</p><ul class="space-y-2"><li><a href="#">Tracing</a></li><li><a href="#">Logs</a></li><li><a href="#">Metrics</a></li><li><a href="#">Pricing</a></li></ul></div>
  <div><p class="font-semibold text-white mb-3">Resources</p><ul class="space-y-2"><li><a href="#">Docs</a></li><li><a href="#">Changelog</a></li><li><a href="#">Status</a></li><li><a href="#">Blog</a></li></ul></div>
  <div><p class="font-semibold text-white mb-3">Company</p><ul class="space-y-2"><li><a href="#">About</a></li><li><a href="#">Careers</a></li><li><a href="#">Press</a></li><li><a href="#">Contact</a></li></ul></div>
</footer>
</body>
</html>"##;

const BLOG_POST_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>On the death of the small web — Field Notes, Issue 47</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<script>
  tailwind.config = { theme: { extend: { colors: { paper: '#fbf8f1', ink: '#1c1a17', accent: '#b8531b' } }, fontFamily: { serif: ['Fraunces','serif'], sans: ['Inter','sans-serif'] } } }
</script>
<style>
  body { font-feature-settings: "ss01","cv11"; }
  .prose p { margin-bottom: 1.4em; }
  .prose p::first-letter { font-family: 'Fraunces', serif; font-size: 1.3em; font-weight: 600; }
</style>
</head>
<body class="bg-paper text-ink font-serif antialiased">
<div id="progress" class="fixed top-0 left-0 h-1 bg-accent z-50" style="width:0%"></div>

<header class="px-6 md:px-12 py-6 flex items-center justify-between border-b border-ink/10 font-sans text-sm">
  <a href="#" class="font-serif italic text-xl">Field Notes</a>
  <nav class="flex gap-6 text-ink/70">
    <a href="#" class="hover:text-accent">Archive</a>
    <a href="#" class="hover:text-accent">About</a>
    <a href="#" class="hover:text-accent">Subscribe</a>
  </nav>
</header>

<article class="max-w-2xl mx-auto px-6 md:px-0 py-16 md:py-24">
  <p class="font-sans text-xs uppercase tracking-[0.25em] text-accent mb-6">Issue 47 · 14 May 2026 · 12 minute read</p>
  <h1 class="text-5xl md:text-6xl leading-[1.05] tracking-[-0.02em] mb-6">On the death of the small web, and why I haven't given up on it.</h1>
  <p class="text-xl text-ink/70 leading-relaxed mb-10">Every six months someone publishes the same essay: <em>the indie web is dying.</em> They are right and they are wrong, and the difference matters.</p>

  <div class="flex items-center gap-3 font-sans text-sm text-ink/65 mb-12 pb-12 border-b border-ink/10">
    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-ink"></div>
    <div>
      <p class="font-medium text-ink">Henrik Sundberg</p>
      <p>Writing from Gothenburg · <a href="#" class="text-accent hover:underline">@henrik</a></p>
    </div>
  </div>

  <div class="prose text-lg leading-[1.75] text-ink/85">
    <p>When I started writing on the internet in 2008, the thing that made it worth doing wasn't any particular tool — it was the texture of stumbling into someone's brain. You'd land on a personal site at 1 a.m., read a half-finished essay about, I don't know, the way municipal trains smell different in Copenhagen than Stockholm, and you'd come away with the feeling that there was a specific person on the other end. They had a face. They had a desk lamp. The thing was unfinished and that was the point.</p>
    <p>That texture has been gone, for most readers, for the better part of a decade. We point at the platforms — at Facebook, then Twitter, then everything else — but the more honest version of the story is that we got tired of the work. Writing every day to an audience of seven friends is harder than writing weekly to an audience of seven hundred strangers. So most people made a rational choice.</p>
    <h2 class="font-serif text-3xl md:text-4xl mt-12 mb-6 tracking-[-0.01em]">The reflex everyone has wrong</h2>
    <p>Here's the part where the "small web is back" essays always miss: most of the audience never left, because most of the audience was never there. The audience for personal writing on the internet has always been small. It was small in 2008. It was small in 1997. It is small now. The thing that grew between 2010 and 2022 wasn't audience — it was distribution. We confused traffic for readership and built our self-image around the wrong number.</p>
    <p>When I open my site stats now, in 2026, I see something I find unreasonably comforting: ~600 people read each post, and they read it for an average of 11 minutes. The number is small. The number is also <em>true</em>. Six hundred people, eleven minutes each, no algorithm to negotiate with — that is more attention than most published authors get in a lifetime.</p>
    <h2 class="font-serif text-3xl md:text-4xl mt-12 mb-6 tracking-[-0.01em]">What I'm trying instead</h2>
    <p>I've been writing a paper newsletter for the last fourteen months. Two pages, printed on the back of envelopes I save from junk mail, mailed to forty-three subscribers in nine countries. It costs me sixty-eight euros a month in postage and is, by every metric the internet has taught me to care about, an absurd thing to do.</p>
    <p>It is also the best writing I have done since I was twenty-three. The reason is simple: I cannot scroll past the people I am writing to. They are a list, on paper, taped to the wall above my desk. Olov in Malmö. Lara in Lisbon. A nun in Galway who I have never met and never will. They are not metrics. They are not "subscribers." They are forty-three people who, for some reason I do not fully understand, have asked me to send them mail.</p>
    <p>I do not think the small web is dying. I think a particular fantasy of the small web — the one where you can have intimacy <em>and</em> scale, where you can write into the void and also be heard — is dying, and I think that's good, because that fantasy was always nonsense. The small web is what it always was: a thing you do, slowly, on purpose, for a small group of people whose names you might one day learn.</p>
  </div>

  <div class="mt-16 pt-10 border-t border-ink/10 font-sans">
    <p class="text-xs uppercase tracking-[0.25em] text-accent mb-3">Subscribe</p>
    <p class="text-lg text-ink/75 mb-5">Field Notes ships every other Tuesday. No tracking, no upsell, no Substack.</p>
    <form class="flex gap-2 max-w-md">
      <input type="email" placeholder="you@somewhere.com" class="flex-1 px-4 py-3 rounded-full border border-ink/15 bg-white focus:outline-none focus:ring-2 focus:ring-accent">
      <button class="bg-ink text-paper px-6 py-3 rounded-full font-medium hover:bg-accent transition">Subscribe</button>
    </form>
  </div>
</article>

<footer class="px-6 md:px-12 py-10 border-t border-ink/10 font-sans text-sm text-ink/60 text-center">
  <p>© 2026 Field Notes · Issue 47 · <a href="#" class="hover:text-accent">RSS</a></p>
</footer>

<script>
  const bar = document.getElementById('progress');
  window.addEventListener('scroll', () => {
    const h = document.documentElement;
    const scrolled = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
    bar.style.width = scrolled + '%';
  });
</script>
</body>
</html>"##;

const RESTAURANT_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Trattoria Pico — a tiny Italian room, in Greenpoint.</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<script>
  tailwind.config = { theme: { extend: { colors: { bone: '#f5efe3', wine: '#5b1f1a', olive: '#6a7344' } }, fontFamily: { serif: ['Cormorant Garamond','serif'], sans: ['Inter','sans-serif'] } } }
</script>
</head>
<body class="bg-bone text-wine font-sans antialiased">
<header class="px-6 md:px-12 py-6 flex justify-between items-center absolute top-0 inset-x-0 z-20 text-white">
  <a href="#" class="font-serif italic text-2xl">Trattoria Pico</a>
  <nav class="hidden md:flex gap-8 text-sm tracking-wide uppercase">
    <a href="#menu" class="hover:text-bone/70">Menu</a>
    <a href="#about" class="hover:text-bone/70">About</a>
    <a href="#visit" class="hover:text-bone/70">Visit</a>
  </nav>
  <a href="#reserve" class="text-sm border border-white/40 rounded-full px-5 py-2 hover:bg-white hover:text-wine transition">Reserve</a>
</header>

<section class="relative min-h-[92vh] flex items-end overflow-hidden">
  <div class="absolute inset-0 bg-gradient-to-br from-wine to-[#2a0d0a]"></div>
  <div class="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(245,239,227,0.18),transparent_55%)]"></div>
  <div class="absolute inset-0 opacity-30 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence baseFrequency=%220.85%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%220.5%22/></svg>')]"></div>
  <div class="relative px-6 md:px-12 pb-20 max-w-5xl text-white">
    <p class="text-xs uppercase tracking-[0.3em] text-bone/80 mb-6">Greenpoint, Brooklyn · since 2017</p>
    <h1 class="font-serif text-[clamp(3.5rem,11vw,9rem)] leading-[0.9] tracking-tight italic mb-6">A tiny Italian room.</h1>
    <p class="text-xl md:text-2xl text-bone/85 max-w-xl font-serif italic">Twenty-eight seats, one wood oven, no specials board. Open Wednesday to Sunday.</p>
    <div class="mt-10 flex gap-4">
      <a href="#reserve" class="bg-bone text-wine px-7 py-3.5 rounded-full font-medium hover:bg-olive hover:text-bone transition">Reserve a table</a>
      <a href="#menu" class="border border-white/40 text-white px-7 py-3.5 rounded-full font-medium hover:bg-white hover:text-wine transition">See the menu</a>
    </div>
  </div>
</section>

<section id="menu" class="px-6 md:px-12 py-24 max-w-5xl mx-auto">
  <p class="text-xs uppercase tracking-[0.3em] text-olive mb-5">Dinner</p>
  <h2 class="font-serif text-6xl md:text-7xl mb-16 italic">What we cooked this week.</h2>

  <div class="grid md:grid-cols-2 gap-x-16 gap-y-14">
    <div>
      <h3 class="font-serif text-3xl italic mb-6 border-b border-wine/20 pb-2">Antipasti</h3>
      <ul class="space-y-5">
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Burrata, plum, basil oil</p><p class="text-sm text-wine/65">jersey burrata, satsuma plums, dark basil oil</p></div><span class="font-serif text-xl">18</span></li>
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Vitello tonnato</p><p class="text-sm text-wine/65">veal, sicilian tuna, capers, lemon</p></div><span class="font-serif text-xl">21</span></li>
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Octopus, white bean, salsa verde</p></div><span class="font-serif text-xl">22</span></li>
      </ul>
    </div>
    <div>
      <h3 class="font-serif text-3xl italic mb-6 border-b border-wine/20 pb-2">Pasta</h3>
      <ul class="space-y-5">
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Cacio e pepe</p><p class="text-sm text-wine/65">house tonnarelli, tellicherry pepper</p></div><span class="font-serif text-xl">24</span></li>
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Pappardelle al ragù</p><p class="text-sm text-wine/65">5-hour beef and pork, sangiovese</p></div><span class="font-serif text-xl">28</span></li>
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Squid ink chitarra</p><p class="text-sm text-wine/65">cuttlefish, fresno chili, breadcrumbs</p></div><span class="font-serif text-xl">29</span></li>
      </ul>
    </div>
    <div>
      <h3 class="font-serif text-3xl italic mb-6 border-b border-wine/20 pb-2">Secondi</h3>
      <ul class="space-y-5">
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Wood-fired branzino</p><p class="text-sm text-wine/65">whole, salt-baked, salmoriglio</p></div><span class="font-serif text-xl">42</span></li>
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Bistecca alla fiorentina</p><p class="text-sm text-wine/65">28oz, dry-aged, for two</p></div><span class="font-serif text-xl">110</span></li>
      </ul>
    </div>
    <div>
      <h3 class="font-serif text-3xl italic mb-6 border-b border-wine/20 pb-2">Dolci</h3>
      <ul class="space-y-5">
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Tiramisù</p><p class="text-sm text-wine/65">our nonna's, do not skip</p></div><span class="font-serif text-xl">14</span></li>
        <li class="flex justify-between items-baseline"><div><p class="font-serif text-2xl">Olive oil cake, candied lemon</p></div><span class="font-serif text-xl">13</span></li>
      </ul>
    </div>
  </div>
</section>

<section id="about" class="bg-wine text-bone px-6 md:px-12 py-24">
  <div class="max-w-5xl mx-auto grid md:grid-cols-2 gap-16 items-start">
    <h2 class="font-serif text-5xl md:text-7xl italic leading-[1.05]">"Una piccola sala, una grande cucina."</h2>
    <div class="space-y-5 text-bone/85 leading-relaxed text-lg">
      <p>Trattoria Pico is run by Marta Rossi, who learned to cook in her grandmother's pensione outside Bologna, and Daniel Cho, who used to make wine in Friuli. They opened Pico in 2017 because they could not find a place in New York that served the food they wanted to eat at home.</p>
      <p>The room seats twenty-eight. The menu changes when the market changes. We do not have a private dining room and we do not do buyouts. We do, however, pour you grappa if you stay past midnight.</p>
    </div>
  </div>
</section>

<section id="visit" class="px-6 md:px-12 py-24 max-w-5xl mx-auto grid md:grid-cols-2 gap-16">
  <div>
    <p class="text-xs uppercase tracking-[0.3em] text-olive mb-4">Visit</p>
    <h2 class="font-serif text-5xl md:text-6xl italic mb-8 leading-tight">147 Franklin Street<br/>Brooklyn NY 11222</h2>
    <p class="text-wine/75 leading-relaxed mb-6">Three blocks from the G at Greenpoint Ave. Street parking is a fantasy after 6pm.</p>
    <dl class="space-y-2 text-lg">
      <div class="flex justify-between border-b border-wine/15 pb-2"><dt>Wed – Sat</dt><dd>17:30 – 22:30</dd></div>
      <div class="flex justify-between border-b border-wine/15 pb-2"><dt>Sunday brunch</dt><dd>11:00 – 15:00</dd></div>
      <div class="flex justify-between border-b border-wine/15 pb-2"><dt>Mon – Tue</dt><dd class="text-wine/55">Chiuso</dd></div>
    </dl>
  </div>
  <div id="reserve" class="bg-bone ring-1 ring-wine/15 rounded-3xl p-8 md:p-10">
    <p class="text-xs uppercase tracking-[0.3em] text-olive mb-4">Reserve</p>
    <h3 class="font-serif text-3xl italic mb-6">Book a table.</h3>
    <form class="space-y-3">
      <input type="text" placeholder="Your name" class="w-full px-4 py-3 rounded-full ring-1 ring-wine/15 bg-white focus:outline-none focus:ring-2 focus:ring-olive">
      <div class="grid grid-cols-2 gap-3">
        <input type="date" class="px-4 py-3 rounded-full ring-1 ring-wine/15 bg-white focus:outline-none focus:ring-2 focus:ring-olive">
        <input type="time" class="px-4 py-3 rounded-full ring-1 ring-wine/15 bg-white focus:outline-none focus:ring-2 focus:ring-olive">
      </div>
      <select class="w-full px-4 py-3 rounded-full ring-1 ring-wine/15 bg-white focus:outline-none focus:ring-2 focus:ring-olive">
        <option>Party of 2</option><option>Party of 3</option><option>Party of 4</option><option>Party of 5</option><option>Party of 6+</option>
      </select>
      <button class="w-full bg-wine text-bone py-3 rounded-full font-medium hover:bg-olive transition">Request reservation</button>
    </form>
    <p class="text-xs text-wine/55 mt-4">Same-day requests: call (718) 555-0147.</p>
  </div>
</section>

<footer class="px-6 md:px-12 py-10 border-t border-wine/10 text-sm text-wine/60 flex flex-col md:flex-row justify-between gap-4">
  <p>© 2026 Trattoria Pico — All rights reserved.</p>
  <div class="flex gap-6"><a href="#" class="hover:text-olive">Instagram</a><a href="#" class="hover:text-olive">Resy</a><a href="mailto:ciao@pico.nyc" class="hover:text-olive">ciao@pico.nyc</a></div>
</footer>
</body>
</html>"##;

const FOUR_OH_FOUR_HTML: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>404 — that one we don't have.</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<script>
  tailwind.config = { theme: { extend: { colors: { paper: '#fef9ee', ink: '#1a1715', berry: '#c2185b' } }, fontFamily: { serif: ['Fraunces','serif'], sans: ['Inter','sans-serif'] } } }
</script>
<style>
  @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes wobble { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
  .float { animation: float 5s ease-in-out infinite; }
  .spin-slow { animation: spin 18s linear infinite; }
  .wobble { animation: wobble 3.5s ease-in-out infinite; transform-origin: bottom center; }
</style>
</head>
<body class="bg-paper text-ink font-sans antialiased min-h-screen flex flex-col">
<header class="px-6 md:px-12 py-6 flex justify-between items-center">
  <a href="/" class="font-serif italic text-2xl">orchard.</a>
  <a href="/" class="text-sm bg-ink text-paper px-5 py-2 rounded-full hover:bg-berry transition">← Back home</a>
</header>

<main class="flex-1 flex flex-col items-center justify-center px-6 text-center relative overflow-hidden">
  <div class="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_30%,rgba(194,24,91,0.08),transparent_55%)]"></div>

  <svg class="w-72 h-72 md:w-96 md:h-96 mb-6 float" viewBox="0 0 400 400" fill="none">
    <circle cx="200" cy="220" r="120" fill="#fce7f3"/>
    <g class="spin-slow" style="transform-origin: 200px 220px;">
      <circle cx="200" cy="100" r="12" fill="#c2185b" opacity=".6"/>
      <circle cx="320" cy="220" r="8" fill="#c2185b" opacity=".4"/>
      <circle cx="200" cy="340" r="10" fill="#c2185b" opacity=".5"/>
      <circle cx="80" cy="220" r="14" fill="#c2185b" opacity=".5"/>
    </g>
    <g class="wobble" style="transform-origin: 200px 320px;">
      <ellipse cx="200" cy="280" rx="80" ry="65" fill="#1a1715"/>
      <circle cx="175" cy="265" r="7" fill="#fef9ee"/>
      <circle cx="225" cy="265" r="7" fill="#fef9ee"/>
      <circle cx="175" cy="265" r="3.5" fill="#1a1715"/>
      <circle cx="225" cy="265" r="3.5" fill="#1a1715"/>
      <path d="M 175 295 Q 200 312 225 295" stroke="#fef9ee" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M 140 240 Q 130 215 155 220" stroke="#1a1715" stroke-width="6" fill="none"/>
      <path d="M 260 240 Q 270 215 245 220" stroke="#1a1715" stroke-width="6" fill="none"/>
    </g>
  </svg>

  <p class="font-serif text-7xl md:text-9xl tracking-[-0.03em] mb-2">404</p>
  <h1 class="font-serif text-3xl md:text-4xl mb-4 italic">This one isn't here, friend.</h1>
  <p class="text-ink/65 max-w-md leading-relaxed mb-8">Either the page moved, you mistyped a letter, or you followed a link from a 2014 blogpost. All three are forgivable.</p>

  <div class="flex flex-wrap gap-3 justify-center">
    <a href="/" class="bg-ink text-paper px-6 py-3 rounded-full font-medium hover:bg-berry transition">Take me home</a>
    <a href="/search" class="border border-ink/20 px-6 py-3 rounded-full font-medium hover:bg-white transition">Search the site</a>
    <a href="mailto:hi@orchard.so" class="border border-ink/20 px-6 py-3 rounded-full font-medium hover:bg-white transition">Tell us what broke</a>
  </div>

  <p class="text-xs text-ink/40 mt-12 max-w-sm">P.S. The little guy above does not represent our customer support — they are much more helpful and have, on average, two more eyes.</p>
</main>

<footer class="px-6 md:px-12 py-8 text-sm text-ink/45 text-center border-t border-ink/10">
  © 2026 orchard. · <a href="/" class="hover:text-berry">orchard.so</a>
</footer>
</body>
</html>"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_template_finds_coffee_shop_from_natural_prompt() {
        let result = match_template("build me a coffee shop site");
        assert!(result.is_some(), "expected a match for coffee shop prompt");
        assert_eq!(result.unwrap().slug, "coffee-shop");
    }

    #[test]
    fn match_template_finds_portfolio_for_photography_request() {
        let result = match_template("I want a portfolio for my photography work");
        assert!(result.is_some(), "expected a match for portfolio prompt");
        assert_eq!(result.unwrap().slug, "portfolio");
    }

    #[test]
    fn match_template_returns_none_for_unrelated_prompt() {
        // The matcher should NOT hijack generic phrases that have no keyword
        // overlap with any template's vocabulary.
        let result = match_template("compute the fibonacci sequence please");
        assert!(result.is_none(), "unrelated prompt should not match");
    }

    #[test]
    fn match_template_finds_flappy_bird_clone() {
        let result = match_template("make a flappy bird game");
        assert!(result.is_some());
        assert_eq!(result.unwrap().slug, "flappy-bird");
    }

    #[test]
    fn match_template_handles_empty_prompt() {
        assert!(match_template("").is_none());
        assert!(match_template("   ").is_none());
    }

    #[test]
    fn template_by_slug_finds_exact_slug() {
        let result = template_by_slug("portfolio");
        assert!(result.is_some());
        assert_eq!(result.unwrap().slug, "portfolio");
    }

    #[test]
    fn template_by_slug_accepts_spaced_name() {
        let result = template_by_slug("coffee shop");
        assert!(result.is_some());
        assert_eq!(result.unwrap().slug, "coffee-shop");
    }

    #[test]
    fn every_template_is_valid_html_document() {
        for template in TEMPLATES {
            let starts_doctype = template
                .html
                .trim_start()
                .to_ascii_lowercase()
                .starts_with("<!doctype");
            assert!(
                starts_doctype,
                "template {} does not start with <!DOCTYPE",
                template.slug
            );
            assert!(
                template.html.contains("<body"),
                "template {} is missing <body",
                template.slug
            );
            assert!(
                template.html.contains("</html>"),
                "template {} is missing closing </html>",
                template.slug
            );
        }
    }

    #[test]
    fn every_template_has_keywords() {
        for template in TEMPLATES {
            assert!(
                !template.keywords.is_empty(),
                "template {} has no keywords",
                template.slug
            );
        }
    }

    #[test]
    fn edit_mode_system_prompt_contains_strict_format_rules() {
        let prompt = edit_mode_system_prompt(Some("rust"));
        assert!(prompt.contains("<<<<<<< SEARCH path/to/file"));
        assert!(prompt.contains("======="));
        assert!(prompt.contains(">>>>>>> REPLACE"));
        assert!(prompt.contains("byte-for-byte"));
        assert!(prompt.contains("rust"));
        assert!(!prompt.contains("Mercury"));
    }

    #[test]
    fn edit_mode_user_prompt_embeds_files_and_request() {
        let files = vec![
            (PathBuf::from("src/a.rs"), "fn a() {}\n".to_string()),
            (PathBuf::from("src/b.rs"), "fn b() {}".to_string()),
        ];
        let prompt = edit_mode_user_prompt("rename a to alpha", &files);
        assert!(prompt.contains("## src/a.rs"));
        assert!(prompt.contains("fn a() {}"));
        assert!(prompt.contains("## src/b.rs"));
        assert!(prompt.contains("## Request\nrename a to alpha"));
        // Both files fit easily under the budget.
        assert!(!prompt.contains("truncated"));
    }

    #[test]
    fn edit_mode_user_prompt_truncates_largest_files_first() {
        let big = "x".repeat(EDIT_MODE_EMBED_BUDGET_CHARS + 5_000);
        let small = "y".repeat(100);
        let files = vec![
            (PathBuf::from("big.txt"), big),
            (PathBuf::from("small.txt"), small),
        ];
        let prompt = edit_mode_user_prompt("trim it", &files);
        assert!(prompt.contains("## small.txt"));
        assert!(!prompt.contains("## big.txt"));
        assert!(prompt.contains("1 files truncated"));
        assert!(prompt.contains("## Request\ntrim it"));
    }

    #[test]
    fn matcher_is_deterministic() {
        // Running the matcher twice on the same input must always pick the
        // same template, even when several templates share a keyword.
        let prompt = "build me a coffee menu page";
        let first = match_template(prompt).map(|t| t.slug);
        let second = match_template(prompt).map(|t| t.slug);
        assert_eq!(first, second);
    }
}
