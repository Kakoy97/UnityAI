"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateHitTestUiAtViewportPoint =
    typeof source.validateHitTestUiAtViewportPoint === "function"
      ? source.validateHitTestUiAtViewportPoint
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
    "Hit test UI from deterministic viewport coordinates via SSOT isolated query pipeline.";

  return {
    name: "hit_test_ui_at_viewport_point",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/hit_test_ui_at_viewport_point",
      source: "body",
    },
    turnServiceMethod: "hitTestUiAtViewportPointForMcp",
    validate: validateHitTestUiAtViewportPoint,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "hit_test_ui_at_viewport_point",
            fallbackDescription
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("hit_test_ui_at_viewport_point")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};

