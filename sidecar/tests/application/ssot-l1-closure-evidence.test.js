"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
} = require("../../src/ports/contracts");
const {
  getToolSchemaView,
} = require("../../src/application/ssotRuntime/staticContractViews");

function readJsonAbsolute(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadL1Sources() {
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const dictionaryPath = path.resolve(workspaceRoot, "ssot/dictionary/tools.json");
  const artifactsPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l2/mcp-tools.generated.json"
  );
  const dictionary = readJsonAbsolute(dictionaryPath);
  const artifacts = readJsonAbsolute(artifactsPath);
  return {
    dictionary,
    artifacts,
  };
}

test("L1 closure: active tool names are consistent across dictionary/artifacts/tools-list", () => {
  const { dictionary, artifacts } = loadL1Sources();
  const registry = getMcpCommandRegistry();
  const toolsList = registry.getToolsListCache({});
  const toolsListByName = new Map(
    toolsList.map((item) => [String(item && item.name || ""), item])
  );

  const dictionaryNames = new Set(
    (Array.isArray(dictionary.tools) ? dictionary.tools : []).map((item) =>
      String(item && item.name || "").trim()
    )
  );
  const artifactByName = new Map(
    (Array.isArray(artifacts.tools) ? artifacts.tools : []).map((item) => [
      String(item && item.name || "").trim(),
      item,
    ])
  );
  const activeToolNames = Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names)
    ? ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names
    : [];
  assert.ok(activeToolNames.length > 0);

  for (const toolName of activeToolNames) {
    assert.equal(dictionaryNames.has(toolName), true, `dictionary missing: ${toolName}`);
    assert.equal(artifactByName.has(toolName), true, `artifact missing: ${toolName}`);
    assert.equal(
      toolsListByName.has(toolName),
      true,
      `tools/list missing active tool: ${toolName}`
    );

    const listItem = toolsListByName.get(toolName);
    const artifactItem = artifactByName.get(toolName);
    assert.deepEqual(
      listItem && listItem.inputSchema ? listItem.inputSchema : {},
      artifactItem && artifactItem.inputSchema ? artifactItem.inputSchema : {},
      `tools/list schema drift for ${toolName}`
    );
  }

  const activeToolNameSet = new Set(activeToolNames);
  for (const listed of toolsListByName.keys()) {
    assert.equal(
      activeToolNameSet.has(listed),
      true,
      `tools/list exposed non-active tool: ${listed}`
    );
  }
});

test("L1 closure: deprecated tool status is externally trackable and blocked", async () => {
  const { dictionary, artifacts } = loadL1Sources();
  const registry = getMcpCommandRegistry();
  const toolsListNames = new Set(
    registry.getToolsListCache({}).map((item) => String(item && item.name || "").trim())
  );
  const deprecatedToolNames = Array.isArray(
    ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
  )
    ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
    : [];
  assert.ok(deprecatedToolNames.length > 0);
  assert.equal(
    deprecatedToolNames.includes("instantiate_prefab"),
    true,
    "instantiate_prefab should be tracked as deprecated"
  );

  const artifactByName = new Map(
    (Array.isArray(artifacts.tools) ? artifacts.tools : []).map((item) => [
      String(item && item.name || "").trim(),
      item,
    ])
  );
  const dictionaryByName = new Map(
    (Array.isArray(dictionary.tools) ? dictionary.tools : []).map((item) => [
      String(item && item.name || "").trim(),
      item,
    ])
  );

  for (const toolName of deprecatedToolNames) {
    assert.equal(toolsListNames.has(toolName), false, `deprecated tool leaked: ${toolName}`);
    const artifactRecord = artifactByName.get(toolName);
    if (artifactRecord) {
      assert.ok(
        ["deprecated", "retired"].includes(
          String(artifactRecord.lifecycle || "").toLowerCase()
        ),
        `artifact lifecycle should be deprecated/retired: ${toolName}`
      );
    }
    const dictionaryRecord = dictionaryByName.get(toolName);
    if (dictionaryRecord) {
      assert.ok(
        ["deprecated", "retired"].includes(
          String(dictionaryRecord.lifecycle || "").toLowerCase()
        ),
        `dictionary lifecycle should be deprecated/retired: ${toolName}`
      );
    }
  }

  const deprecatedSchema = getToolSchemaView({
    tool_name: "instantiate_prefab",
  });
  assert.equal(deprecatedSchema.statusCode, 200);
  assert.equal(
    String(deprecatedSchema.body && deprecatedSchema.body.lifecycle || "").toLowerCase(),
    "deprecated"
  );

  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;
  await assert.rejects(
    async () =>
      server.callTool({
        name: "instantiate_prefab",
        arguments: {},
      }),
    /Tool removed in phase6: instantiate_prefab/
  );
});

test("L1 closure: active tools have reusable examples in SSOT artifacts", () => {
  const { artifacts } = loadL1Sources();
  const activeToolNameSet = new Set(
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names
      : []
  );
  const artifactTools = Array.isArray(artifacts.tools) ? artifacts.tools : [];
  for (const tool of artifactTools) {
    const toolName = String(tool && tool.name || "").trim();
    if (!activeToolNameSet.has(toolName)) {
      continue;
    }
    assert.equal(
      Array.isArray(tool.examples) && tool.examples.length > 0,
      true,
      `active tool missing examples: ${toolName}`
    );
    for (const example of tool.examples) {
      assert.equal(
        !!(example && typeof example === "object" && example.request && typeof example.request === "object"),
        true,
        `invalid example shape for active tool: ${toolName}`
      );
    }
  }
});

test("L1 closure: tools/list full schema payload stays within token budget guard", () => {
  const registry = getMcpCommandRegistry();
  const tools = registry.getToolsListCache({});
  const payloadText = JSON.stringify({ tools });
  const bytes = Buffer.byteLength(payloadText, "utf8");

  assert.equal(bytes > 0, true);
  assert.equal(bytes <= 128 * 1024, true, `tools/list payload too large: ${bytes} bytes`);

  for (const tool of tools) {
    assert.equal(typeof tool.name === "string" && tool.name.trim().length > 0, true);
    assert.equal(
      typeof tool.description === "string" && tool.description.trim().length > 0,
      true,
      `tools/list missing description: ${tool.name}`
    );
    assert.equal(
      !!(tool.inputSchema && typeof tool.inputSchema === "object"),
      true,
      `tools/list missing inputSchema: ${tool.name}`
    );
  }
});

