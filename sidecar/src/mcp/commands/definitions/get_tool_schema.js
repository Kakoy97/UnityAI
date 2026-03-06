"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetToolSchema =
    typeof source.validateGetToolSchema === "function"
      ? source.validateGetToolSchema
      : null;
  const getSsotInputSchemaForTool =
    typeof source.getSsotInputSchemaForTool === "function"
      ? source.getSsotInputSchemaForTool
      : null;
  const getSsotToolDescriptionForTool =
    typeof source.getSsotToolDescriptionForTool === "function"
      ? source.getSsotToolDescriptionForTool
      : null;
  const fallbackDescription =
    "Get full MCP tool schema contract via SSOT-generated input schema.";

  return {
    name: "get_tool_schema",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/get_tool_schema", source: "body" },
    turnServiceMethod: "getToolSchemaForMcp",
    validate: validateGetToolSchema,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_tool_schema", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_tool_schema")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
