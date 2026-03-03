"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");

const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
} = require("../../src/ports/contracts");

function buildServerForDefinitions() {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";
  server._capabilitySnapshotCache = null;
  server.getCapabilitySnapshot = async () => ({
    unity_connection_state: "offline",
    action_hints: [],
    actions: [],
    token_budget: {
      tools_list_max_action_hints: 12,
      tools_list_max_description_chars: 900,
      tools_list_truncated: false,
    },
  });
  return server;
}

function startPlainErrorServer(statusCode, bodyText) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      void req;
      res.statusCode = statusCode;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(bodyText);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

test("R11-ARCH-02 MCP command metadata snapshot remains stable", async () => {
  const server = buildServerForDefinitions();
  const tools = await server.getToolDefinitions();
  const names = tools.map((item) => item.name).sort();
  const allowlist = new Set(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.security_allowlist)
      ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.security_allowlist
      : []
  );
  const disabled = new Set(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools)
      ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools
      : []
  );
  const deprecated = new Set(
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
      : []
  );
  const expectedNames = [
    ...(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names || []),
  ]
    .filter((name) => (allowlist.size === 0 ? true : allowlist.has(name)))
    .filter((name) => !disabled.has(name))
    .filter((name) => !deprecated.has(name))
    .sort();
  assert.deepEqual(names, expectedNames);

  for (const tool of tools) {
    assert.deepEqual(Object.keys(tool).sort(), [
      "description",
      "inputSchema",
      "name",
    ]);
    assert.equal(typeof tool.description, "string");
    assert.equal(typeof tool.inputSchema, "object");
  }

  const requiredByTool = Object.fromEntries(
    tools
      .map((tool) => [
        tool.name,
        Array.isArray(tool.inputSchema && tool.inputSchema.required)
          ? [...tool.inputSchema.required].sort()
          : [],
      ])
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
  assert.deepEqual(requiredByTool, {
    apply_script_actions: ["actions", "based_on_read_token", "write_anchor"],
    apply_visual_actions: ["actions", "based_on_read_token", "write_anchor"],
    capture_scene_screenshot: [],
    cancel_unity_task: ["job_id"],
    find_objects_by_component: ["component_query"],
    get_action_catalog: [],
    get_action_schema: ["action_type"],
    get_current_selection: [],
    get_gameobject_components: [],
    get_hierarchy_subtree: [],
    get_tool_schema: ["tool_name"],
    get_write_contract_bundle: [],
    setup_cursor_mcp: [],
    verify_mcp_setup: [],
    hit_test_ui_at_viewport_point: ["x", "y"],
    get_ui_overlay_report: [],
    get_serialized_property_tree: ["target_anchor"],
    get_ui_tree: [],
    get_scene_roots: [],
    get_unity_task_status: ["job_id"],
    list_assets_in_folder: ["folder_path"],
    preflight_validate_write_payload: ["payload"],
    query_prefab_info: ["max_depth", "prefab_path"],
    set_serialized_property: [
      "based_on_read_token",
      "component_selector",
      "patches",
      "target_anchor",
      "write_anchor",
    ],
    set_ui_properties: ["based_on_read_token", "operations", "write_anchor"],
    submit_unity_task: [
      "based_on_read_token",
      "idempotency_key",
      "thread_id",
      "user_intent",
      "write_anchor",
    ],
    validate_ui_layout: [],
  });
});

test("R11-ARCH-02 command transport error envelope snapshot remains stable", async (t) => {
  const started = await startPlainErrorServer(503, "unity busy");
  t.after(
    () =>
      new Promise((resolve) => {
        started.server.close(() => resolve());
      })
  );

  const server = Object.create(UnityMcpServer.prototype);
  const response = await server.httpRequest(
    "POST",
    new URL(`${started.baseUrl}/mcp/get_action_catalog`),
    { domain: "ui" }
  );

  assert.deepEqual(Object.keys(response).sort(), [
    "error_code",
    "error_message",
    "message",
    "recoverable",
    "status",
    "suggestion",
  ]);
  assert.equal(response.status, "rejected");
  assert.equal(response.error_code, "E_HTTP_503");
  assert.equal(response.error_message, "unity busy");
  assert.equal(response.message, "unity busy");
  assert.equal(typeof response.suggestion, "string");
  assert.equal(response.recoverable, true);
});
