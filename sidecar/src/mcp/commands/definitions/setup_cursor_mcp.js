"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateSetupCursorMcp =
    typeof source.validateSetupCursorMcp === "function"
      ? source.validateSetupCursorMcp
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
    "Setup Cursor MCP config via SSOT-generated schema.";

  return {
    name: "setup_cursor_mcp",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/setup_cursor_mcp",
      source: "body",
    },
    validate: validateSetupCursorMcp,
    turnServiceMethod: "setupCursorMcpForMcp",
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("setup_cursor_mcp", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("setup_cursor_mcp")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
