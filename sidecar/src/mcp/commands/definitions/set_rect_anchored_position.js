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
  const validateSetRectAnchoredPosition =
    typeof source.validateSetRectAnchoredPosition === "function"
      ? source.validateSetRectAnchoredPosition
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
    "Set RectTransform anchored position for one explicit UI target in SSOT isolated write pipeline.";

  return {
    name: "set_rect_anchored_position",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_rect_anchored_position",
      source: "body",
    },
    turnServiceMethod: "setRectAnchoredPositionForMcp",
    validate: validateSetRectAnchoredPosition,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_rect_anchored_position", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_rect_anchored_position")
        : fallbackSchema(),
    },
  };
};
