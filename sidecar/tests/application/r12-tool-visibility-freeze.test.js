"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { UnityMcpServer } = require("../../src/mcp/mcpServer");

function createOfflineCapabilitySnapshot() {
  return {
    unity_connection_state: "offline",
    action_hints: [],
    actions: [],
    token_budget: {
      tools_list_max_action_hints: 12,
      tools_list_max_description_chars: 900,
      tools_list_truncated: false,
    },
  };
}

test("R12-L2-02 tools/list applies visibility policy formula (exposed ∩ allowlist - disabled)", async () => {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";
  server.getCapabilitySnapshot = async () => createOfflineCapabilitySnapshot();
  server.commandRegistry = {
    getToolsListCache: () => [
      {
        name: "capture_scene_screenshot",
        description: "allowed tool",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "internal_debug_capture",
        description: "must not leak to tools/list",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "hit_test_ui_at_screen_point",
        description: "disabled tool should not be visible",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };

  const tools = await server.getToolDefinitions();
  assert.deepEqual(
    tools.map((item) => item.name),
    ["capture_scene_screenshot"]
  );
});

test("R12-L2-02 callTool enforces visibility policy for allowlist and disabled tools", async () => {
  const server = Object.create(UnityMcpServer.prototype);
  const calls = [];
  server.commandRegistry = {
    listExposedMcpToolNames: () => [
      "capture_scene_screenshot",
      "hit_test_ui_at_screen_point",
      "internal_debug_capture",
    ],
    dispatchMcpTool: async (params) => {
      calls.push(params && params.name);
      return {
        content: [{ type: "text", text: "{}" }],
      };
    },
  };

  const allowed = await server.callTool({
    name: "capture_scene_screenshot",
    arguments: {},
  });
  assert.equal(Array.isArray(allowed.content), true);

  await assert.rejects(
    () =>
      server.callTool({
        name: "internal_debug_capture",
        arguments: {},
      }),
    /Tool not enabled by visibility policy/
  );
  await assert.rejects(
    () =>
      server.callTool({
        name: "hit_test_ui_at_screen_point",
        arguments: {},
      }),
    /Tool not enabled by visibility policy/
  );
  assert.deepEqual(calls, ["capture_scene_screenshot"]);
});
