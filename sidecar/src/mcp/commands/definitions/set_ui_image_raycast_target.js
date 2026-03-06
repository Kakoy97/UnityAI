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
  const validateSetUiImageRaycastTarget =
    typeof source.validateSetUiImageRaycastTarget === "function"
      ? source.validateSetUiImageRaycastTarget
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
    "Set Image raycastTarget for one explicit UI target in SSOT isolated write pipeline.";

  return {
    name: "set_ui_image_raycast_target",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_ui_image_raycast_target",
      source: "body",
    },
    turnServiceMethod: "setUiImageRaycastTargetForMcp",
    validate: validateSetUiImageRaycastTarget,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "set_ui_image_raycast_target",
            fallbackDescription,
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_ui_image_raycast_target")
        : fallbackSchema(),
    },
  };
};
