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
  const validateSetRectSizeDelta =
    typeof source.validateSetRectSizeDelta === "function"
      ? source.validateSetRectSizeDelta
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
    "Set RectTransform sizeDelta for one explicit UI target in SSOT isolated write pipeline.";

  return {
    name: "set_rect_size_delta",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_rect_size_delta", source: "body" },
    turnServiceMethod: "setRectSizeDeltaForMcp",
    validate: validateSetRectSizeDelta,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_rect_size_delta", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_rect_size_delta")
        : fallbackSchema(),
    },
  };
};
