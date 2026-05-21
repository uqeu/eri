//! `eri/mcp/*` JSON-RPC handlers.
//!
//! Holds one `Mcp` host per workspace inside `Services`. The host owns the
//! background reconnect supervisors, so the IDE only has to issue
//! `eri/mcp/connect` once per workspace and then call `tools` / `call`
//! repeatedly; the host keeps itself current.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use eri_mcp::{ContentBlock, Mcp, ToolHandle, ToolResult};

use crate::services::Services;
use crate::DispatchError;

type McpSlot = Arc<Mutex<Option<Mcp>>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceOnly {
    workspace: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallParams {
    workspace: PathBuf,
    server: String,
    tool: String,
    #[serde(default)]
    args: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerStatusOut {
    name: String,
    state: String,
    last_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResult {
    servers: Vec<ServerStatusOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolOut {
    server: String,
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolsResult {
    tools: Vec<ToolOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceOut {
    server: String,
    uri: String,
    name: String,
    description: String,
    mime_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourcesResult {
    resources: Vec<ResourceOut>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolCallResultOut {
    content: Vec<Value>,
    is_error: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownResult {
    ok: bool,
}

pub async fn connect(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let slot = ensure_loaded(services, &p.workspace).await?;
    let statuses = {
        let guard = slot.lock().await;
        match guard.as_ref() {
            Some(mcp) => mcp.servers().await,
            None => Vec::new(),
        }
    };
    let servers: Vec<ServerStatusOut> = statuses
        .into_iter()
        .map(|s| ServerStatusOut {
            name: s.name,
            state: s.state.to_string(),
            last_error: s.last_error,
        })
        .collect();
    serde_json::to_value(ConnectResult { servers })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn tools(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let slot = ensure_loaded(services, &p.workspace).await?;
    let tools: Vec<ToolHandle> = {
        let guard = slot.lock().await;
        match guard.as_ref() {
            Some(mcp) => mcp.tools().await,
            None => Vec::new(),
        }
    };
    let out: Vec<ToolOut> = tools
        .into_iter()
        .map(|t| ToolOut {
            server: t.server,
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
        })
        .collect();
    serde_json::to_value(ToolsResult { tools: out })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn resources(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let slot = ensure_loaded(services, &p.workspace).await?;
    let resources = {
        let guard = slot.lock().await;
        match guard.as_ref() {
            Some(mcp) => mcp.resources().await,
            None => Vec::new(),
        }
    };
    let out: Vec<ResourceOut> = resources
        .into_iter()
        .map(|r| ResourceOut {
            server: r.server,
            uri: r.uri,
            name: r.name,
            description: r.description,
            mime_type: r.mime_type,
        })
        .collect();
    serde_json::to_value(ResourcesResult { resources: out })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn call(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: CallParams =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let slot = ensure_loaded(services, &p.workspace).await?;
    // Find a `ToolHandle` matching server+tool from the live catalog so we
    // pass through the server-advertised input schema unchanged.
    let handle = {
        let guard = slot.lock().await;
        let mcp = guard
            .as_ref()
            .ok_or_else(|| DispatchError::Other(anyhow::anyhow!("MCP not loaded")))?;
        mcp.tools()
            .await
            .into_iter()
            .find(|t| t.server == p.server && t.name == p.tool)
            .ok_or_else(|| {
                DispatchError::BadParams(format!(
                    "unknown tool {}::{}",
                    p.server, p.tool
                ))
            })?
    };
    let result: ToolResult = {
        let guard = slot.lock().await;
        let mcp = guard
            .as_ref()
            .ok_or_else(|| DispatchError::Other(anyhow::anyhow!("MCP not loaded")))?;
        mcp.call_tool(&handle, p.args)
            .await
            .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?
    };
    let content: Vec<Value> = result
        .content
        .into_iter()
        .map(content_block_to_value)
        .collect();
    serde_json::to_value(ToolCallResultOut {
        content,
        is_error: result.is_error,
    })
        .map_err(|e| DispatchError::Other(e.into()))
}

pub async fn shutdown(params: Value, services: &Services) -> Result<Value, DispatchError> {
    let p: WorkspaceOnly =
        serde_json::from_value(params).map_err(|e| DispatchError::BadParams(e.to_string()))?;
    let slot = {
        let mut map = services.mcps.lock().await;
        map.remove(&p.workspace)
    };
    if let Some(slot) = slot {
        let taken = {
            let mut guard = slot.lock().await;
            guard.take()
        };
        if let Some(mcp) = taken {
            mcp.shutdown()
                .await
                .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
        }
    }
    serde_json::to_value(ShutdownResult { ok: true })
        .map_err(|e| DispatchError::Other(e.into()))
}

async fn ensure_loaded(services: &Services, workspace: &PathBuf) -> Result<McpSlot, DispatchError> {
    {
        let map = services.mcps.lock().await;
        if let Some(existing) = map.get(workspace) {
            return Ok(existing.clone());
        }
    }
    let mcp = Mcp::load(workspace)
        .await
        .map_err(|e| DispatchError::Other(anyhow::anyhow!(e.to_string())))?;
    let slot: McpSlot = Arc::new(Mutex::new(Some(mcp)));
    let mut map = services.mcps.lock().await;
    let entry = map.entry(workspace.clone()).or_insert_with(|| slot.clone());
    Ok(entry.clone())
}

fn content_block_to_value(block: ContentBlock) -> Value {
    serde_json::to_value(block).unwrap_or(Value::Null)
}
