"use strict";

const {
  getStaticToolCatalogSingleton,
} = require("./staticToolCatalog");
const { buildWriteContractBundleView } = require("./contractAdvisor");

function buildDeprecatedResponse(toolName) {
  return {
    statusCode: 200,
    body: {
      ok: true,
      status: "succeeded",
      deprecated: true,
      tool_name: toolName,
      message:
        "Schema dynamic discovery is deprecated in SSOT. Please refer to the static tool descriptions in tools/list.",
    },
  };
}

function loadCatalogSafe() {
  try {
    return { ok: true, catalog: getStaticToolCatalogSingleton() };
  } catch (error) {
    return {
      ok: false,
      statusCode: 500,
      body: {
        ok: false,
        error_code: "E_SSOT_SCHEMA_UNAVAILABLE",
        message:
          error && typeof error.message === "string" && error.message.trim()
            ? error.message.trim()
            : "SSOT static tool catalog is unavailable",
      },
    };
  }
}

function getToolRecord(catalog, toolName) {
  if (!catalog || !(catalog.byName instanceof Map)) {
    return null;
  }
  return catalog.byName.get(toolName) || null;
}

function getActionCatalogView() {
  return buildDeprecatedResponse("get_action_catalog");
}

function getActionSchemaView() {
  return buildDeprecatedResponse("get_action_schema");
}

function getToolSchemaView(requestBody) {
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const toolName =
    typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
  if (!toolName) {
    return {
      statusCode: 400,
      body: {
        ok: false,
        error_code: "E_SSOT_SCHEMA_INVALID",
        message: "tool_name is required",
      },
    };
  }

  const load = loadCatalogSafe();
  if (!load.ok) {
    return load;
  }
  const record = getToolRecord(load.catalog, toolName);
  if (!record) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error_code: "E_TOOL_SCHEMA_NOT_FOUND",
        message: `Tool schema not found for '${toolName}'`,
        guidance:
          "The requested tool is not part of current SSOT static tool catalog. Use tools/list to inspect available tools.",
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      tool_name: record.name,
      kind: record.kind,
      lifecycle: record.lifecycle,
      description: record.description,
      input_schema: record.inputSchema,
      required_fields: record.required,
      examples: record.examples,
      schema_source: "ssot_static_artifact",
      guidance:
        "Dynamic schema discovery is deprecated. This response is resolved from SSOT compiled static artifacts.",
    },
  };
}

function getWriteContractBundleView(requestBody) {
  return buildWriteContractBundleView(requestBody);
}

module.exports = {
  getActionCatalogView,
  getActionSchemaView,
  getToolSchemaView,
  getWriteContractBundleView,
};
