"use strict";

const {
  getStaticToolCatalogSingleton,
} = require("./staticToolCatalog");

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

function buildFallbackTemplate(toolRecord) {
  const template = {};
  const required = Array.isArray(toolRecord && toolRecord.required)
    ? toolRecord.required
    : [];
  for (const field of required) {
    template[field] = `__${field}__`;
  }
  return template;
}

function pickMinimalTemplateFromExamples(toolRecord) {
  const examples = Array.isArray(toolRecord && toolRecord.examples)
    ? toolRecord.examples
    : [];
  for (const entry of examples) {
    if (
      entry &&
      typeof entry === "object" &&
      entry.request &&
      typeof entry.request === "object" &&
      !Array.isArray(entry.request)
    ) {
      return JSON.parse(JSON.stringify(entry.request));
    }
  }
  return buildFallbackTemplate(toolRecord);
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
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const toolName =
    typeof payload.tool_name === "string" && payload.tool_name.trim()
      ? payload.tool_name.trim()
      : "modify_ui_layout";
  const requestedActionType =
    typeof payload.action_type === "string" && payload.action_type.trim()
      ? payload.action_type.trim()
      : "";

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
  if (String(record.kind).toLowerCase() !== "write") {
    return {
      statusCode: 400,
      body: {
        ok: false,
        error_code: "E_SSOT_WRITE_TOOL_REQUIRED",
        message:
          "get_write_contract_bundle only supports SSOT write tools in static mode",
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      tool_name: record.name,
      action_type: requestedActionType || null,
      schema_source: "ssot_static_artifact",
      write_envelope_contract: {
        mode: "static",
        required_fields: record.required,
        guidance:
          "Use the required fields exactly as documented. No dynamic action schema expansion is provided in SSOT static mode.",
      },
      minimal_valid_payload_template: pickMinimalTemplateFromExamples(record),
      schema_ref: {
        tool: "get_tool_schema",
        mode: "ssot_static_artifact",
      },
      message:
        "Dynamic contract synthesis is deprecated. Returning static SSOT contract view from compiled artifacts.",
    },
  };
}

module.exports = {
  getActionCatalogView,
  getActionSchemaView,
  getToolSchemaView,
  getWriteContractBundleView,
};
