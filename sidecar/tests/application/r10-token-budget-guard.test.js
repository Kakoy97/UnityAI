"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CapabilityStore,
  TOOLS_LIST_MAX_ACTION_HINTS,
  TOOLS_LIST_MAX_DESCRIPTION_CHARS,
  SCHEMA_HINT_MAX_CHARS,
} = require("../../src/application/capabilityStore");
const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

function makeLongText(seed, length) {
  const unit = `${seed}_`;
  let text = "";
  while (text.length < length) {
    text += unit;
  }
  return text.slice(0, length);
}

test("R10-ARCH-05 capability snapshot applies tools/list token budget guard", () => {
  const store = new CapabilityStore({
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });
  const actions = [];
  for (let i = 0; i < 50; i += 1) {
    actions.push({
      type: `action_${String(i).padStart(2, "0")}`,
      description: makeLongText(`desc_${i}`, 180),
      anchor_policy: "target_required",
      action_data_schema: {
        type: "object",
      },
    });
  }

  store.reportCapabilities({
    capability_version: "sha256:budget_tools_v1",
    actions,
  });

  const snapshot = store.getSnapshot();
  assert.equal(Array.isArray(snapshot.action_hints), true);
  assert.equal(snapshot.action_hints.length <= TOOLS_LIST_MAX_ACTION_HINTS, true);

  const hintChars = snapshot.action_hints.reduce((sum, item) => {
    const summary = item && typeof item.summary === "string" ? item.summary : "";
    return sum + summary.length;
  }, 0);
  assert.equal(hintChars <= TOOLS_LIST_MAX_DESCRIPTION_CHARS, true);
  assert.equal(snapshot.token_budget.tools_list_truncated, true);
  assert.equal(snapshot.token_budget.tools_list_truncated_total > 0, true);
});

test("R10-ARCH-05 action schema response applies schema_hint budget guard", () => {
  const store = new CapabilityStore({
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });
  const bigProperties = {};
  for (let i = 0; i < 120; i += 1) {
    bigProperties[`field_${String(i).padStart(3, "0")}`] = {
      type: "string",
      description: makeLongText(`field_desc_${i}`, 120),
      enum: [
        "VALUE_A",
        "VALUE_B",
        "VALUE_C",
        "VALUE_D",
      ],
    };
  }

  store.reportCapabilities({
    capability_version: "sha256:budget_schema_v1",
    actions: [
      {
        type: "big_schema_action",
        description: "big schema",
        anchor_policy: "target_required",
        action_data_schema: {
          type: "object",
          required: Object.keys(bigProperties).slice(0, 60),
          properties: bigProperties,
        },
      },
    ],
  });

  const schema = store.getActionSchema("big_schema_action");
  assert.equal(schema.ok, true);
  assert.equal(typeof schema.schema_hint, "object");
  assert.equal(schema.schema_hint_chars <= SCHEMA_HINT_MAX_CHARS, true);
  assert.equal(schema.schema_hint_truncated, true);
  assert.equal(schema.token_budget.schema_hint_truncated_total > 0, true);
});

test("R10-ARCH-05 MCP tools/list hint text stays token-budget aware", () => {
  const server = Object.create(UnityMcpServer.prototype);
  const actions = [];
  for (let i = 0; i < 40; i += 1) {
    actions.push({
      type: `action_${i}`,
      description: makeLongText(`desc_${i}`, 120),
      anchor_policy: "target_required",
    });
  }

  const hint = server.buildVisualActionHint({
    unity_connection_state: "ready",
    action_hints: actions.map((item) => ({
      type: item.type,
      summary: item.description,
    })),
    token_budget: {
      tools_list_max_action_hints: TOOLS_LIST_MAX_ACTION_HINTS,
      tools_list_max_description_chars: TOOLS_LIST_MAX_DESCRIPTION_CHARS,
      tools_list_truncated: true,
    },
  });

  assert.equal(typeof hint, "string");
  assert.equal(hint.includes("Registered action types:"), true);
  assert.equal(
    hint.includes("truncated; use get_action_catalog/get_action_schema for full detail"),
    true
  );
});

test("R10-ARCH-05 tools/list uses compact write schema and description budget", async () => {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";
  server.getCapabilitySnapshot = async () => ({
    unity_connection_state: "ready",
    action_hints: [],
    actions: [],
    token_budget: {
      tools_list_max_action_hints: TOOLS_LIST_MAX_ACTION_HINTS,
      tools_list_max_description_chars: 120,
      tools_list_truncated: true,
    },
  });

  const definitions = await server.getToolDefinitions();
  const submit = definitions.find((item) => item.name === "submit_unity_task");
  assert.ok(submit);
  assert.equal(typeof submit.description, "string");
  assert.equal(submit.description.length <= 120, true);

  const registry = getMcpCommandRegistry();
  const full = registry.getToolMetadataByName("submit_unity_task", {});
  assert.ok(full);
  const compactChars = JSON.stringify(submit.inputSchema).length;
  const fullChars = JSON.stringify(full.input_schema).length;
  assert.equal(compactChars < fullChars, true);
});
