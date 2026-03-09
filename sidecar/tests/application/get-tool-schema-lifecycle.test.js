"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  getToolSchemaView,
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
    nowIso: () => "2026-03-04T00:00:00.000Z",
    getToolSchemaForMcp(payload) {
      return getToolSchemaView(payload);
    },
  };
}

test("get_tool_schema returns static SSOT schema view for preflight tool", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    {
      tool_name: "preflight_validate_write_payload",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "preflight_validate_write_payload");
  assert.equal(outcome.body.lifecycle, "stable");
  assert.equal(outcome.body.schema_source, "ssot_static_artifact");
  assert.equal(Array.isArray(outcome.body.required_fields), true);
  assert.equal(outcome.body.required_fields.includes("tool_name"), true);
  assert.equal(outcome.body.required_fields.includes("payload"), true);
});

test("get_tool_schema exposes planner entry schema hints for minimal block request", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    {
      tool_name: "planner_execute_mcp",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "planner_execute_mcp");
  assert.equal(Array.isArray(outcome.body.input_schema.examples), true);
  assert.equal(outcome.body.input_schema.examples.length > 0, true);
  assert.equal(
    outcome.body.input_schema.examples[0].block_spec.block_type,
    "READ_STATE"
  );
  const blockSpec = outcome.body.input_schema.properties.block_spec;
  assert.equal(typeof blockSpec.description, "string");
  assert.equal(
    Array.isArray(blockSpec.properties.block_type.enum),
    true
  );
  assert.equal(
    blockSpec.properties.block_type.enum.includes("MUTATE"),
    true
  );
});

test("get_tool_schema returns not found for unknown tool", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    {
      tool_name: "unknown_ssot_tool",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.ok, false);
  assert.equal(outcome.body.error_code, "E_TOOL_SCHEMA_NOT_FOUND");
});
