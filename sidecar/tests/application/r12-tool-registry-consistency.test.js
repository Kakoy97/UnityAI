"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
} = require("../../src/ports/contracts");

function createOfflineServer() {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";
  server.getCapabilitySnapshot = async () => ({
    unity_connection_state: "offline",
    capability_version: "",
    actions: [],
    action_hints: [],
    token_budget: {
      tools_list_max_action_hints: 12,
      tools_list_max_description_chars: 900,
      tools_list_truncated: false,
    },
  });
  return server;
}

test("R12-L2-03 tools/list capability consistency gate matches visibility policy formula", async () => {
  const server = createOfflineServer();
  const registry = getMcpCommandRegistry();
  const tools = await server.getToolDefinitions();
  const names = tools.map((item) => item.name).sort();
  const exposed = new Set(
    typeof registry.listExposedMcpToolNames === "function"
      ? registry.listExposedMcpToolNames()
      : registry.listMcpToolNames()
  );
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
  const expectedVisible = [...exposed]
    .filter((name) => (allowlist.size === 0 ? true : allowlist.has(name)))
    .filter((name) => !disabled.has(name))
    .filter((name) => !deprecated.has(name))
    .sort();
  assert.deepEqual(names, expectedVisible);

  for (const name of names) {
    assert.ok(
      registry.getCommandByName(name),
      `tool '${name}' missing command registry definition`
    );
    if (allowlist.size > 0) {
      assert.equal(
        allowlist.has(name),
        true,
        `visible tool '${name}' must be in security_allowlist`
      );
    }
  }

  for (const name of disabled) {
    assert.equal(
      names.includes(name),
      false,
      `disabled tool '${name}' must not appear in tools/list`
    );
  }
});

test("R12-L2-03 mcpServer keeps registry dispatch path and no tool-name switch fallback", () => {
  const filePath = path.resolve(__dirname, "../../src/mcp/mcpServer.js");
  const source = fs.readFileSync(filePath, "utf8");
  assert.equal(
    source.includes("dispatchMcpTool("),
    true,
    "mcpServer must dispatch tools through command registry"
  );
  assert.equal(
    source.includes("switch (name)"),
    false,
    "mcpServer must not reintroduce manual tool-name switch branches"
  );
});
