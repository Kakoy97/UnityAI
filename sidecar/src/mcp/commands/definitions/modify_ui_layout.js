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
  const validateModifyUiLayout =
    typeof source.validateModifyUiLayout === "function"
      ? source.validateModifyUiLayout
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
    "Modify RectTransform geometry only (anchored_x/anchored_y/width/height). This route is SSOT-isolated and never falls back to non-SSOT pipeline.";

  return {
    name: "modify_ui_layout",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/modify_ui_layout", source: "body" },
    turnServiceMethod: "modifyUiLayoutForMcp",
    validate: validateModifyUiLayout,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("modify_ui_layout", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("modify_ui_layout")
        : fallbackSchema(),
    },
  };
};
