"use strict";

function executeGetToolSchema(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const toolName =
    typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
  const registry =
    ctx.commandRegistry && typeof ctx.commandRegistry === "object"
      ? ctx.commandRegistry
      : null;

  if (!registry || typeof registry.getToolMetadataByName !== "function") {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error_code: "E_INTERNAL",
        message: "Command registry is unavailable",
      },
    };
  }

  const metadata = registry.getToolMetadataByName(toolName, ctx);
  if (!metadata) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error_code: "E_TOOL_SCHEMA_NOT_FOUND",
        message: `Tool schema not found for '${toolName}'`,
        suggestion:
          "Call tools/list to inspect visible tool names, then retry get_tool_schema with a valid tool_name.",
        recoverable: true,
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      tool_name: metadata.name,
      kind: metadata.kind,
      lifecycle: metadata.lifecycle,
      description: metadata.description,
      transport: metadata.transport,
      input_schema: metadata.input_schema,
      tools_list_input_schema: metadata.tools_list_input_schema,
      schema_source: "registry_full",
      guidance:
        "tools/list exposes compact schema; use get_tool_schema for full contract details.",
    },
  };
}

module.exports = {
  executeGetToolSchema,
};

