import { strict as assert } from "node:assert";
import { isValidToolkit } from "../composio/accounts";
import { composioMcpUrl, normalizeStatus } from "../composio/client";
import { handleConnect, type ConnectDeps } from "../composio/connect";

async function run() {
  // isValidToolkit: strict slug allowlist.
  {
    assert.ok(isValidToolkit("gmail"));
    assert.ok(isValidToolkit("google_calendar"));
    assert.ok(isValidToolkit("github-issues"));
    assert.ok(!isValidToolkit("Gmail"), "uppercase rejected");
    assert.ok(!isValidToolkit("rm -rf"), "spaces/symbols rejected");
    assert.ok(!isValidToolkit(""), "empty rejected");
    assert.ok(!isValidToolkit(123), "non-string rejected");
    assert.ok(!isValidToolkit("a".repeat(65)), "over-long rejected");
  }

  // normalizeStatus maps Composio's strings onto eri's three states.
  {
    assert.equal(normalizeStatus("ACTIVE"), "active");
    assert.equal(normalizeStatus("connected"), "active");
    assert.equal(normalizeStatus("INITIATED"), "pending");
    assert.equal(normalizeStatus("pending"), "pending");
    assert.equal(normalizeStatus("FAILED"), "error");
    assert.equal(normalizeStatus(undefined), "error");
  }

  // composioMcpUrl builds a per-user, url-encoded MCP endpoint.
  {
    const url = composioMcpUrl("srv_123", "user/abc");
    assert.equal(url, "https://backend.composio.dev/v3/mcp/srv_123?user_id=user%2Fabc");
  }

  // handleConnect — happy path records pending + returns the redirect.
  {
    const recorded: unknown[] = [];
    const deps: ConnectDeps = {
      initiate: async () => ({ connectedAccountId: "ca_1", redirectUrl: "https://composio/oauth" }),
      record: async (input) => {
        recorded.push(input);
      },
    };
    const out = await handleConnect("u1", "gmail", deps);
    assert.equal(out.branch, "ok");
    assert.equal(out.redirectUrl, "https://composio/oauth");
    assert.deepEqual(recorded[0], {
      userId: "u1",
      toolkit: "gmail",
      connectedAccountId: "ca_1",
      status: "pending",
    });
  }

  // Invalid toolkit short-circuits before any external call.
  {
    let initiated = false;
    const deps: ConnectDeps = {
      initiate: async () => {
        initiated = true;
        return { connectedAccountId: "x", redirectUrl: "y" };
      },
      record: async () => {},
    };
    const out = await handleConnect("u1", "NOPE space", deps);
    assert.equal(out.branch, "invalid_toolkit");
    assert.equal(initiated, false, "no Composio call for an invalid toolkit");
  }

  // A Composio failure becomes composio_error, never an unhandled throw.
  {
    const deps: ConnectDeps = {
      initiate: async () => {
        throw new Error("composio 500");
      },
      record: async () => {},
    };
    const out = await handleConnect("u1", "gmail", deps);
    assert.equal(out.branch, "composio_error");
    assert.equal(out.redirectUrl, undefined);
  }

  // eslint-disable-next-line no-console
  console.log("composio.test.ts: all assertions passed");
}

run();
