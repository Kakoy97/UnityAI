"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

async function dispatchBodyCommand(registry, path, body, turnService) {
  return registry.dispatchHttpCommand({
    method: "POST",
    path,
    url: new URL(`http://127.0.0.1:46321${path}`),
    req: {},
    readJsonBody: async () => body,
    turnService,
  });
}

function createMockTurnService() {
  return {
    capabilityStore: {
      getActionSchema() {
        return {
          ok: true,
          action_type: "rename_object",
          action: {
            type: "rename_object",
            anchor_policy: "target_required",
            action_data_schema: {
              type: "object",
              required: ["name"],
            },
          },
          schema_hint: {
            type: "object",
            required: ["name"],
          },
        };
      },
      getSnapshot() {
        return {
          capability_version: "sha256:capability_mock_v1",
          unity_connection_state: "ready",
        };
      },
    },
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };
}

test("get_write_contract_bundle returns aggregated contract payload", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "apply_visual_actions",
      action_type: "rename_object",
      budget_chars: 3600,
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "apply_visual_actions");
  assert.equal(outcome.body.action_type, "rename_object");
  assert.ok(outcome.body.write_envelope_contract);
  assert.ok(outcome.body.minimal_valid_payload_template);
  assert.ok(Array.isArray(outcome.body.trim_priority));
  assert.equal(outcome.body.action_schema_ref.tool, "get_action_schema");
  assert.equal(outcome.body.tool_schema_ref.tool, "get_tool_schema");
});

test("get_write_contract_bundle returns tool not found for unknown tool", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "unknown_write_tool",
      action_type: "rename_object",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.ok, false);
  assert.equal(outcome.body.error_code, "E_TOOL_SCHEMA_NOT_FOUND");
  assert.equal(outcome.body.recoverable, true);
});

test("get_write_contract_bundle enforces bundle budget and reports truncation flag", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "apply_visual_actions",
      action_type: "rename_object",
      budget_chars: 800,
      include_error_fix_map: true,
      include_canonical_examples: true,
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(typeof outcome.body.budget_truncated, "boolean");
  assert.equal(
    Number.isFinite(Number(outcome.body.bundle_chars)),
    true
  );
  assert.ok(
    Number(outcome.body.bundle_chars) <= Number(outcome.body.bundle_budget_chars)
  );
});

