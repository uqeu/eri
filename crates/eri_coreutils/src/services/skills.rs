//! `eri/skills/*` JSON-RPC handlers.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use eri_skills::Skills;

use crate::DispatchError;
use crate::services::Services;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListParams {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadParams {
    workspace: PathBuf,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillEntry {
    name: String,
    description: String,
    when: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResult {
    skills: Vec<SkillEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadResult {
    name: String,
    body: String,
}

pub async fn list(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: ListParams = parse_params(params)?;
    if p.workspace.as_os_str().is_empty() {
        return Err(DispatchError::BadParams("workspace is required".into()));
    }
    let skills = Skills::load(&p.workspace).map_err(DispatchError::Other)?;
    let entries: Vec<SkillEntry> = skills
        .list()
        .iter()
        .map(|s| SkillEntry {
            name: s.name().to_string(),
            description: s.description().to_string(),
            when: s.keywords().to_vec(),
        })
        .collect();
    serde_json::to_value(ListResult { skills: entries }).map_err(|e| DispatchError::Other(e.into()))
}

pub async fn load(params: Value, _services: &Services) -> Result<Value, DispatchError> {
    let p: LoadParams = parse_params(params)?;
    if p.workspace.as_os_str().is_empty() {
        return Err(DispatchError::BadParams("workspace is required".into()));
    }
    if p.name.is_empty() {
        return Err(DispatchError::BadParams("name is required".into()));
    }
    let skills = Skills::load(&p.workspace).map_err(DispatchError::Other)?;
    let skill = skills
        .get(&p.name)
        .ok_or_else(|| DispatchError::BadParams(format!("unknown skill: {}", p.name)))?;
    serde_json::to_value(LoadResult {
        name: skill.name().to_string(),
        body: skill.body().to_string(),
    })
    .map_err(|e| DispatchError::Other(e.into()))
}

fn parse_params<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, DispatchError> {
    serde_json::from_value(value).map_err(|e| DispatchError::BadParams(e.to_string()))
}
