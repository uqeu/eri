//! SQLite-backed persistence for the agent-memory graph.
//!
//! Schema kept deliberately small — kind and edge taxonomies are stored as
//! TEXT so the taxonomy can evolve without migrations. JSON bodies live in
//! TEXT columns serialized via `serde_json`.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::GraphError;
use crate::types::{Edge, Node};

pub(crate) struct Store {
    conn: Connection,
}

impl Store {
    /// Open or create the database file at `path`. Parent directories are
    /// created lazily.
    pub fn open(path: &Path) -> Result<Self, GraphError> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::configure(&conn)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    /// In-memory variant. Used by tests.
    pub fn open_in_memory() -> Result<Self, GraphError> {
        let conn = Connection::open_in_memory()?;
        Self::configure(&conn)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn configure(conn: &Connection) -> Result<(), GraphError> {
        // WAL is best-effort — in-memory databases reject the pragma.
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(())
    }

    fn migrate(&self) -> Result<(), GraphError> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                body TEXT NOT NULL,
                tags TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
            CREATE INDEX IF NOT EXISTS idx_nodes_created ON nodes(created_at_ms);

            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                src TEXT NOT NULL,
                dst TEXT NOT NULL,
                kind TEXT NOT NULL,
                weight REAL NOT NULL,
                created_at_ms INTEGER NOT NULL,
                metadata TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
            CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
            CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
            ",
        )?;
        Ok(())
    }

    pub fn insert_node(&self, node: &Node) -> Result<(), GraphError> {
        let body = serde_json::to_string(&node.body)?;
        let tags = serde_json::to_string(&node.tags)?;
        self.conn.execute(
            "INSERT INTO nodes (id, kind, created_at_ms, body, tags) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![node.id, node.kind, node.created_at_ms as i64, body, tags,],
        )?;
        Ok(())
    }

    pub fn insert_edge(&self, edge: &Edge) -> Result<(), GraphError> {
        let metadata = serde_json::to_string(&edge.metadata)?;
        self.conn.execute(
            "INSERT INTO edges (id, src, dst, kind, weight, created_at_ms, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                edge.id,
                edge.src,
                edge.dst,
                edge.kind,
                edge.weight as f64,
                edge.created_at_ms as i64,
                metadata,
            ],
        )?;
        Ok(())
    }

    /// Hard-delete a node and EVERY edge incident to it (as `src` or `dst`). A true
    /// erasure — distinct from the bi-temporal invalidation used elsewhere — for
    /// privacy purges, where a sensitive node must leave no trace. Edges are removed
    /// first so no dangling edge survives. Returns whether a node row was deleted.
    pub fn remove_node(&self, id: &str) -> Result<bool, GraphError> {
        self.conn
            .execute("DELETE FROM edges WHERE src = ?1 OR dst = ?1", params![id])?;
        let removed = self
            .conn
            .execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
        Ok(removed > 0)
    }

    pub fn get_node(&self, id: &str) -> Result<Option<Node>, GraphError> {
        self.conn
            .query_row(
                "SELECT id, kind, created_at_ms, body, tags FROM nodes WHERE id = ?1",
                params![id],
                row_to_node,
            )
            .optional()
            .map_err(GraphError::from)
    }

    pub fn out_edges(&self, id: &str, kind: Option<&str>) -> Result<Vec<Edge>, GraphError> {
        match kind {
            Some(k) => self.query_edges(
                "SELECT id, src, dst, kind, weight, created_at_ms, metadata FROM edges WHERE src = ?1 AND kind = ?2 ORDER BY created_at_ms ASC",
                params![id, k],
            ),
            None => self.query_edges(
                "SELECT id, src, dst, kind, weight, created_at_ms, metadata FROM edges WHERE src = ?1 ORDER BY created_at_ms ASC",
                params![id],
            ),
        }
    }

    pub fn in_edges(&self, id: &str, kind: Option<&str>) -> Result<Vec<Edge>, GraphError> {
        match kind {
            Some(k) => self.query_edges(
                "SELECT id, src, dst, kind, weight, created_at_ms, metadata FROM edges WHERE dst = ?1 AND kind = ?2 ORDER BY created_at_ms ASC",
                params![id, k],
            ),
            None => self.query_edges(
                "SELECT id, src, dst, kind, weight, created_at_ms, metadata FROM edges WHERE dst = ?1 ORDER BY created_at_ms ASC",
                params![id],
            ),
        }
    }

    pub fn nodes_by_kind(&self, kind: &str, limit: usize) -> Result<Vec<Node>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, created_at_ms, body, tags FROM nodes WHERE kind = ?1 ORDER BY created_at_ms DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![kind, limit as i64], row_to_node)?;
        collect_nodes(rows)
    }

    pub fn nodes_in_range(&self, since_ms: u64, until_ms: u64) -> Result<Vec<Node>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, created_at_ms, body, tags FROM nodes WHERE created_at_ms >= ?1 AND created_at_ms <= ?2 ORDER BY created_at_ms ASC",
        )?;
        let rows = stmt.query_map(params![since_ms as i64, until_ms as i64], row_to_node)?;
        collect_nodes(rows)
    }

    pub fn search_body(&self, query: &str, limit: usize) -> Result<Vec<Node>, GraphError> {
        let needle = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, created_at_ms, body, tags FROM nodes WHERE body LIKE ?1 ESCAPE '\\' ORDER BY created_at_ms DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![needle, limit as i64], row_to_node)?;
        collect_nodes(rows)
    }

    pub fn most_recent_session(&self) -> Result<Option<Node>, GraphError> {
        self.conn
            .query_row(
                "SELECT id, kind, created_at_ms, body, tags FROM nodes WHERE kind = 'session' ORDER BY created_at_ms DESC LIMIT 1",
                [],
                row_to_node,
            )
            .optional()
            .map_err(GraphError::from)
    }

    pub fn update_node_body(&self, id: &str, body: &serde_json::Value) -> Result<(), GraphError> {
        let body = serde_json::to_string(body)?;
        self.conn.execute(
            "UPDATE nodes SET body = ?1 WHERE id = ?2",
            params![body, id],
        )?;
        Ok(())
    }

    pub fn update_edge_metadata(
        &self,
        id: &str,
        metadata: &serde_json::Value,
    ) -> Result<(), GraphError> {
        let metadata = serde_json::to_string(metadata)?;
        self.conn.execute(
            "UPDATE edges SET metadata = ?1 WHERE id = ?2",
            params![metadata, id],
        )?;
        Ok(())
    }

    pub fn count_nodes(&self) -> Result<usize, GraphError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))?;
        Ok(count.max(0) as usize)
    }

    pub fn count_edges(&self) -> Result<usize, GraphError> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;
        Ok(count.max(0) as usize)
    }

    pub fn count_sessions(&self) -> Result<usize, GraphError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE kind = 'session'",
            [],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as usize)
    }

    pub fn last_activity_ms(&self) -> Result<u64, GraphError> {
        let value: Option<i64> = self
            .conn
            .query_row("SELECT MAX(created_at_ms) FROM nodes", [], |row| row.get(0))
            .optional()?
            .flatten();
        Ok(value.unwrap_or(0).max(0) as u64)
    }

    pub fn all_nodes(&self) -> Result<Vec<Node>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, created_at_ms, body, tags FROM nodes ORDER BY created_at_ms ASC",
        )?;
        let rows = stmt.query_map([], row_to_node)?;
        collect_nodes(rows)
    }

    pub fn all_edges(&self) -> Result<Vec<Edge>, GraphError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, src, dst, kind, weight, created_at_ms, metadata FROM edges ORDER BY created_at_ms ASC",
        )?;
        let rows = stmt.query_map([], row_to_edge)?;
        collect_edges(rows)
    }

    fn query_edges(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
    ) -> Result<Vec<Edge>, GraphError> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(params, row_to_edge)?;
        collect_edges(rows)
    }
}

fn row_to_node(row: &rusqlite::Row<'_>) -> rusqlite::Result<Node> {
    let id: String = row.get(0)?;
    let kind: String = row.get(1)?;
    let created_at_ms: i64 = row.get(2)?;
    let body_text: String = row.get(3)?;
    let tags_text: String = row.get(4)?;
    let body = serde_json::from_str(&body_text).unwrap_or(serde_json::Value::Null);
    let tags: Vec<String> = serde_json::from_str(&tags_text).unwrap_or_default();
    Ok(Node {
        id,
        kind,
        created_at_ms: created_at_ms.max(0) as u64,
        body,
        tags,
    })
}

fn row_to_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<Edge> {
    let id: String = row.get(0)?;
    let src: String = row.get(1)?;
    let dst: String = row.get(2)?;
    let kind: String = row.get(3)?;
    let weight: f64 = row.get(4)?;
    let created_at_ms: i64 = row.get(5)?;
    let metadata_text: String = row.get(6)?;
    let metadata = serde_json::from_str(&metadata_text).unwrap_or(serde_json::Value::Null);
    Ok(Edge {
        id,
        src,
        dst,
        kind,
        weight: weight as f32,
        created_at_ms: created_at_ms.max(0) as u64,
        metadata,
    })
}

fn collect_nodes(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<Node>>,
) -> Result<Vec<Node>, GraphError> {
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn collect_edges(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<Edge>>,
) -> Result<Vec<Edge>, GraphError> {
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}
