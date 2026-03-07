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

function readTextAbsolute(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function loadL1Sources() {
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const dictionaryPath = path.resolve(workspaceRoot, "ssot/dictionary/tools.json");
  const artifactsPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l2/mcp-tools.generated.json"
  );
  const sidecarManifestPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l2/sidecar-command-manifest.generated.json"
  );
  const visibilityPolicyPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l2/visibility-policy.generated.json"
  );
  const l3RouterBindingsPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l3/SsotBindings.generated.cs"
  );
  const l3DispatchBindingsPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l3/SsotDispatchBindings.generated.cs"
  );
  const dictionary = readJsonAbsolute(dictionaryPath);
  const artifacts = readJsonAbsolute(artifactsPath);
  const sidecarManifest = readJsonAbsolute(sidecarManifestPath);
  const visibilityPolicy = readJsonAbsolute(visibilityPolicyPath);
  const l3RouterBindings = readTextAbsolute(l3RouterBindingsPath);
  const l3DispatchBindings = readTextAbsolute(l3DispatchBindingsPath);
  return {
    dictionary,
    artifacts,
    sidecarManifest,
    visibilityPolicy,
    l3RouterBindings,
    l3DispatchBindings,
  };
}

test("L1 closure: active tool names are consistent across dictionary/artifacts/tools-list", async () => {
  const { dictionary, artifacts } = loadL1Sources();
  const registry = getMcpCommandRegistry();
  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;
  const toolsList = await server.getToolDefinitions();
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
  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;
  const visibleToolsList = await server.getToolDefinitions();
  const toolsListNames = new Set(
    visibleToolsList.map((item) => String(item && item.name || "").trim())
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

  const mcpServer = Object.create(UnityMcpServer.prototype);
  mcpServer.commandRegistry = registry;
  await assert.rejects(
    async () =>
      mcpServer.callTool({
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

test("L1 closure: every write tool defines complete transaction metadata", () => {
  const { dictionary } = loadL1Sources();
  const tools = Array.isArray(dictionary && dictionary.tools) ? dictionary.tools : [];
  for (const tool of tools) {
    if (String(tool && tool.kind || "").toLowerCase() !== "write") {
      continue;
    }
    const transaction = tool && typeof tool.transaction === "object" ? tool.transaction : null;
    assert.equal(!!transaction, true, `write tool missing transaction metadata: ${tool.name}`);
    assert.equal(
      typeof transaction.enabled,
      "boolean",
      `write tool transaction.enabled must be boolean: ${tool.name}`
    );
    assert.equal(
      typeof transaction.undo_safe,
      "boolean",
      `write tool transaction.undo_safe must be boolean: ${tool.name}`
    );
  }
});

test("L1 closure: execute_unity_transaction uses structured steps only", () => {
  const { dictionary } = loadL1Sources();
  const tools = Array.isArray(dictionary && dictionary.tools) ? dictionary.tools : [];
  const transactionTool = tools.find(
    (tool) => String(tool && tool.name || "") === "execute_unity_transaction"
  );
  assert.ok(transactionTool, "execute_unity_transaction should exist in dictionary");
  const input = transactionTool && typeof transactionTool.input === "object"
    ? transactionTool.input
    : {};
  const required = Array.isArray(input.required) ? input.required : [];
  const properties = input && typeof input.properties === "object" ? input.properties : {};
  const legacyStepFieldName = ["steps", "json"].join("_");

  assert.equal(required.includes("steps"), true);
  assert.equal(required.includes(legacyStepFieldName), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(properties, "steps"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(properties, legacyStepFieldName),
    false
  );
});

test("L1 closure: execute_unity_transaction tools/list schema is self-contained and ref-resolvable", async () => {
  const registry = getMcpCommandRegistry();
  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;
  const tools = await server.getToolDefinitions();
  const txTool = tools.find(
    (item) => String(item && item.name || "").trim() === "execute_unity_transaction"
  );
  assert.ok(txTool, "tools/list should expose execute_unity_transaction");

  const schema = txTool && txTool.inputSchema && typeof txTool.inputSchema === "object"
    ? txTool.inputSchema
    : {};
  const stepsItemsRef = String(
    schema &&
      schema.properties &&
      schema.properties.steps &&
      schema.properties.steps.items &&
      schema.properties.steps.items.$ref || ""
  );
  assert.equal(stepsItemsRef, "#/$defs/transaction_step");
  assert.equal(
    !!(schema.$defs && typeof schema.$defs === "object"),
    true,
    "transaction schema should carry $defs for MCP clients"
  );
  assert.equal(
    !!(schema.$defs && schema.$defs.transaction_step),
    true,
    "missing transaction_step in $defs"
  );
  assert.equal(
    !!(schema.$defs && schema.$defs.transaction_payload_value),
    true,
    "missing transaction_payload_value in $defs"
  );
  assert.equal(
    !!(schema.$defs && schema.$defs.transaction_ref_value),
    true,
    "missing transaction_ref_value in $defs"
  );
});

test("L1 closure: tools/list full schema payload stays within token budget guard", async () => {
  const registry = getMcpCommandRegistry();
  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;
  const tools = await server.getToolDefinitions();
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

test("L1 closure: sidecar command manifest keeps transport + dispatch contracts", () => {
  const { dictionary, sidecarManifest } = loadL1Sources();
  const dictionaryNames = new Set(
    (Array.isArray(dictionary.tools) ? dictionary.tools : []).map((item) =>
      String(item && item.name || "").trim()
    )
  );
  const commands = Array.isArray(sidecarManifest && sidecarManifest.commands)
    ? sidecarManifest.commands
    : [];
  assert.ok(commands.length > 0, "sidecar command manifest should not be empty");

  const byName = new Map();
  for (const command of commands) {
    const name = String(command && command.name || "").trim();
    if (!name) {
      continue;
    }
    byName.set(name, command);
    assert.equal(dictionaryNames.has(name), true, `manifest command missing in dictionary: ${name}`);
    assert.equal(
      ["ssot_query", "local_static"].includes(String(command.dispatch_mode || "")),
      true,
      `invalid dispatch_mode for ${name}`
    );
    assert.equal(
      String(command.http && command.http.path || ""),
      `/mcp/${name}`,
      `http.path drift for ${name}`
    );

    if (name === "get_unity_task_status") {
      assert.equal(String(command.http && command.http.method || ""), "GET");
      assert.equal(String(command.http && command.http.source || ""), "query");
      assert.equal(String(command.http && command.http.queryKey || ""), "job_id");
    } else {
      assert.equal(String(command.http && command.http.method || ""), "POST");
      assert.equal(String(command.http && command.http.source || ""), "body");
      assert.equal(
        Object.prototype.hasOwnProperty.call(command.http || {}, "queryKey"),
        false,
        `${name} should not define queryKey`
      );
    }
  }

  for (const toolName of dictionaryNames) {
    assert.equal(byName.has(toolName), true, `dictionary tool missing in sidecar manifest: ${toolName}`);
  }

  const localStaticNames = new Set([
    "get_action_catalog",
    "get_action_schema",
    "get_tool_schema",
    "get_write_contract_bundle",
    "preflight_validate_write_payload",
    "setup_cursor_mcp",
    "verify_mcp_setup",
    "run_unity_tests",
  ]);
  for (const [name, command] of byName.entries()) {
    const expectedMode = localStaticNames.has(name) ? "local_static" : "ssot_query";
    assert.equal(
      String(command.dispatch_mode || ""),
      expectedMode,
      `dispatch_mode drift for ${name}`
    );
  }
});

test("L1 closure: visibility policy artifact stays consistent with dictionary + sidecar manifest", () => {
  const { dictionary, sidecarManifest, visibilityPolicy } = loadL1Sources();
  const toolList = Array.isArray(dictionary && dictionary.tools)
    ? dictionary.tools
    : [];
  const manifestCommands = Array.isArray(sidecarManifest && sidecarManifest.commands)
    ? sidecarManifest.commands
    : [];

  const dictionaryDeprecatedNames = toolList
    .filter((tool) => {
      const lifecycle = String(tool && tool.lifecycle || "").toLowerCase();
      return lifecycle === "deprecated" || lifecycle === "retired";
    })
    .map((tool) => String(tool && tool.name || "").trim())
    .filter((name) => !!name);
  const dictionaryRemovedNames = Array.isArray(
    dictionary && dictionary._definitions && dictionary._definitions.removed_tool_names
  )
    ? dictionary._definitions.removed_tool_names
        .map((item) => String(item || "").trim())
        .filter((name) => !!name)
    : [];
  const manifestExposedNames = manifestCommands
    .map((command) => String(command && command.name || "").trim())
    .filter((name) => !!name);
  const manifestLocalStaticNames = manifestCommands
    .filter(
      (command) => String(command && command.dispatch_mode || "").toLowerCase() === "local_static"
    )
    .map((command) => String(command && command.name || "").trim())
    .filter((name) => !!name);

  assert.equal(Array.isArray(visibilityPolicy.active_tool_names), true);
  assert.equal(Array.isArray(visibilityPolicy.deprecated_tool_names), true);
  assert.equal(Array.isArray(visibilityPolicy.removed_tool_names), true);
  assert.equal(Array.isArray(visibilityPolicy.exposed_tool_names), true);
  assert.equal(Array.isArray(visibilityPolicy.local_static_tool_names), true);

  const uniqueSorted = (items) => Array.from(new Set(items)).sort();
  assert.deepEqual(
    uniqueSorted(visibilityPolicy.exposed_tool_names),
    uniqueSorted(manifestExposedNames),
    "visibility exposed_tool_names drifted from sidecar command manifest"
  );
  assert.deepEqual(
    uniqueSorted(visibilityPolicy.local_static_tool_names),
    uniqueSorted(manifestLocalStaticNames),
    "visibility local_static_tool_names drifted from sidecar command manifest"
  );
  assert.deepEqual(
    uniqueSorted(visibilityPolicy.deprecated_tool_names),
    uniqueSorted(dictionaryDeprecatedNames),
    "visibility deprecated_tool_names drifted from dictionary lifecycle"
  );
  assert.deepEqual(
    uniqueSorted(visibilityPolicy.removed_tool_names),
    uniqueSorted(dictionaryRemovedNames),
    "visibility removed_tool_names drifted from dictionary _definitions.removed_tool_names"
  );

  const expectedActiveNames = uniqueSorted(
    manifestExposedNames.filter(
      (name) =>
        !dictionaryDeprecatedNames.includes(name) &&
        !dictionaryRemovedNames.includes(name)
    )
  );
  assert.deepEqual(
    uniqueSorted(visibilityPolicy.active_tool_names),
    expectedActiveNames,
    "visibility active_tool_names formula drift: exposed - deprecated - removed"
  );
});

test("L1 closure: L3 dispatch bindings artifact stays in full sync with router tool coverage", () => {
  const { l3RouterBindings, l3DispatchBindings } = loadL1Sources();
  const routerToolClasses = Array.from(
    l3RouterBindings.matchAll(/case\s+([A-Za-z0-9_]+)\.ToolName:/g),
    (match) => match[1]
  );
  const dispatchToolClasses = Array.from(
    l3DispatchBindings.matchAll(/bindings\[([A-Za-z0-9_]+)\.ToolName\]/g),
    (match) => match[1]
  );

  assert.ok(routerToolClasses.length > 0, "router bindings should contain tool coverage");
  assert.ok(
    dispatchToolClasses.length > 0,
    "dispatch bindings should contain tool coverage"
  );

  const routerUnique = Array.from(new Set(routerToolClasses)).sort();
  const dispatchUnique = Array.from(new Set(dispatchToolClasses)).sort();
  assert.deepEqual(
    dispatchUnique,
    routerUnique,
    "L3 dispatch binding tool coverage drifted from router deserialization coverage"
  );
});
