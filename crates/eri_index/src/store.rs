//! SQLite-backed persistence for chunks, embeddings, and per-file state.
//!
//! Schema:
//! ```sql
//! CREATE TABLE chunks (
//!     id INTEGER PRIMARY KEY,
//!     path TEXT NOT NULL,
//!     byte_start INTEGER NOT NULL,
//!     byte_end INTEGER NOT NULL,
//!     line_start INTEGER NOT NULL,
//!     line_end INTEGER NOT NULL,
//!     kind TEXT NOT NULL,
//!     content TEXT NOT NULL,
//!     mtime INTEGER NOT NULL,
//!     content_hash BLOB NOT NULL
//! );
//! CREATE TABLE embeddings (
//!     chunk_id INTEGER PRIMARY KEY,
//!     vec BLOB NOT NULL,
//!     FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
//! );
//! CREATE TABLE file_state (
//!     path TEXT PRIMARY KEY,
//!     mtime INTEGER NOT NULL,
//!     content_hash BLOB NOT NULL
//! );
//! ```

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use thiserror::Error;

use crate::chunker::{Chunk, ChunkKind};

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("invalid embedding blob: {0}")]
    InvalidVector(String),
    #[error("unknown chunk kind in db: {0}")]
    UnknownKind(String),
}

pub struct Store {
    conn: Connection,
}

#[derive(Clone, Debug)]
pub struct StoredFile {
    pub path: String,
    pub mtime: i64,
    pub content_hash: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct StoredChunk {
    pub id: i64,
    pub chunk: Chunk,
}

impl Store {
    /// Open or create the database at `path`. The containing directory is
    /// created lazily.
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent).map_err(|e| {
                StoreError::Sqlite(rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
            })?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    /// In-memory variant. Mostly used by tests.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), StoreError> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL,
                byte_start INTEGER NOT NULL,
                byte_end INTEGER NOT NULL,
                line_start INTEGER NOT NULL,
                line_end INTEGER NOT NULL,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                mtime INTEGER NOT NULL,
                content_hash BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);

            CREATE TABLE IF NOT EXISTS embeddings (
                chunk_id INTEGER PRIMARY KEY,
                vec BLOB NOT NULL,
                FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS file_state (
                path TEXT PRIMARY KEY,
                mtime INTEGER NOT NULL,
                content_hash BLOB NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    pub fn get_file_state(&self, path: &str) -> Result<Option<StoredFile>, StoreError> {
        let row = self
            .conn
            .query_row(
                "SELECT path, mtime, content_hash FROM file_state WHERE path = ?1",
                params![path],
                |row| {
                    Ok(StoredFile {
                        path: row.get(0)?,
                        mtime: row.get(1)?,
                        content_hash: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn list_file_paths(&self) -> Result<Vec<String>, StoreError> {
        let mut stmt = self.conn.prepare("SELECT path FROM file_state")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out: Vec<String> = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Replace all chunks/embeddings for `path` and update its file_state.
    /// Caller-supplied vectors are stored bit-packed as f32 LE.
    pub fn upsert_file(
        &mut self,
        path: &str,
        mtime: i64,
        content_hash: &[u8],
        chunks_with_vectors: &[(Chunk, Vec<f32>)],
    ) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM chunks WHERE path = ?1", params![path])?;
        for (chunk, vector) in chunks_with_vectors {
            tx.execute(
                "INSERT INTO chunks (path, byte_start, byte_end, line_start, line_end, kind, content, mtime, content_hash) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    chunk.path,
                    chunk.byte_start as i64,
                    chunk.byte_end as i64,
                    chunk.line_start as i64,
                    chunk.line_end as i64,
                    kind_to_str(chunk.kind),
                    chunk.content,
                    mtime,
                    content_hash,
                ],
            )?;
            let id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO embeddings (chunk_id, vec) VALUES (?1, ?2)",
                params![id, pack_vector(vector)],
            )?;
        }
        tx.execute(
            "INSERT INTO file_state (path, mtime, content_hash) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, content_hash=excluded.content_hash",
            params![path, mtime, content_hash],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_file(&mut self, path: &str) -> Result<(), StoreError> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM chunks WHERE path = ?1", params![path])?;
        tx.execute("DELETE FROM file_state WHERE path = ?1", params![path])?;
        tx.commit()?;
        Ok(())
    }

    pub fn count_chunks(&self) -> Result<usize, StoreError> {
        let n: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))?;
        Ok(n as usize)
    }

    pub fn count_files(&self) -> Result<usize, StoreError> {
        let n: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM file_state", [], |row| row.get(0))?;
        Ok(n as usize)
    }

    pub fn total_bytes(&self) -> Result<u64, StoreError> {
        let n: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(byte_end - byte_start), 0) FROM chunks",
            [],
            |row| row.get(0),
        )?;
        Ok(n.max(0) as u64)
    }

    /// Iterate every (chunk, embedding) pair. Used by the brute-force
    /// cosine search at query time.
    pub fn iter_chunks_with_vectors(&self) -> Result<Vec<(StoredChunk, Vec<f32>)>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.path, c.byte_start, c.byte_end, c.line_start, c.line_end, c.kind, c.content, e.vec \
             FROM chunks c \
             JOIN embeddings e ON e.chunk_id = c.id",
        )?;
        let rows = stmt.query_map([], |row| {
            let kind_str: String = row.get(6)?;
            let blob: Vec<u8> = row.get(8)?;
            Ok((
                StoredChunk {
                    id: row.get(0)?,
                    chunk: Chunk {
                        path: row.get(1)?,
                        byte_start: row.get::<_, i64>(2)? as usize,
                        byte_end: row.get::<_, i64>(3)? as usize,
                        line_start: row.get::<_, i64>(4)? as usize,
                        line_end: row.get::<_, i64>(5)? as usize,
                        kind: ChunkKind::Module,
                        content: row.get(7)?,
                    },
                },
                kind_str,
                blob,
            ))
        })?;
        let mut out: Vec<(StoredChunk, Vec<f32>)> = Vec::new();
        for row in rows {
            let (mut stored, kind_str, blob) = row?;
            stored.chunk.kind = str_to_kind(&kind_str)?;
            let vector = unpack_vector(&blob)?;
            out.push((stored, vector));
        }
        Ok(out)
    }
}

fn kind_to_str(kind: ChunkKind) -> &'static str {
    match kind {
        ChunkKind::Function => "function",
        ChunkKind::Class => "class",
        ChunkKind::Module => "module",
        ChunkKind::RecursiveFallback => "recursive_fallback",
    }
}

fn str_to_kind(s: &str) -> Result<ChunkKind, StoreError> {
    match s {
        "function" => Ok(ChunkKind::Function),
        "class" => Ok(ChunkKind::Class),
        "module" => Ok(ChunkKind::Module),
        "recursive_fallback" => Ok(ChunkKind::RecursiveFallback),
        other => Err(StoreError::UnknownKind(other.to_string())),
    }
}

fn pack_vector(v: &[f32]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn unpack_vector(b: &[u8]) -> Result<Vec<f32>, StoreError> {
    if !b.len().is_multiple_of(4) {
        return Err(StoreError::InvalidVector(format!(
            "blob length {} not divisible by 4",
            b.len()
        )));
    }
    let mut out: Vec<f32> = Vec::with_capacity(b.len() / 4);
    for chunk in b.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunker::{Chunk, ChunkKind};

    fn sample_chunk(path: &str, content: &str) -> Chunk {
        Chunk {
            path: path.to_string(),
            byte_start: 0,
            byte_end: content.len(),
            line_start: 1,
            line_end: 1,
            kind: ChunkKind::Function,
            content: content.to_string(),
        }
    }

    #[test]
    fn upsert_then_read_back() {
        let mut store = Store::open_in_memory().unwrap();
        let chunk = sample_chunk("a.rs", "fn a() {}");
        store
            .upsert_file(
                "a.rs",
                1,
                b"hash-a",
                &[(chunk.clone(), vec![1.0, 2.0, 3.0])],
            )
            .unwrap();
        assert_eq!(store.count_files().unwrap(), 1);
        assert_eq!(store.count_chunks().unwrap(), 1);
        let state = store.get_file_state("a.rs").unwrap().unwrap();
        assert_eq!(state.content_hash, b"hash-a");
        let pairs = store.iter_chunks_with_vectors().unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0.chunk.path, "a.rs");
        assert_eq!(pairs[0].1, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn upsert_replaces_existing_chunks_for_path() {
        let mut store = Store::open_in_memory().unwrap();
        let a = sample_chunk("f.rs", "fn old() {}");
        store
            .upsert_file("f.rs", 1, b"v1", &[(a, vec![0.1, 0.2])])
            .unwrap();
        let b = sample_chunk("f.rs", "fn new() {}");
        let c = sample_chunk("f.rs", "fn extra() {}");
        store
            .upsert_file(
                "f.rs",
                2,
                b"v2",
                &[(b, vec![0.3, 0.4]), (c, vec![0.5, 0.6])],
            )
            .unwrap();
        assert_eq!(store.count_chunks().unwrap(), 2);
        let state = store.get_file_state("f.rs").unwrap().unwrap();
        assert_eq!(state.content_hash, b"v2");
    }

    #[test]
    fn delete_file_removes_chunks_and_state() {
        let mut store = Store::open_in_memory().unwrap();
        let chunk = sample_chunk("x.rs", "fn x() {}");
        store
            .upsert_file("x.rs", 1, b"h", &[(chunk, vec![1.0])])
            .unwrap();
        store.delete_file("x.rs").unwrap();
        assert_eq!(store.count_files().unwrap(), 0);
        assert_eq!(store.count_chunks().unwrap(), 0);
        assert!(store.get_file_state("x.rs").unwrap().is_none());
    }

    #[test]
    fn vector_roundtrip_preserves_values() {
        let v = vec![-1.5f32, 0.0, 3.14, f32::MIN_POSITIVE];
        let packed = pack_vector(&v);
        let back = unpack_vector(&packed).unwrap();
        assert_eq!(v, back);
    }
}
