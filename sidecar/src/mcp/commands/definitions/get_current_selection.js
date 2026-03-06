"use strict";

function fallbackSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetCurrentSelection =
    typeof source.validateGetCurrentSelection === "function"
      ? source.validateGetCurrentSelection
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
    "Read current Unity selection snapshot and return SSOT read-token candidate from isolated query pipeline.";

  return {
    name: "get_current_selection",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_current_selection",
      source: "body",
    },
    turnServiceMethod: "getCurrentSelectionSsotForMcp",
    validate: validateGetCurrentSelection,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_current_selection", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_current_selection")
        : fallbackSchema(),
    },
  };
};
