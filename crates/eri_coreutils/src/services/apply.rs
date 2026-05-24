//! `eri/apply/*` JSON-RPC handlers.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use eri_apply::{ApplyKind, ApplyReport, Edit, FailureReason};

use crate::DispatchError;
use crate::services::Services;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParseParams {
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunParams {
    root: PathBuf,
    #[serde(default)]
    edits: Vec<EditInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParseAndRunParams {
    root: PathBuf,
    text: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditInput {
    path: PathBuf,
    search: String,
    replace: String,
}

impl From<EditInput> for Edit {
    fn from(e: EditInput) -> Self {
        Edit {
            path: e.path,
            search: e.search,
            replace: e.replace,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditOut {
    path: String,
    search: String,
    replace: String,
}

impl From<Edit> for EditOut {
    fn from(e: Edit) -> Self {
        Self {
            path: e.path.to_string_lossy().into_owned(),
            search: e.search,
            replace: e.replace,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseResult {
    edits: Vec<EditOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppliedOut {
    path: String,
    bytes_before: usize,
    bytes_after: usize,
    kind: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FailedOut {
    path: String,
    reason: String,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunResult {
    applied: Vec<AppliedOut>,
    failed: Vec<FailedOut>,
}

pub async fn parse(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: ParseParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let edits: Vec<EditOut> = eri_apply::parse(&p.text)
        .into_iter()
        .map(Into::into)
        .collect();
    serde_json::to_value(ParseResult { edits }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn run(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: RunParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let edits: Vec<Edit> = p.edits.into_iter().map(Edit::from).collect();
    let report = eri_apply::apply(&edits, &p.root);
    serialize_report(report)
}

pub async fn parse_and_run(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: ParseAndRunParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let edits = eri_apply::parse(&p.text);
    let report = eri_apply::apply(&edits, &p.root);
    serialize_report(report)
}

fn serialize_report(report: ApplyReport) -> Result<Value, DispatchError> {
    let applied: Vec<AppliedOut> = report
        .applied
        .into_iter()
        .map(|a| AppliedOut {
            path: a.path.to_string_lossy().into_owned(),
            bytes_before: a.bytes_before,
            bytes_after: a.bytes_after,
            kind: kind_str(&a.kind),
        })
        .collect();
    let failed: Vec<FailedOut> = report
        .failed
        .into_iter()
        .map(|f| {
            let (reason, detail) = reason_parts(&f.reason);
            FailedOut {
                path: f.path.to_string_lossy().into_owned(),
                reason: reason.to_string(),
                detail,
            }
        })
        .collect();
    serde_json::to_value(RunResult { applied, failed }).map_err(|e| DispatchError::Other(e.into()))
}

fn kind_str(kind: &ApplyKind) -> &'static str {
    match kind {
        ApplyKind::Created => "created",
        ApplyKind::Modified => "modified",
        ApplyKind::Deleted => "deleted",
        ApplyKind::Replaced => "replaced",
    }
}

fn reason_parts(reason: &FailureReason) -> (&'static str, Option<String>) {
    match reason {
        FailureReason::SearchNotFound => ("searchNotFound", None),
        FailureReason::AmbiguousMatch => ("ambiguousMatch", None),
        FailureReason::IoError(msg) => ("ioError", Some(msg.clone())),
        FailureReason::PathOutsideRoot => ("pathOutsideRoot", None),
    }
}
