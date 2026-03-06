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
  const validateSetRectPivot =
    typeof source.validateSetRectPivot === "function"
      ? source.validateSetRectPivot
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
    "Set RectTransform pivot for one explicit UI target in SSOT isolated write pipeline.";

  return {
    name: "set_rect_pivot",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_rect_pivot", source: "body" },
    turnServiceMethod: "setRectPivotForMcp",
    validate: validateSetRectPivot,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_rect_pivot", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_rect_pivot")
        : fallbackSchema(),
    },
  };
};
