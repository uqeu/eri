//! Tiny self-contained SVG renderer for [`Codemap`].
//!
//! No npm dep, no real physics. We pack nodes onto a grid sized by
//! `ceil(sqrt(n))`, draw edges as straight lines underneath, then drop a
//! circle + label per node. The goal is readable, not pretty.

use std::fmt::Write as _;

use crate::{Codemap, CodemapEdge, CodemapNode, NodeKind};

const CANVAS_PADDING: f32 = 40.0;
const CELL_SIZE: f32 = 160.0;
const BASE_RADIUS: f32 = 18.0;
const MAX_RADIUS: f32 = 48.0;
const LABEL_FONT_PX: u32 = 12;

/// Render `map` as a standalone SVG document.
pub fn render_svg(map: &Codemap) -> String {
    if map.nodes.is_empty() {
        return empty_svg(&map.name);
    }

    let positions = layout_grid(&map.nodes);
    let (width, height) = canvas_bounds(&positions);

    let mut out = String::with_capacity(1024 + map.nodes.len() * 96 + map.edges.len() * 64);
    let _ = writeln!(
        out,
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="{font}">"#,
        w = width.ceil() as u32,
        h = height.ceil() as u32,
        font = LABEL_FONT_PX,
    );
    let _ = writeln!(
        out,
        r##"<rect x="0" y="0" width="{w}" height="{h}" fill="#0b0d10"/>"##,
        w = width.ceil() as u32,
        h = height.ceil() as u32,
    );
    let _ = writeln!(
        out,
        r##"<text x="{x}" y="{y}" fill="#9aa4ad" font-size="14">codemap · {name}</text>"##,
        x = CANVAS_PADDING / 2.0,
        y = LABEL_FONT_PX as f32 + 8.0,
        name = escape_xml(&map.name),
    );

    render_edges(&mut out, &map.edges, &map.nodes, &positions);
    render_nodes(&mut out, &map.nodes, &positions);

    out.push_str("</svg>\n");
    out
}

fn empty_svg(name: &str) -> String {
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80" font-family="ui-sans-serif" font-size="12">
<rect width="320" height="80" fill="#0b0d10"/>
<text x="16" y="44" fill="#9aa4ad">codemap · {} (empty)</text>
</svg>
"##,
        escape_xml(name)
    )
}

fn layout_grid(nodes: &[CodemapNode]) -> Vec<(f32, f32)> {
    let n = nodes.len();
    let cols = (n as f32).sqrt().ceil().max(1.0) as usize;
    let mut out: Vec<(f32, f32)> = Vec::with_capacity(n);
    for (idx, _node) in nodes.iter().enumerate() {
        let col = idx % cols;
        let row = idx / cols;
        let x = CANVAS_PADDING + (col as f32) * CELL_SIZE + CELL_SIZE / 2.0;
        let y = CANVAS_PADDING + (row as f32) * CELL_SIZE + CELL_SIZE / 2.0 + 24.0;
        out.push((x, y));
    }
    out
}

fn canvas_bounds(positions: &[(f32, f32)]) -> (f32, f32) {
    let mut max_x = 320.0f32;
    let mut max_y = 120.0f32;
    for (x, y) in positions {
        if *x + CELL_SIZE / 2.0 > max_x {
            max_x = *x + CELL_SIZE / 2.0;
        }
        if *y + CELL_SIZE / 2.0 > max_y {
            max_y = *y + CELL_SIZE / 2.0;
        }
    }
    (max_x + CANVAS_PADDING, max_y + CANVAS_PADDING)
}

fn render_edges(
    out: &mut String,
    edges: &[CodemapEdge],
    nodes: &[CodemapNode],
    positions: &[(f32, f32)],
) {
    if edges.is_empty() {
        return;
    }
    let max_weight = edges
        .iter()
        .map(|e| e.weight)
        .fold(1.0_f32, |acc, w| acc.max(w));
    for edge in edges {
        let from_idx = match nodes.iter().position(|n| n.id == edge.from) {
            Some(i) => i,
            None => continue,
        };
        let to_idx = match nodes.iter().position(|n| n.id == edge.to) {
            Some(i) => i,
            None => continue,
        };
        let (x1, y1) = positions[from_idx];
        let (x2, y2) = positions[to_idx];
        let stroke_width = 0.8 + (edge.weight / max_weight) * 2.4;
        let _ = writeln!(
            out,
            r##"<line x1="{x1:.1}" y1="{y1:.1}" x2="{x2:.1}" y2="{y2:.1}" stroke="#3b4651" stroke-width="{w:.2}" stroke-linecap="round" opacity="0.7"/>"##,
            w = stroke_width
        );
    }
}

fn render_nodes(out: &mut String, nodes: &[CodemapNode], positions: &[(f32, f32)]) {
    let max_hint = nodes
        .iter()
        .map(|n| n.size_hint as f32)
        .fold(1.0_f32, |acc, v| acc.max(v));
    for (node, (x, y)) in nodes.iter().zip(positions) {
        let radius = (BASE_RADIUS
            + ((node.size_hint as f32) / max_hint) * (MAX_RADIUS - BASE_RADIUS))
            .clamp(BASE_RADIUS, MAX_RADIUS);
        let fill = node_fill(node.kind);
        let _ = writeln!(
            out,
            r##"<circle cx="{x:.1}" cy="{y:.1}" r="{r:.1}" fill="{fill}" stroke="#1d2329" stroke-width="1.5"/>"##,
            r = radius,
            fill = fill,
        );
        let _ = writeln!(
            out,
            r##"<text x="{x:.1}" y="{ly:.1}" text-anchor="middle" fill="#e6edf3">{label}</text>"##,
            ly = y + radius + (LABEL_FONT_PX as f32) + 2.0,
            label = escape_xml(&node.label),
        );
    }
}

fn node_fill(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Module => "#3a86ff",
        NodeKind::Function => "#06d6a0",
        NodeKind::Type => "#ffd166",
        NodeKind::File => "#ef476f",
    }
}

fn escape_xml(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CodemapEdge, CodemapKind, CodemapNode, EdgeKind, NodeKind};
    use serde_json::json;

    fn sample_map() -> Codemap {
        Codemap {
            name: "demo".into(),
            kind: CodemapKind::Module,
            nodes: vec![
                CodemapNode {
                    id: "module:alpha".into(),
                    kind: NodeKind::Module,
                    label: "alpha".into(),
                    path: Some("alpha".into()),
                    size_hint: 4,
                    metadata: json!({}),
                },
                CodemapNode {
                    id: "module:beta".into(),
                    kind: NodeKind::Module,
                    label: "beta".into(),
                    path: Some("beta".into()),
                    size_hint: 2,
                    metadata: json!({}),
                },
            ],
            edges: vec![CodemapEdge {
                from: "module:beta".into(),
                to: "module:alpha".into(),
                kind: EdgeKind::Imports,
                weight: 3.0,
            }],
            generated_at_ms: 0,
        }
    }

    #[test]
    fn render_produces_svg_with_nodes_and_edges() {
        let svg = render_svg(&sample_map());
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains(">alpha<"));
        assert!(svg.contains(">beta<"));
        assert!(svg.contains("<line"));
        assert!(svg.contains("<circle"));
    }

    #[test]
    fn empty_codemap_still_renders() {
        let svg = render_svg(&Codemap {
            name: "empty".into(),
            kind: CodemapKind::Module,
            nodes: vec![],
            edges: vec![],
            generated_at_ms: 0,
        });
        assert!(svg.contains("empty"));
        assert!(svg.contains("<svg"));
    }
}
