"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  getValidatorRegistrySingleton,
} = require("../../application/ssotRuntime/validatorRegistry");

const SSOT_TOOL_CATALOG_ARTIFACT_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/mcp-tools.generated.json"
);
const SIDECAR_COMMAND_MANIFEST_ARTIFACT_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/sidecar-command-manifest.generated.json"
);

const REMOVED_TOOL_NAMES = new Set(["instantiate_prefab"]);
const DISPATCH_MODES = new Set(["ssot_query", "local_static"]);
const LOCAL_STATIC_TOOL_METHODS = Object.freeze({
  get_action_catalog: "getActionCatalogForMcp",
  get_action_schema: "getActionSchemaForMcp",
  get_tool_schema: "getToolSchemaForMcp",
  get_write_contract_bundle: "getWriteContractBundleForMcp",
  preflight_validate_write_payload: "preflightValidateWritePayloadForMcp",
  setup_cursor_mcp: "setupCursorMcpForMcp",
  verify_mcp_setup: "verifyMcpSetupForMcp",
  run_unity_tests: "runUnityTestsForMcp",
});

let ssotToolCatalogCache = null;
let sidecarCommandManifestCache = null;
let validatorRegistryCache = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHttpMethod(value) {
  return normalizeString(value).toUpperCase();
}

function summarizeValidationErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "Request schema invalid.";
  }
  const first = errors[0] && typeof errors[0] === "object" ? errors[0] : {};
  const instancePath =
    typeof first.instancePath === "string" && first.instancePath.trim()
      ? first.instancePath.trim()
      : "/";
  const message =
    typeof first.message === "string" && first.message.trim()
      ? first.message.trim()
      : "invalid value";
  return `Request schema invalid at ${instancePath}: ${message}`;
}

function loadSsotToolCatalog() {
  if (ssotToolCatalogCache) {
    return ssotToolCatalogCache;
  }

  const raw = fs.readFileSync(SSOT_TOOL_CATALOG_ARTIFACT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const tools = Array.isArray(parsed && parsed.tools) ? parsed.tools : [];
  if (tools.length === 0) {
    throw new Error(
      `SSOT tool catalog is empty or invalid at ${SSOT_TOOL_CATALOG_ARTIFACT_PATH}`
    );
  }

  const byName = new Map();
  for (const item of tools) {
    const toolName = normalizeString(item && item.name);
    if (!toolName) {
      continue;
    }
    byName.set(toolName, item);
  }

  ssotToolCatalogCache = { byName };
  return ssotToolCatalogCache;
}

function loadSidecarCommandManifest() {
  if (sidecarCommandManifestCache) {
    return sidecarCommandManifestCache;
  }

  const raw = fs.readFileSync(SIDECAR_COMMAND_MANIFEST_ARTIFACT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const commands = Array.isArray(parsed && parsed.commands)
    ? parsed.commands
    : [];
  if (commands.length === 0) {
    throw new Error(
      `SSOT sidecar command manifest is empty or invalid at ${SIDECAR_COMMAND_MANIFEST_ARTIFACT_PATH}`
    );
  }

  sidecarCommandManifestCache = {
    version: parsed && parsed.version,
    commands,
  };
  return sidecarCommandManifestCache;
}

function getValidatorRegistry() {
  if (!validatorRegistryCache) {
    validatorRegistryCache = getValidatorRegistrySingleton();
  }
  return validatorRegistryCache;
}

function createToolValidator(toolName) {
  const normalizedToolName = normalizeString(toolName);
  return function validateToolPayload(body) {
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};

    let registry = null;
    try {
      registry = getValidatorRegistry();
    } catch (error) {
      return {
        ok: false,
        errorCode: "E_SSOT_SCHEMA_UNAVAILABLE",
        message:
          error && typeof error.message === "string" && error.message.trim()
            ? error.message.trim()
            : "SSOT compiled schema registry is unavailable.",
        statusCode: 500,
      };
    }

    const validation = registry.validateToolInput(normalizedToolName, payload);
    if (validation && validation.ok === true) {
      return {
        ok: true,
        value:
          validation.value && typeof validation.value === "object"
            ? validation.value
            : payload,
      };
    }

    return {
      ok: false,
      errorCode: "E_SSOT_SCHEMA_INVALID",
      message: summarizeValidationErrors(validation && validation.errors),
      statusCode: 400,
      details:
        validation && Array.isArray(validation.errors) ? validation.errors : [],
    };
  };
}

function buildCommandDefinition(commandRecord, toolCatalog) {
  const source = commandRecord && typeof commandRecord === "object" ? commandRecord : {};
  const toolName = normalizeString(source.name);
  if (!toolName || REMOVED_TOOL_NAMES.has(toolName)) {
    return null;
  }

  const catalogRecord =
    toolCatalog && toolCatalog.byName instanceof Map
      ? toolCatalog.byName.get(toolName)
      : null;
  if (!catalogRecord) {
    throw new Error(`Missing SSOT tool catalog record for '${toolName}'`);
  }

  const dispatchMode = normalizeString(source.dispatch_mode).toLowerCase() || "ssot_query";
  if (!DISPATCH_MODES.has(dispatchMode)) {
    throw new Error(`Unsupported dispatch_mode '${dispatchMode}' for tool '${toolName}'`);
  }

  const httpSource = source.http && typeof source.http === "object" ? source.http : {};
  const httpMethod = normalizeHttpMethod(httpSource.method) || "POST";
  const httpPath = normalizeString(httpSource.path) || `/mcp/${toolName}`;
  const inputSchema =
    catalogRecord &&
    catalogRecord.inputSchema &&
    typeof catalogRecord.inputSchema === "object"
      ? cloneJson(catalogRecord.inputSchema)
      : {
          type: "object",
          additionalProperties: false,
          properties: {},
        };

  const http = {
    method: httpMethod,
    path: httpPath,
    source: normalizeString(httpSource.source) || "body",
  };
  if (http.source === "query") {
    const queryKey = normalizeString(httpSource.queryKey);
    if (!queryKey) {
      throw new Error(`Query source command '${toolName}' requires http.queryKey`);
    }
    http.queryKey = queryKey;
  }

  const definition = {
    name: toolName,
    kind:
      normalizeString(source.kind) ||
      normalizeString(catalogRecord.kind) ||
      "write",
    lifecycle:
      normalizeString(source.lifecycle) ||
      normalizeString(catalogRecord.lifecycle) ||
      "stable",
    dispatch_mode: dispatchMode,
    http,
    validate: createToolValidator(toolName),
    mcp: {
      expose: true,
      description: normalizeString(catalogRecord.description),
      inputSchema,
    },
  };

  if (dispatchMode === "local_static") {
    const methodName = LOCAL_STATIC_TOOL_METHODS[toolName] || "";
    if (!methodName) {
      throw new Error(`local_static tool '${toolName}' is missing turnService method mapping`);
    }
    definition.turnServiceMethod = methodName;
  }

  return Object.freeze(definition);
}

function buildCommandDefinitions() {
  const sidecarManifest = loadSidecarCommandManifest();
  const toolCatalog = loadSsotToolCatalog();
  const commands = Array.isArray(sidecarManifest.commands)
    ? sidecarManifest.commands
    : [];

  const definitions = [];
  for (const commandRecord of commands) {
    const definition = buildCommandDefinition(commandRecord, toolCatalog);
    if (definition) {
      definitions.push(definition);
    }
  }

  if (definitions.length === 0) {
    throw new Error("No command definitions were materialized from SSOT artifacts");
  }
  return Object.freeze(definitions);
}

const MCP_COMMAND_DEFINITIONS = buildCommandDefinitions();

module.exports = {
  MCP_COMMAND_DEFINITIONS,
};
