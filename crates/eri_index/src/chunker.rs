//! AST-aware code chunking.
//!
//! For supported languages we walk the tree-sitter parse tree and emit one
//! chunk per function / class / method. Oversize chunks split on the next
//! level of nesting; tiny adjacent chunks are merged. Unsupported
//! languages fall back to a recursive splitter that breaks on blank lines
//! then newlines.

use serde::{Deserialize, Serialize};
use tree_sitter::{Language, Node, Parser, Tree};

const MAX_CHUNK_CHARS: usize = 1000;
const MIN_CHUNK_CHARS: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChunkKind {
    Function,
    Class,
    Module,
    RecursiveFallback,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chunk {
    pub path: String,
    pub byte_start: usize,
    pub byte_end: usize,
    pub line_start: usize,
    pub line_end: usize,
    pub kind: ChunkKind,
    pub content: String,
}

/// Chunk `content` belonging to `path`. The extension on `path` selects
/// the tree-sitter grammar; anything we don't have a grammar for goes
/// through [`recursive_chunks`].
pub fn chunk_file(path: &str, content: &str) -> Vec<Chunk> {
    let language_choice = match language_for_path(path) {
        Some(lc) => lc,
        None => return recursive_chunks(path, content),
    };

    let mut parser = Parser::new();
    if parser.set_language(&language_choice.lang).is_err() {
        return recursive_chunks(path, content);
    }
    let tree: Tree = match parser.parse(content, None) {
        Some(t) => t,
        None => return recursive_chunks(path, content),
    };

    let mut chunks: Vec<Chunk> = Vec::new();
    collect_ast_chunks(
        path,
        content,
        tree.root_node(),
        language_choice.symbol_kinds,
        &mut chunks,
    );

    if chunks.is_empty() {
        return recursive_chunks(path, content);
    }

    merge_small_neighbors(chunks)
}

/// Public for the rare caller (and tests) that wants the recursive
/// splitter directly without going through extension detection.
pub fn recursive_chunks(path: &str, content: &str) -> Vec<Chunk> {
    if content.is_empty() {
        return Vec::new();
    }

    let mut chunks: Vec<Chunk> = Vec::new();
    let mut current = String::new();
    let mut current_start_byte = 0usize;
    let mut cursor_byte = 0usize;

    for paragraph in split_on_blank_lines(content) {
        let para_bytes = paragraph.len();
        if current.is_empty() {
            current_start_byte = cursor_byte;
        }
        if current.chars().count() + paragraph.chars().count() > MAX_CHUNK_CHARS
            && !current.is_empty()
        {
            flush_recursive(
                path,
                content,
                current_start_byte,
                cursor_byte,
                &current,
                &mut chunks,
            );
            current.clear();
            current_start_byte = cursor_byte;
        }
        if paragraph.chars().count() > MAX_CHUNK_CHARS {
            if !current.is_empty() {
                flush_recursive(
                    path,
                    content,
                    current_start_byte,
                    cursor_byte,
                    &current,
                    &mut chunks,
                );
                current.clear();
            }
            split_by_newline(path, content, cursor_byte, paragraph, &mut chunks);
            cursor_byte += para_bytes;
            current_start_byte = cursor_byte;
            continue;
        }
        current.push_str(paragraph);
        cursor_byte += para_bytes;
    }

    if !current.is_empty() {
        flush_recursive(
            path,
            content,
            current_start_byte,
            cursor_byte,
            &current,
            &mut chunks,
        );
    }

    chunks
}

struct LanguageChoice {
    lang: Language,
    symbol_kinds: &'static [(&'static str, ChunkKind)],
}

fn language_for_path(path: &str) -> Option<LanguageChoice> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "rs" => Some(LanguageChoice {
            lang: tree_sitter_rust::language(),
            symbol_kinds: &[
                ("function_item", ChunkKind::Function),
                ("impl_item", ChunkKind::Class),
                ("struct_item", ChunkKind::Class),
                ("enum_item", ChunkKind::Class),
                ("trait_item", ChunkKind::Class),
                ("mod_item", ChunkKind::Module),
            ],
        }),
        "py" => Some(LanguageChoice {
            lang: tree_sitter_python::language(),
            symbol_kinds: &[
                ("function_definition", ChunkKind::Function),
                ("class_definition", ChunkKind::Class),
            ],
        }),
        "js" | "jsx" | "mjs" | "cjs" => Some(LanguageChoice {
            lang: tree_sitter_javascript::language(),
            symbol_kinds: &[
                ("function_declaration", ChunkKind::Function),
                ("function_expression", ChunkKind::Function),
                ("arrow_function", ChunkKind::Function),
                ("method_definition", ChunkKind::Function),
                ("class_declaration", ChunkKind::Class),
            ],
        }),
        "ts" => Some(LanguageChoice {
            lang: tree_sitter_typescript::language_typescript(),
            symbol_kinds: ts_symbol_kinds(),
        }),
        "tsx" => Some(LanguageChoice {
            lang: tree_sitter_typescript::language_tsx(),
            symbol_kinds: ts_symbol_kinds(),
        }),
        "go" => Some(LanguageChoice {
            lang: tree_sitter_go::language(),
            symbol_kinds: &[
                ("function_declaration", ChunkKind::Function),
                ("method_declaration", ChunkKind::Function),
                ("type_declaration", ChunkKind::Class),
            ],
        }),
        _ => None,
    }
}

fn ts_symbol_kinds() -> &'static [(&'static str, ChunkKind)] {
    &[
        ("function_declaration", ChunkKind::Function),
        ("function_expression", ChunkKind::Function),
        ("arrow_function", ChunkKind::Function),
        ("method_definition", ChunkKind::Function),
        ("class_declaration", ChunkKind::Class),
        ("interface_declaration", ChunkKind::Class),
        ("type_alias_declaration", ChunkKind::Class),
        ("enum_declaration", ChunkKind::Class),
    ]
}

fn collect_ast_chunks(
    path: &str,
    content: &str,
    node: Node<'_>,
    symbol_kinds: &[(&str, ChunkKind)],
    chunks: &mut Vec<Chunk>,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(kind) = match_kind(child.kind(), symbol_kinds) {
            let text = node_text(content, child);
            if text.chars().count() > MAX_CHUNK_CHARS {
                // Try to split on next-level nesting; if that yields
                // nothing, emit the oversized chunk as-is.
                let before = chunks.len();
                collect_ast_chunks(path, content, child, symbol_kinds, chunks);
                if chunks.len() == before {
                    push_chunk(path, content, child, kind, chunks);
                }
            } else {
                push_chunk(path, content, child, kind, chunks);
            }
        } else {
            collect_ast_chunks(path, content, child, symbol_kinds, chunks);
        }
    }
}

fn match_kind(node_kind: &str, table: &[(&str, ChunkKind)]) -> Option<ChunkKind> {
    table
        .iter()
        .find(|(k, _)| *k == node_kind)
        .map(|(_, kind)| *kind)
}

fn push_chunk(path: &str, content: &str, node: Node<'_>, kind: ChunkKind, chunks: &mut Vec<Chunk>) {
    let byte_start = node.start_byte();
    let byte_end = node.end_byte();
    let line_start = node.start_position().row + 1;
    let line_end = node.end_position().row + 1;
    let text = node_text(content, node);
    chunks.push(Chunk {
        path: path.to_string(),
        byte_start,
        byte_end,
        line_start,
        line_end,
        kind,
        content: text,
    });
}

fn node_text(content: &str, node: Node<'_>) -> String {
    let bytes = content.as_bytes();
    let start = node.start_byte().min(bytes.len());
    let end = node.end_byte().min(bytes.len());
    String::from_utf8_lossy(&bytes[start..end]).into_owned()
}

fn merge_small_neighbors(mut chunks: Vec<Chunk>) -> Vec<Chunk> {
    if chunks.len() < 2 {
        return chunks;
    }
    chunks.sort_by_key(|c| c.byte_start);
    let mut merged: Vec<Chunk> = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        let chunk_chars = chunk.content.chars().count();
        if let Some(prev) = merged.last_mut() {
            let combined_chars = prev.content.chars().count() + chunk_chars;
            if (chunk_chars < MIN_CHUNK_CHARS || prev.content.chars().count() < MIN_CHUNK_CHARS)
                && combined_chars <= MAX_CHUNK_CHARS
                && prev.path == chunk.path
            {
                prev.byte_end = chunk.byte_end;
                prev.line_end = chunk.line_end;
                prev.content.push_str(&chunk.content);
                prev.kind = ChunkKind::Module;
                continue;
            }
        }
        merged.push(chunk);
    }
    merged
}

fn split_on_blank_lines(text: &str) -> Vec<&str> {
    let mut paragraphs: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'\n'
            && i + 1 < bytes.len()
            && (bytes[i + 1] == b'\n'
                || (bytes[i + 1] == b'\r' && i + 2 < bytes.len() && bytes[i + 2] == b'\n'))
        {
            let mut end = i + 1;
            while end < bytes.len() && (bytes[end] == b'\n' || bytes[end] == b'\r') {
                end += 1;
            }
            paragraphs.push(&text[start..end]);
            start = end;
            i = end;
            continue;
        }
        i += 1;
    }
    if start < bytes.len() {
        paragraphs.push(&text[start..]);
    }
    if paragraphs.is_empty() {
        paragraphs.push(text);
    }
    paragraphs
}

fn split_by_newline(
    path: &str,
    full_content: &str,
    base_byte: usize,
    paragraph: &str,
    chunks: &mut Vec<Chunk>,
) {
    let mut current = String::new();
    let mut current_start_byte = base_byte;
    let mut cursor_byte = base_byte;
    for line in paragraph.split_inclusive('\n') {
        if current.chars().count() + line.chars().count() > MAX_CHUNK_CHARS && !current.is_empty() {
            flush_recursive(
                path,
                full_content,
                current_start_byte,
                cursor_byte,
                &current,
                chunks,
            );
            current.clear();
            current_start_byte = cursor_byte;
        }
        if line.chars().count() > MAX_CHUNK_CHARS {
            // No newlines available; fall back to a hard char-window split.
            split_by_char_window(path, full_content, cursor_byte, line, chunks);
            cursor_byte += line.len();
            current_start_byte = cursor_byte;
            continue;
        }
        current.push_str(line);
        cursor_byte += line.len();
    }
    if !current.is_empty() {
        flush_recursive(
            path,
            full_content,
            current_start_byte,
            cursor_byte,
            &current,
            chunks,
        );
    }
}

fn split_by_char_window(
    path: &str,
    full_content: &str,
    base_byte: usize,
    text: &str,
    chunks: &mut Vec<Chunk>,
) {
    let mut buf = String::new();
    let mut buf_start_byte = base_byte;
    let mut cursor_byte = base_byte;
    for ch in text.chars() {
        if buf.chars().count() >= MAX_CHUNK_CHARS {
            flush_recursive(
                path,
                full_content,
                buf_start_byte,
                cursor_byte,
                &buf,
                chunks,
            );
            buf.clear();
            buf_start_byte = cursor_byte;
        }
        buf.push(ch);
        cursor_byte += ch.len_utf8();
    }
    if !buf.is_empty() {
        flush_recursive(
            path,
            full_content,
            buf_start_byte,
            cursor_byte,
            &buf,
            chunks,
        );
    }
}

fn flush_recursive(
    path: &str,
    full_content: &str,
    byte_start: usize,
    byte_end: usize,
    text: &str,
    chunks: &mut Vec<Chunk>,
) {
    if text.trim().is_empty() {
        return;
    }
    let line_start = byte_offset_to_line(full_content, byte_start);
    let line_end = byte_offset_to_line(full_content, byte_end.saturating_sub(1));
    chunks.push(Chunk {
        path: path.to_string(),
        byte_start,
        byte_end,
        line_start,
        line_end,
        kind: ChunkKind::RecursiveFallback,
        content: text.to_string(),
    });
}

fn byte_offset_to_line(content: &str, offset: usize) -> usize {
    let clamped = offset.min(content.len());
    content[..clamped].bytes().filter(|b| *b == b'\n').count() + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_rust_functions() {
        // Two non-trivial functions and a struct — large enough to avoid
        // the small-sibling merge so the AST-aware splitter actually
        // produces multiple distinct chunks.
        let src = r#"
fn alpha(input: &str) -> i32 {
    // Pad this body so the chunk exceeds the small-merge threshold and
    // the AST splitter keeps it as its own function-kind chunk.
    let trimmed = input.trim();
    let count: i32 = trimmed.chars().filter(|c| c.is_alphanumeric()).count() as i32;
    let doubled = count.wrapping_mul(2);
    let normalized = doubled.wrapping_add(7);
    normalized
}

fn beta(value: i32) -> i32 {
    let mut accumulator: i32 = value;
    for step in 1..=10 {
        accumulator = accumulator.wrapping_add(step);
    }
    accumulator.wrapping_mul(3)
}

struct Holder {
    name: String,
    value: i32,
    metadata: Vec<String>,
}
"#;
        let chunks = chunk_file("lib.rs", src);
        assert!(!chunks.is_empty());
        let joined: String = chunks.iter().map(|c| c.content.as_str()).collect();
        assert!(joined.contains("fn alpha"));
        assert!(joined.contains("fn beta"));
        assert!(joined.contains("struct Holder"));
    }

    #[test]
    fn chunks_typescript_class_and_function() {
        let src = r#"
export function add(a: number, b: number): number {
    return a + b;
}

export class Counter {
    private value = 0;
    increment(): number {
        this.value += 1;
        return this.value;
    }
}
"#;
        let chunks = chunk_file("app.ts", src);
        assert!(!chunks.is_empty());
        let contents: String = chunks.iter().map(|c| c.content.as_str()).collect();
        assert!(contents.contains("function add"));
        assert!(contents.contains("class Counter"));
    }

    #[test]
    fn falls_back_for_unsupported_extension() {
        let src = "alpha bravo\n\ncharlie delta\n";
        let chunks = chunk_file("notes.txt", src);
        assert!(!chunks.is_empty());
        assert!(
            chunks
                .iter()
                .all(|c| c.kind == ChunkKind::RecursiveFallback)
        );
    }

    #[test]
    fn recursive_splitter_respects_max_chunk_chars() {
        let big = "a".repeat(2500);
        let chunks = recursive_chunks("big.txt", &big);
        assert!(chunks.len() >= 2);
        for chunk in &chunks {
            assert!(chunk.content.chars().count() <= MAX_CHUNK_CHARS);
        }
    }
}
