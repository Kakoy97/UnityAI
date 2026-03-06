"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const { MCP_COMMAND_DEFINITIONS } = require("../../src/mcp/commands");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonAbsolute(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadArtifactsByName() {
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const artifactsPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l2/mcp-tools.generated.json"
  );
  const artifacts = readJsonAbsolute(artifactsPath);
  const byName = new Map();
  for (const tool of Array.isArray(artifacts.tools) ? artifacts.tools : []) {
    const toolName =
      tool && typeof tool.name === "string" ? tool.name.trim() : "";
    if (!toolName) {
      continue;
    }
    byName.set(toolName, tool);
  }
  return byName;
}

function loadSidecarManifestByName() {
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const manifestPath = path.resolve(
    workspaceRoot,
    "ssot/artifacts/l2/sidecar-command-manifest.generated.json"
  );
  const parsed = readJsonAbsolute(manifestPath);
  const commands = Array.isArray(parsed && parsed.commands) ? parsed.commands : [];
  const byName = new Map();
  for (const command of commands) {
    const commandName =
      command && typeof command.name === "string" ? command.name.trim() : "";
    if (!commandName) {
      continue;
    }
    byName.set(commandName, command);
  }
  return byName;
}

function normalizeSchemaType(schema) {
  const source = schema && typeof schema === "object" ? schema : {};
  if (Array.isArray(source.type) && source.type.length > 0) {
    return String(source.type[0] || "").toLowerCase();
  }
  return String(source.type || "").toLowerCase();
}

function buildValueFromSchema(schema, fieldName) {
  const source = schema && typeof schema === "object" ? schema : {};
  if (Array.isArray(source.enum) && source.enum.length > 0) {
    return source.enum[0];
  }
  if (Array.isArray(source.oneOf) && source.oneOf.length > 0) {
    return buildValueFromSchema(source.oneOf[0], fieldName);
  }
  if (Array.isArray(source.anyOf) && source.anyOf.length > 0) {
    return buildValueFromSchema(source.anyOf[0], fieldName);
  }

  const schemaType = normalizeSchemaType(source);
  if (schemaType === "object") {
    const payload = {};
    const props =
      source.properties && typeof source.properties === "object"
        ? source.properties
        : {};
    const required = Array.isArray(source.required) ? source.required : [];
    for (const key of required) {
      payload[key] = buildValueFromSchema(props[key], key);
    }
    return payload;
  }
  if (schemaType === "array") {
    const itemSchema =
      source.items && typeof source.items === "object" ? source.items : {};
    const minItems =
      Number.isFinite(Number(source.minItems)) && Number(source.minItems) > 0
        ? Math.floor(Number(source.minItems))
        : 1;
    return Array.from({ length: minItems }, () =>
      buildValueFromSchema(itemSchema, `${fieldName || "item"}_item`)
    );
  }
  if (schemaType === "integer" || schemaType === "number") {
    if (Number.isFinite(Number(source.minimum))) {
      return Number(source.minimum);
    }
    return 1;
  }
  if (schemaType === "boolean") {
    return true;
  }

  if (source.format === "uri") {
    return "http://127.0.0.1:46321";
  }
  const minLength =
    Number.isFinite(Number(source.minLength)) && Number(source.minLength) > 0
      ? Math.floor(Number(source.minLength))
      : 1;
  const base = `${fieldName || "value"}_v`;
  if (base.length >= minLength) {
    return base;
  }
  return `${base}${"x".repeat(minLength - base.length)}`;
}

function buildPayloadFromSchema(schema) {
  const source = schema && typeof schema === "object" ? schema : {};
  const payload = {};
  const props =
    source.properties && typeof source.properties === "object"
      ? source.properties
      : {};
  const required = Array.isArray(source.required) ? source.required : [];
  for (const key of required) {
    payload[key] = buildValueFromSchema(props[key], key);
  }
  return payload;
}

function getExamplePayloadForTool(artifactsByName, toolName) {
  const tool = artifactsByName.get(toolName);
  const examples =
    tool && Array.isArray(tool.examples) ? tool.examples : [];
  for (const item of examples) {
    if (
      item &&
      typeof item === "object" &&
      item.request &&
      typeof item.request === "object" &&
      !Array.isArray(item.request)
    ) {
      return cloneJson(item.request);
    }
  }
  return null;
}

function resolveValidPayloadForCommand(command, artifactsByName) {
  const fallbackSchema =
    command &&
    command.mcp &&
    command.mcp.inputSchema &&
    typeof command.mcp.inputSchema === "object"
      ? command.mcp.inputSchema
      : { type: "object", properties: {}, required: [] };
  const candidates = [];

  const fromExample = getExamplePayloadForTool(artifactsByName, command.name);
  if (fromExample) {
    candidates.push(fromExample);
  }
  candidates.push(buildPayloadFromSchema(fallbackSchema));
  candidates.push({});

  for (const payload of candidates) {
    const validation =
      typeof command.validate === "function" ? command.validate(payload) : null;
    if (validation && validation.ok === true) {
      if (
        validation &&
        typeof validation === "object" &&
        Object.prototype.hasOwnProperty.call(validation, "value") &&
        validation.value !== undefined
      ) {
        return cloneJson(validation.value);
      }
      return cloneJson(payload);
    }
  }

  throw new Error(`Unable to resolve valid payload for command '${command.name}'`);
}

function createTurnServiceHarness() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => "2026-03-06T12:00:00.000Z",
    enableMcpAdapter: true,
    mcpCapabilityStaleAfterMs: 1000,
    fileActionExecutor: {
      execute(actions) {
        return {
          ok: true,
          changes: Array.isArray(actions) ? actions : [],
        };
      },
    },
  });
  return { service, turnStore };
}

async function dispatchCommand(registry, command, payload, turnService) {
  const method = String(
    command && command.http && command.http.method
      ? command.http.method
      : "POST"
  )
    .trim()
    .toUpperCase();
  const routePath =
    command && command.http && typeof command.http.path === "string"
      ? command.http.path
      : "/";
  const source = String(
    command && command.http && command.http.source ? command.http.source : "body"
  )
    .trim()
    .toLowerCase();
  const queryKey =
    command && command.http && typeof command.http.queryKey === "string"
      ? command.http.queryKey.trim()
      : "";

  const url = new URL(`http://127.0.0.1:46321${routePath}`);
  let bodyPayload = payload && typeof payload === "object" ? payload : {};
  if (source === "query" && queryKey) {
    const rawValue =
      bodyPayload && typeof bodyPayload === "object" ? bodyPayload[queryKey] : "";
    url.searchParams.set(
      queryKey,
      rawValue === undefined || rawValue === null ? "" : String(rawValue)
    );
    bodyPayload = {};
  }

  return registry.dispatchHttpCommand({
    method,
    path: routePath,
    url,
    req: {},
    readJsonBody: async () => bodyPayload,
    turnService,
  });
}

function buildValidationErrorResponse(validation) {
  const source = validation && typeof validation === "object" ? validation : {};
  return {
    statusCode:
      Number.isFinite(Number(source.statusCode)) && Number(source.statusCode) > 0
        ? Math.floor(Number(source.statusCode))
        : 400,
    body: {
      error_code:
        typeof source.errorCode === "string" && source.errorCode.trim()
          ? source.errorCode.trim()
          : "E_SSOT_SCHEMA_INVALID",
      message:
        typeof source.message === "string" && source.message.trim()
          ? source.message.trim()
          : "Request schema invalid",
    },
  };
}

test("L2 closure: all write tools enforce schema + token + revision gates", async () => {
  const registry = getMcpCommandRegistry();
  const artifactsByName = loadArtifactsByName();
  const { service, turnStore } = createTurnServiceHarness();
  try {
    service.enqueueAndWaitForUnityQuery = async () => {
      throw new Error("write guard should reject before Unity query dispatch");
    };
    if (
      service.ssotTokenRegistry &&
      typeof service.ssotTokenRegistry.clearForTests === "function"
    ) {
      service.ssotTokenRegistry.clearForTests();
    }
    if (
      service.ssotRevisionState &&
      typeof service.ssotRevisionState.clearForTests === "function"
    ) {
      service.ssotRevisionState.clearForTests();
    }

    const issued = service.ssotTokenRegistry.issueToken({
      source_tool_name: "get_current_selection",
      scene_revision: "ssot_rev_l2_gate_1001",
    });
    assert.equal(issued.ok, true);
    service.ssotRevisionState.updateLatestKnownSceneRevision(
      "ssot_rev_l2_gate_1002",
      {
        source_tool_name: "l2.closure.test",
      }
    );

    const writeCommands = registry
      .listCommands()
      .filter(
        (command) =>
          command &&
          command.kind === "write" &&
          command.mcp &&
          command.mcp.expose === true
      );
    assert.ok(writeCommands.length > 0);

    for (const command of writeCommands) {
      const validPayload = resolveValidPayloadForCommand(command, artifactsByName);

      const invalidSchemaOutcome = await dispatchCommand(
        registry,
        command,
        {},
        service
      );
      assert.equal(
        invalidSchemaOutcome.statusCode,
        400,
        `schema gate status drift: ${command.name}`
      );
      assert.equal(
        invalidSchemaOutcome.body.error_code,
        "E_SSOT_SCHEMA_INVALID",
        `schema gate error drift: ${command.name}`
      );

      const invalidTokenPayload = cloneJson(validPayload);
      invalidTokenPayload.based_on_read_token = "x";
      const invalidTokenOutcome = await dispatchCommand(
        registry,
        command,
        invalidTokenPayload,
        service
      );
      assert.equal(
        invalidTokenOutcome.statusCode,
        409,
        `token gate status drift: ${command.name}`
      );
      assert.equal(
        invalidTokenOutcome.body.error_code,
        "E_TOKEN_UNKNOWN",
        `token gate error drift: ${command.name}`
      );

      const staleRevisionPayload = cloneJson(validPayload);
      staleRevisionPayload.based_on_read_token = issued.token;
      const staleRevisionOutcome = await dispatchCommand(
        registry,
        command,
        staleRevisionPayload,
        service
      );
      assert.equal(
        staleRevisionOutcome.statusCode,
        409,
        `revision gate status drift: ${command.name}`
      );
      assert.equal(
        staleRevisionOutcome.body.error_code,
        "E_SCENE_REVISION_DRIFT",
        `revision gate error drift: ${command.name}`
      );
    }
  } finally {
    turnStore.stopMaintenance();
  }
});

test("L2 closure: every tool keeps single-path dispatch and no fallback handler", async () => {
  const registry = getMcpCommandRegistry();
  const artifactsByName = loadArtifactsByName();
  const commands = registry
    .listCommands()
    .filter((command) => command && command.mcp && command.mcp.expose === true);
  assert.ok(commands.length > 0);

  for (const command of commands) {
    const payload = resolveValidPayloadForCommand(command, artifactsByName);
    const turnService = {
      validationError(validation) {
        return buildValidationErrorResponse(validation);
      },
      recordMcpToolInvocation() {
        // no-op: this test only verifies handler lookup path.
      },
    };

    const outcome = await dispatchCommand(registry, command, payload, turnService);
    assert.equal(
      outcome.statusCode,
      500,
      `expected no fallback for missing handler: ${command.name}`
    );
    assert.equal(outcome.body.error_code, "E_INTERNAL");
    assert.equal(
      String(outcome.body.message || "").includes(command.name),
      true,
      `missing command name in no-fallback error: ${command.name}`
    );
  }
});

test("L2 closure: ssot.request status/error envelope and observability fields stay consistent", async () => {
  const registry = getMcpCommandRegistry();
  const artifactsByName = loadArtifactsByName();
  const { service, turnStore } = createTurnServiceHarness();
  try {
    if (
      service.ssotTokenRegistry &&
      typeof service.ssotTokenRegistry.clearForTests === "function"
    ) {
      service.ssotTokenRegistry.clearForTests();
    }
    if (
      service.ssotRevisionState &&
      typeof service.ssotRevisionState.clearForTests === "function"
    ) {
      service.ssotRevisionState.clearForTests();
    }
    service.ssotRevisionState.updateLatestKnownSceneRevision(
      "ssot_rev_l2_success_9001",
      {
        source_tool_name: "l2.closure.test",
      }
    );
    const issued = service.ssotTokenRegistry.issueToken({
      source_tool_name: "get_current_selection",
      scene_revision: "ssot_rev_l2_success_9001",
    });
    assert.equal(issued.ok, true);

    service.enqueueAndWaitForUnityQuery = async (input) => {
      const source = input && typeof input === "object" ? input : {};
      const payloadJson =
        typeof source.queryPayloadJson === "string" ? source.queryPayloadJson : "{}";
      const queryPayload = JSON.parse(payloadJson);
      return {
        ok: true,
        data: {
          scene_revision: "ssot_rev_l2_success_9001",
          tool_name_echo:
            queryPayload && typeof queryPayload.tool_name === "string"
              ? queryPayload.tool_name
              : "",
        },
      };
    };

    const records = [];
    service.recordMcpToolInvocation = (entry) => {
      records.push(entry);
    };

    const requestCommands = registry
      .listCommands()
      .filter((command) => {
        if (!command || !command.mcp || command.mcp.expose !== true) {
          return false;
        }
        return String(command.dispatch_mode || "").toLowerCase() === "ssot_query";
      });
    assert.ok(requestCommands.length > 0);

    const expectedLifecycleByCommand = new Map(
      requestCommands.map((command) => [command.name, command.lifecycle])
    );

    for (const command of requestCommands) {
      const payload = resolveValidPayloadForCommand(command, artifactsByName);
      if (command.kind === "write") {
        payload.based_on_read_token = issued.token;
      }
      const outcome = await dispatchCommand(registry, command, payload, service);
      assert.equal(
        outcome.statusCode,
        200,
        `status envelope drift for ${command.name}`
      );
      assert.equal(outcome.body.ok, true, `ok envelope drift for ${command.name}`);
      assert.equal(
        outcome.body.status,
        "succeeded",
        `status field drift for ${command.name}`
      );
      assert.equal(
        outcome.body.query_type,
        "ssot.request",
        `query_type drift for ${command.name}`
      );
      assert.equal(
        outcome.body.tool_name,
        command.name,
        `tool_name drift for ${command.name}`
      );
      assert.equal(
        !!(outcome.body.data && typeof outcome.body.data === "object"),
        true,
        `data envelope drift for ${command.name}`
      );
    }

    assert.equal(records.length, requestCommands.length);
    for (const entry of records) {
      assert.equal(typeof entry.command_name, "string");
      assert.equal(typeof entry.command_kind, "string");
      assert.equal(typeof entry.command_lifecycle, "string");
      assert.equal(
        entry.command_lifecycle,
        expectedLifecycleByCommand.get(entry.command_name),
        `observability lifecycle drift for ${entry.command_name}`
      );
      assert.equal(
        !!(entry.request_meta && typeof entry.request_meta === "object"),
        true
      );
      assert.equal(typeof entry.request_meta.method, "string");
      assert.equal(typeof entry.request_meta.path, "string");
    }
  } finally {
    turnStore.stopMaintenance();
  }
});

test("L2 closure: command definitions stay artifact-driven with zero per-tool ssot_query glue", () => {
  const manifestByName = loadSidecarManifestByName();
  const definitionByName = new Map(
    (Array.isArray(MCP_COMMAND_DEFINITIONS) ? MCP_COMMAND_DEFINITIONS : []).map((item) => [
      String(item && item.name || "").trim(),
      item,
    ])
  );
  assert.ok(definitionByName.size > 0, "runtime command definitions should not be empty");

  const removedToolNames = new Set(["instantiate_prefab"]);
  for (const [toolName, command] of manifestByName.entries()) {
    if (removedToolNames.has(toolName)) {
      assert.equal(
        definitionByName.has(toolName),
        false,
        `removed tool should not be materialized: ${toolName}`
      );
      continue;
    }

    assert.equal(
      definitionByName.has(toolName),
      true,
      `manifest tool missing runtime definition: ${toolName}`
    );
    const runtimeDefinition = definitionByName.get(toolName);
    assert.equal(
      String(runtimeDefinition.dispatch_mode || ""),
      String(command && command.dispatch_mode || ""),
      `dispatch_mode drift for ${toolName}`
    );

    if (String(runtimeDefinition.dispatch_mode || "") === "ssot_query") {
      assert.equal(
        Object.prototype.hasOwnProperty.call(runtimeDefinition, "turnServiceMethod"),
        false,
        `ssot_query tool should not require per-tool turnService method: ${toolName}`
      );
    } else if (String(runtimeDefinition.dispatch_mode || "") === "local_static") {
      assert.equal(
        typeof runtimeDefinition.turnServiceMethod === "string" &&
          runtimeDefinition.turnServiceMethod.trim().length > 0,
        true,
        `local_static tool must keep explicit turnServiceMethod: ${toolName}`
      );
    } else {
      assert.fail(`unsupported dispatch_mode in runtime definitions: ${toolName}`);
    }
  }
});
