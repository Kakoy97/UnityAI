"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

function createRegistry() {
  return getMcpCommandRegistry();
}

async function dispatchBodyCommand(registry, path, body) {
  return registry.dispatchHttpCommand({
    method: "POST",
    path,
    url: new URL(`http://127.0.0.1:46321${path}`),
    req: {},
    readJsonBody: async () => body,
    turnService: {
      capabilityStore: {},
      queryCoordinator: {},
      unitySnapshotService: {},
      nowIso: () => "2026-03-03T00:00:00.000Z",
    },
  });
}

test("setup_cursor_mcp command supports dry-run setup flow", async () => {
  const registry = createRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/setup_cursor_mcp",
    {
      mode: "native",
      sidecar_base_url: "http://127.0.0.1:46321",
      dry_run: true,
    }
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(typeof outcome.body.data, "object");
  assert.equal(outcome.body.data.mode, "native");
  assert.equal(outcome.body.data.dry_run, true);
  assert.equal(typeof outcome.body.data.config_path, "string");
});

test("verify_mcp_setup command returns structured readiness report", async () => {
  const registry = createRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/verify_mcp_setup",
    {
      mode: "auto",
    }
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(typeof outcome.body.data, "object");
  assert.equal(typeof outcome.body.data.ready, "boolean");
  assert.equal(Array.isArray(outcome.body.data.checks), true);
});

test("setup_cursor_mcp command rejects invalid mode", async () => {
  const registry = createRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/setup_cursor_mcp",
    {
      mode: "auto",
    }
  );

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_SCHEMA_INVALID");
});
