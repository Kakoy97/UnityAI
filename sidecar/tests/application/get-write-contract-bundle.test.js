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
  assert.deepEqual(
    outcome.body.write_envelope_contract.required_sequence,
    [
      "get_current_selection",
      "apply_visual_actions",
      "get_unity_task_status_until_terminal(succeeded|failed|cancelled)",
    ]
  );
  assert.equal(outcome.body.write_envelope_contract.accepted_is_terminal, false);
  assert.deepEqual(
    outcome.body.write_envelope_contract.async_terminal_statuses,
    ["succeeded", "failed", "cancelled"]
  );
  assert.ok(Array.isArray(outcome.body.trim_priority));
  assert.equal(outcome.body.action_schema_ref.tool, "get_action_schema");
  assert.equal(outcome.body.tool_schema_ref.tool, "get_tool_schema");
  assert.equal(Array.isArray(outcome.body.action_anchor_decision_table), true);
  assert.equal(
    outcome.body.action_anchor_decision_table.some(
      (item) => item && item.action_type === "rename_object"
    ),
    true
  );
  assert.equal(Array.isArray(outcome.body.golden_path_templates), true);
  assert.equal(outcome.body.golden_path_templates.length >= 1, true);
  const renameTemplate = outcome.body.golden_path_templates.find(
    (item) => item && item.action_type === "rename_object"
  );
  assert.ok(renameTemplate);
  assert.ok(renameTemplate.action_template);
  assert.ok(renameTemplate.action_template.target_anchor);
  assert.equal(
    typeof renameTemplate.action_template.action_data.name === "string",
    true
  );
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
