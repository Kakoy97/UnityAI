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
  const validateHitTestUiAtScreenPoint =
    typeof source.validateHitTestUiAtScreenPoint === "function"
      ? source.validateHitTestUiAtScreenPoint
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
    "Hit test UGUI using screen-space coordinates in SSOT isolated read pipeline.";

  return {
    name: "hit_test_ui_at_screen_point",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/hit_test_ui_at_screen_point",
      source: "body",
    },
    turnServiceMethod: "hitTestUiAtScreenPointForMcp",
    validate: validateHitTestUiAtScreenPoint,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "hit_test_ui_at_screen_point",
            fallbackDescription
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("hit_test_ui_at_screen_point")
        : fallbackSchema(),
    },
  };
};
