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
  const validateApplyVisualActions =
    typeof source.validateApplyVisualActions === "function"
      ? source.validateApplyVisualActions
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
    "Apply structured Unity visual actions in SSOT isolated write pipeline.";

  return {
    name: "apply_visual_actions",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/apply_visual_actions", source: "body" },
    turnServiceMethod: "applyVisualActionsForMcp",
    validate: validateApplyVisualActions,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("apply_visual_actions", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("apply_visual_actions")
        : fallbackSchema(),
    },
  };
};
