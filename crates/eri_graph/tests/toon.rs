use std::fs;
use std::path::PathBuf;

use eri_graph::{Graph, NodeKind};

const SAMPLE_HTML: &str = r##"<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="description" content="Eri is a voice-first iteration loop for product designers and prototypers who want to ship changes in under two seconds.">
    <title>Eri — voice-first iteration over your prototype</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
    <style>
      :root { --bg: #ffffff; --fg: #111111; --accent: #4f46e5; --muted: #6b7280; --radius: 12px; }
      body { margin: 0; padding: 0; font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; color: var(--fg); background: var(--bg); line-height: 1.55; }
      h1, h2, h3 { font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.5em 0; }
      .container { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
      .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 20px; border-radius: var(--radius); background: var(--accent); color: white; border: 0; cursor: pointer; font-weight: 500; transition: transform 120ms ease, opacity 120ms ease; }
      .btn:hover { transform: translateY(-1px); opacity: 0.94; }
      .feature.card { padding: 24px; border-radius: var(--radius); background: #fafafa; border: 1px solid #eee; }
    </style>
  </head>
  <body class="page-home theme-light">
    <header id="top" class="site-header" role="banner">
      <div class="container header-row">
        <a class="brand" href="/" aria-label="Eri home">
          <img alt="Eri logomark" src="logo.svg" width="28" height="28">
          <span class="wordmark">Eri</span>
        </a>
        <nav class="primary-nav" aria-label="Primary">
          <a href="#features" class="nav-link">Features</a>
          <a href="#pricing" class="nav-link">Pricing</a>
          <a href="#docs" class="nav-link">Docs</a>
          <a href="#changelog" class="nav-link">Changelog</a>
          <button id="menu" aria-label="Open menu" class="btn btn-ghost mobile-only">Menu</button>
        </nav>
      </div>
    </header>
    <main id="content" role="main">
      <section id="hero" class="hero section-padded" aria-labelledby="hero-title">
        <div class="container hero-grid">
          <div class="hero-copy">
            <h1 id="hero-title">Voice-first iteration over your prototype</h1>
            <p class="lead">Speak the change. Watch the diff land in under two seconds. Eri pairs a local voice loop with a hosted diffusion model so you can iterate on real HTML without leaving the canvas.</p>
            <div class="hero-ctas">
              <button id="cta" class="btn btn-primary">Get started</button>
              <a class="btn btn-secondary" href="#demo">Watch the 90-second demo</a>
            </div>
            <p class="muted small">Free during preview. No credit card. macOS and Linux today, Windows next month.</p>
          </div>
          <img alt="Eri editing a landing page with voice" src="hero.jpg" class="hero-shot" loading="eager" decoding="async">
        </div>
      </section>
      <section id="features" class="features section-padded" aria-labelledby="features-title">
        <div class="container">
          <h2 id="features-title">Why teams pick Eri</h2>
          <div class="feature-grid">
            <article class="feature card" aria-labelledby="f1">
              <h3 id="f1">Voice control</h3>
              <p>Speak, see, ship. The local recognizer transcribes in real time and Eri turns natural language into precise diffs against your source.</p>
            </article>
            <article class="feature card" aria-labelledby="f2">
              <h3 id="f2">Sub-two-second edits</h3>
              <p>Diffusion-backed iteration. We stream the model's tokens straight into the open file and reload the preview the moment the diff applies.</p>
            </article>
            <article class="feature card" aria-labelledby="f3">
              <h3 id="f3">Stays on your machine</h3>
              <p>Audio, gaze, and TTS sidecars run locally. Only the diff request leaves your laptop, and never on a free tier.</p>
            </article>
            <article class="feature card" aria-labelledby="f4">
              <h3 id="f4">Plays with your stack</h3>
              <p>Plain HTML, CSS, and JS today. Tailwind and React next. No framework lock-in, no opaque project file.</p>
            </article>
          </div>
        </div>
      </section>
      <section id="pricing" class="pricing section-padded" aria-labelledby="pricing-title">
        <div class="container">
          <h2 id="pricing-title">Pricing</h2>
          <p class="muted">Free during preview. Paid tiers ship when we exit beta.</p>
        </div>
      </section>
      <section id="contact" class="contact section-padded" aria-labelledby="contact-title">
        <div class="container">
          <h2 id="contact-title">Talk to us</h2>
          <p>Questions, bug reports, or feature requests. We answer every message.</p>
          <form id="contact-form" method="post" action="/contact" novalidate>
            <label for="email">Email</label>
            <input id="email" type="email" name="email" required autocomplete="email" placeholder="you@example.com">
            <label for="message">Message</label>
            <textarea id="message" name="message" rows="4" required placeholder="What are you building?"></textarea>
            <button id="submit-contact" type="submit" class="btn btn-primary">Send message</button>
          </form>
        </div>
      </section>
    </main>
    <footer id="bottom" class="site-footer" role="contentinfo">
      <div class="container footer-row">
        <p class="muted small">© Eri, 2026. Made with caffeine and silent corridors.</p>
        <nav class="footer-nav" aria-label="Footer">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/security">Security</a>
        </nav>
      </div>
    </footer>
    <script src="app.js" defer></script>
    <script>
      window.addEventListener('DOMContentLoaded', function () {
        var cta = document.getElementById('cta');
        if (cta) cta.addEventListener('click', function () { console.log('cta clicked'); });
      });
    </script>
  </body>
</html>
"##;

fn project_with(tmp: &PathBuf, html: &str) {
    fs::create_dir_all(tmp).unwrap();
    fs::write(tmp.join("index.html"), html).unwrap();
    fs::write(tmp.join("styles.css"), "body { margin: 0; }\n").unwrap();
    fs::write(tmp.join("app.js"), "console.log('hello');\n").unwrap();
}

fn unique_tmp(name: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("eri_graph_test_{}_{}", name, nanos));
    let _ = fs::remove_dir_all(&dir);
    dir
}

#[test]
fn build_extracts_section_nodes_from_sample_html() {
    let tmp = unique_tmp("build");
    project_with(&tmp, SAMPLE_HTML);
    let graph = Graph::build(&tmp).expect("build graph");

    let section_names: Vec<&str> = graph
        .nodes
        .iter()
        .filter(|n| matches!(n.kind, NodeKind::Section))
        .map(|n| n.name.as_str())
        .collect();
    for expected in ["top", "primary-nav", "hero", "features", "contact", "bottom"] {
        assert!(
            section_names.contains(&expected),
            "expected section {expected} in {section_names:?}"
        );
    }
    // Components should include named buttons.
    assert!(graph
        .nodes
        .iter()
        .any(|n| matches!(n.kind, NodeKind::Component) && n.name == "cta"));
    assert!(graph
        .nodes
        .iter()
        .any(|n| matches!(n.kind, NodeKind::Component) && n.name == "submit-contact"));

    // Style/script docs from sibling files exist.
    assert!(graph
        .nodes
        .iter()
        .any(|n| matches!(n.kind, NodeKind::Style) && n.name == "styles.css"));
    assert!(graph
        .nodes
        .iter()
        .any(|n| matches!(n.kind, NodeKind::Script) && n.name == "app.js"));

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn toon_is_5x_smaller_than_source_html() {
    let tmp = unique_tmp("smaller");
    project_with(&tmp, SAMPLE_HTML);
    let graph = Graph::build(&tmp).expect("build graph");
    let toon = graph.to_toon();
    let ratio = SAMPLE_HTML.len() as f64 / toon.len().max(1) as f64;
    assert!(
        ratio >= 5.0,
        "expected TOON to be >=5x smaller than HTML; html={} toon={} ratio={:.2}\nTOON:\n{}",
        SAMPLE_HTML.len(),
        toon.len(),
        ratio,
        toon
    );

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn toon_serialization_is_deterministic() {
    let tmp = unique_tmp("deterministic");
    project_with(&tmp, SAMPLE_HTML);
    let graph = Graph::build(&tmp).expect("build graph");
    let a = graph.to_toon();
    let b = graph.to_toon();
    let c = Graph::build(&tmp).expect("build twice").to_toon();
    assert_eq!(a, b);
    assert_eq!(a, c, "rebuilding from the same project must produce the same TOON");

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn fit_to_token_budget_includes_query_matches() {
    let tmp = unique_tmp("budget");
    project_with(&tmp, SAMPLE_HTML);
    let graph = Graph::build(&tmp).expect("build graph");
    let toon = graph.fit_to_token_budget("contact", 200);
    assert!(toon.contains("contact"), "expected query match in TOON:\n{}", toon);
    assert!(
        toon.contains("doc#"),
        "expected document root for context in TOON:\n{}",
        toon
    );

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn update_file_changes_only_named_path() {
    let tmp = unique_tmp("update");
    project_with(&tmp, SAMPLE_HTML);
    let mut graph = Graph::build(&tmp).expect("build graph");
    let before_js: Vec<u32> = graph
        .nodes
        .iter()
        .filter(|n| n.path.file_name().and_then(|f| f.to_str()) == Some("app.js"))
        .map(|n| n.id)
        .collect();
    let before_css: Vec<u32> = graph
        .nodes
        .iter()
        .filter(|n| n.path.file_name().and_then(|f| f.to_str()) == Some("styles.css"))
        .map(|n| n.id)
        .collect();
    assert_eq!(before_js.len(), 1);
    assert_eq!(before_css.len(), 1);

    let app_path = tmp.join("app.js");
    fs::write(&app_path, "console.log('updated');\nconsole.warn('hi');\n").unwrap();
    graph.update_file(&tmp, &app_path).unwrap();

    let after_css: Vec<u32> = graph
        .nodes
        .iter()
        .filter(|n| n.path.file_name().and_then(|f| f.to_str()) == Some("styles.css"))
        .map(|n| n.id)
        .collect();
    assert_eq!(after_css, before_css, "CSS node should be untouched");

    let after_js: Vec<u32> = graph
        .nodes
        .iter()
        .filter(|n| n.path.file_name().and_then(|f| f.to_str()) == Some("app.js"))
        .map(|n| n.id)
        .collect();
    assert_eq!(after_js.len(), 1);
    assert_ne!(after_js, before_js, "JS node should have a fresh id after rescan");

    fs::remove_dir_all(&tmp).ok();
}

#[test]
fn save_and_load_roundtrip() {
    let tmp = unique_tmp("persist");
    project_with(&tmp, SAMPLE_HTML);
    let graph = Graph::build(&tmp).expect("build graph");
    let path = tmp.join("graph.json");
    graph.save(&path).unwrap();
    let loaded = Graph::load(&path).unwrap();
    assert_eq!(loaded.to_toon(), graph.to_toon());

    fs::remove_dir_all(&tmp).ok();
}
