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
  const validateSetCanvasGroupAlpha =
    typeof source.validateSetCanvasGroupAlpha === "function"
      ? source.validateSetCanvasGroupAlpha
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
    "Set CanvasGroup alpha for one explicit UI target in SSOT isolated write pipeline.";

  return {
    name: "set_canvas_group_alpha",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_canvas_group_alpha",
      source: "body",
    },
    turnServiceMethod: "setCanvasGroupAlphaForMcp",
    validate: validateSetCanvasGroupAlpha,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "set_canvas_group_alpha",
            fallbackDescription,
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_canvas_group_alpha")
        : fallbackSchema(),
    },
  };
};
