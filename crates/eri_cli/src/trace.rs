//! Run observability -- an optional JSONL trace of what the agent did.
//!
//! When `ERI_TRACE_FILE` is set (or a path is passed explicitly), the build loop
//! appends one JSON object per line for each notable event: run start, every
//! tool call (name, outcome, duration), and run end (turns, tokens, files). This
//! is the pragmatic, dependency-free form of observability -- a CI job or a
//! debugging session can read the stream without an OpenTelemetry collector, and
//! the same records can be shipped to one later.
//!
//! Tracing is best-effort: a tracer that can't open its file silently disables
//! itself rather than failing a build. Records never contain prompt or response
//! content -- only tool names, counts, timings, and token totals -- consistent
//! with eri's no-content-stored privacy rule.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use serde_json::{Value, json};

/// Append-only JSONL trace sink. Cheap when disabled (the common case).
pub struct Tracer {
    sink: Option<Mutex<File>>,
}

impl Tracer {
    /// A disabled tracer -- every `event` is a no-op.
    pub fn disabled() -> Self {
        Self { sink: None }
    }

    /// Build a tracer from the `ERI_TRACE_FILE` env var. Unset/empty -> disabled.
    pub fn from_env() -> Self {
        match std::env::var("ERI_TRACE_FILE") {
            Ok(p) if !p.trim().is_empty() => Self::to_file(Path::new(p.trim())),
            _ => Self::disabled(),
        }
    }

    /// Build a tracer writing JSONL to `path` (append). A failure to open
    /// degrades to disabled -- observability must never break a build.
    pub fn to_file(path: &Path) -> Self {
        match OpenOptions::new().create(true).append(true).open(path) {
            Ok(f) => Self {
                sink: Some(Mutex::new(f)),
            },
            Err(_) => Self::disabled(),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.sink.is_some()
    }

    /// Append one event: `{ "ts_ms": .., "event": kind, ...fields }`. The caller
    /// passes a monotonic-ish `ts_ms` (the loop has elapsed-time handy) so this
    /// stays pure of clock calls. Best-effort: write errors are swallowed.
    pub fn event(&self, ts_ms: u128, kind: &str, mut fields: Value) {
        let Some(sink) = &self.sink else {
            return;
        };
        if !fields.is_object() {
            fields = json!({});
        }
        let obj = fields.as_object_mut().expect("ensured object above");
        obj.insert("ts_ms".into(), json!(ts_ms));
        obj.insert("event".into(), json!(kind));
        let line = Value::Object(obj.clone()).to_string();
        if let Ok(mut f) = sink.lock() {
            let _ = writeln!(f, "{line}");
            let _ = f.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn lines(path: &Path) -> Vec<Value> {
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).expect("each line is valid JSON"))
            .collect()
    }

    #[test]
    fn disabled_tracer_is_a_noop() {
        let t = Tracer::disabled();
        assert!(!t.is_enabled());
        // Must not panic or write anywhere.
        t.event(0, "tool", json!({ "name": "grep" }));
    }

    #[test]
    fn writes_jsonl_events_with_ts_and_kind() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("trace.jsonl");
        let t = Tracer::to_file(&path);
        assert!(t.is_enabled());
        t.event(10, "run_start", json!({ "model": "m" }));
        t.event(25, "tool", json!({ "name": "write_file", "ok": true }));
        t.event(40, "run_end", json!({ "turns": 2, "tokens_out": 99 }));

        let evs = lines(&path);
        assert_eq!(evs.len(), 3);
        assert_eq!(evs[0]["event"], "run_start");
        assert_eq!(evs[0]["ts_ms"], 10);
        assert_eq!(evs[0]["model"], "m");
        assert_eq!(evs[1]["event"], "tool");
        assert_eq!(evs[1]["name"], "write_file");
        assert_eq!(evs[1]["ok"], true);
        assert_eq!(evs[2]["turns"], 2);
        assert_eq!(evs[2]["tokens_out"], 99);
    }

    #[test]
    fn appends_across_tracers_same_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("t.jsonl");
        Tracer::to_file(&path).event(1, "a", json!({}));
        // A second tracer on the same path appends, not truncates.
        Tracer::to_file(&path).event(2, "b", json!({}));
        let evs = lines(&path);
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0]["event"], "a");
        assert_eq!(evs[1]["event"], "b");
    }

    #[test]
    fn non_object_fields_are_tolerated() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("t.jsonl");
        let t = Tracer::to_file(&path);
        t.event(5, "bare", json!("not an object"));
        let evs = lines(&path);
        assert_eq!(evs[0]["event"], "bare");
        assert_eq!(evs[0]["ts_ms"], 5);
    }
}
