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
  const validateSetUiImageColor =
    typeof source.validateSetUiImageColor === "function"
      ? source.validateSetUiImageColor
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
    "Set UnityEngine.UI.Image color for one explicit UI target in SSOT isolated write pipeline.";

  return {
    name: "set_ui_image_color",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_ui_image_color",
      source: "body",
    },
    turnServiceMethod: "setUiImageColorForMcp",
    validate: validateSetUiImageColor,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_ui_image_color", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_ui_image_color")
        : fallbackSchema(),
    },
  };
};
