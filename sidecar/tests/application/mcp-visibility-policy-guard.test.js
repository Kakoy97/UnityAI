"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const {
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
} = require("../../src/ports/contracts");

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toToolSet(value) {
  const source = Array.isArray(value) ? value : [];
  return new Set(source.map((item) => normalizeToolName(item)).filter((item) => !!item));
}

function createServerWithRegistry(registry) {
  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;
  return server;
}

function createMockVisibilityContract(input) {
  const source = input && typeof input === "object" ? input : {};
  const freezeArray = (items) =>
    Object.freeze(
      (Array.isArray(items) ? items : [])
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    );
  return Object.freeze({
    visibility_formula: "visible = exposed & active - disabled",
    registry_snapshot_source: "McpCommandRegistry.listMcpToolNames()",
    active_tool_names: freezeArray(source.active_tool_names),
    deprecated_tool_names: freezeArray(source.deprecated_tool_names),
    removed_tool_names: freezeArray(source.removed_tool_names),
    exposed_tool_names: freezeArray(source.exposed_tool_names),
    local_static_tool_names: freezeArray(source.local_static_tool_names),
    disabled_tools: freezeArray(source.disabled_tools),
    disabled_tool_notes: Object.freeze({}),
  });
}

async function withMockedVisibilityContract(mockedContract, run) {
  const contractsPath = require.resolve("../../src/ports/contracts");
  const mcpServerPath = require.resolve("../../src/mcp/mcpServer");
  // Ensure module cache entries are materialized before swapping exports.
  require(contractsPath);

  const originalContractsExports = require.cache[contractsPath].exports;
  require.cache[contractsPath].exports = {
    ...originalContractsExports,
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT: mockedContract,
  };
  delete require.cache[mcpServerPath];

  try {
    const { UnityMcpServer: MockedUnityMcpServer } = require(mcpServerPath);
    await run(MockedUnityMcpServer);
  } finally {
    delete require.cache[mcpServerPath];
    require.cache[contractsPath].exports = originalContractsExports;
  }
}

test("visibility contract is artifact-driven and no longer exposes legacy allowlist fields", () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
      "security_allowlist"
    ),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
      "allowlist_source"
    ),
    false
  );
  assert.equal(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names),
    true
  );
  assert.equal(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names),
    true
  );
  assert.equal(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names),
    true
  );
  assert.equal(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names.length > 0,
    true
  );
  assert.equal(
    String(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.visibility_policy_path || "").endsWith(
      "visibility-policy.generated.json"
    ),
    true
  );
});

test("tools/list visibility is synchronized with active/deprecated/removed/disabled policy sets", async () => {
  const registry = getMcpCommandRegistry();
  const server = createServerWithRegistry(registry);
  const tools = await server.getToolDefinitions();
  const listedToolNameSet = new Set(
    tools.map((item) => normalizeToolName(item && item.name)).filter((item) => !!item)
  );

  const activeToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names
  );
  const deprecatedToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names
  );
  const removedToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names
  );
  const disabledToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools
  );

  for (const listedName of listedToolNameSet) {
    assert.equal(
      activeToolNameSet.has(listedName),
      true,
      `listed tool should be active: ${listedName}`
    );
    assert.equal(
      deprecatedToolNameSet.has(listedName),
      false,
      `listed tool should not be deprecated: ${listedName}`
    );
    assert.equal(
      removedToolNameSet.has(listedName),
      false,
      `listed tool should not be removed: ${listedName}`
    );
    assert.equal(
      disabledToolNameSet.has(listedName),
      false,
      `listed tool should not be disabled: ${listedName}`
    );
  }

  for (const activeToolName of activeToolNameSet) {
    if (disabledToolNameSet.has(activeToolName)) {
      continue;
    }
    assert.equal(
      listedToolNameSet.has(activeToolName),
      true,
      `active tool missing from tools/list: ${activeToolName}`
    );
  }
});

test("deprecated/removed tools are hidden from tools/list and blocked by tools/call", async () => {
  const registry = getMcpCommandRegistry();
  const server = createServerWithRegistry(registry);
  const tools = await server.getToolDefinitions();
  const listedToolNameSet = new Set(
    tools.map((item) => normalizeToolName(item && item.name)).filter((item) => !!item)
  );

  const blockedNames = Array.from(
    new Set([
      ...toToolSet(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names),
      ...toToolSet(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names),
    ])
  );
  assert.equal(blockedNames.length > 0, true, "blocked tool set should not be empty");

  for (const blockedName of blockedNames) {
    assert.equal(
      listedToolNameSet.has(blockedName),
      false,
      `blocked tool leaked into tools/list: ${blockedName}`
    );
    await assert.rejects(
      async () =>
        server.callTool({
          name: blockedName,
          arguments: {},
        }),
      new RegExp(`Tool removed in phase6: ${blockedName}`)
    );
  }
});

test("disabled tools are filtered from tools/list and rejected by tools/call", async () => {
  const mockedContract = createMockVisibilityContract({
    active_tool_names: ["alpha_tool", "beta_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["alpha_tool", "beta_tool", "gamma_tool"],
    local_static_tool_names: [],
    disabled_tools: ["beta_tool"],
  });

  await withMockedVisibilityContract(mockedContract, async (MockedUnityMcpServer) => {
    const calls = [];
    const fakeRegistry = {
      listExposedMcpToolNames() {
        return ["alpha_tool", "beta_tool", "gamma_tool"];
      },
      getToolsListCache() {
        return [
          { name: "alpha_tool", description: "a", inputSchema: {} },
          { name: "beta_tool", description: "b", inputSchema: {} },
          { name: "gamma_tool", description: "g", inputSchema: {} },
        ];
      },
      async dispatchMcpTool(params) {
        calls.push(params && params.name);
        return { ok: true, dispatched_tool: params && params.name };
      },
    };

    const server = Object.create(MockedUnityMcpServer.prototype);
    server.commandRegistry = fakeRegistry;

    const tools = await server.getToolDefinitions();
    const listedNames = tools.map((item) => String(item && item.name || "").trim());
    assert.deepEqual(listedNames, ["alpha_tool"]);

    await assert.rejects(
      async () =>
        server.callTool({
          name: "beta_tool",
          arguments: {},
        }),
      /Tool not enabled by visibility policy: beta_tool/
    );
    await assert.rejects(
      async () =>
        server.callTool({
          name: "gamma_tool",
          arguments: {},
        }),
      /Tool not enabled by visibility policy: gamma_tool/
    );

    const allowed = await server.callTool({
      name: "alpha_tool",
      arguments: {},
    });
    assert.deepEqual(allowed, { ok: true, dispatched_tool: "alpha_tool" });
    assert.deepEqual(calls, ["alpha_tool"]);
  });
});
