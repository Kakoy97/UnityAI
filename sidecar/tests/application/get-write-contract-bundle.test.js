"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  getWriteContractBundleView,
} = require("../../src/application/ssotRuntime/staticContractViews");

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
    nowIso: () => "2026-03-03T00:00:00.000Z",
    getWriteContractBundleForMcp(payload) {
      return getWriteContractBundleView(payload);
    },
  };
}

test("get_write_contract_bundle returns static contract payload for SSOT write tool", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "modify_ui_layout",
      action_type: "rename_object",
      budget_chars: 3600,
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "modify_ui_layout");
  assert.equal(outcome.body.action_type, "rename_object");
  assert.equal(outcome.body.schema_source, "ssot_static_artifact");
  assert.ok(outcome.body.write_envelope_contract);
  assert.equal(outcome.body.write_envelope_contract.mode, "static");
  assert.ok(outcome.body.minimal_valid_payload_template);
  assert.equal(outcome.body.schema_ref.tool, "get_tool_schema");
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
  assert.equal(typeof outcome.body.guidance, "string");
});

test("get_write_contract_bundle rejects read tool in static mode", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "get_current_selection",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.ok, false);
  assert.equal(outcome.body.error_code, "E_SSOT_WRITE_TOOL_REQUIRED");
});
