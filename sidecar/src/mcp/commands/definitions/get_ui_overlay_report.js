"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetUiOverlayReport =
    typeof source.validateGetUiOverlayReport === "function"
      ? source.validateGetUiOverlayReport
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
    "Inspect ScreenSpaceOverlay coverage and diagnostics via SSOT isolated query pipeline.";

  return {
    name: "get_ui_overlay_report",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_ui_overlay_report",
      source: "body",
    },
    turnServiceMethod: "getUiOverlayReportForMcp",
    validate: validateGetUiOverlayReport,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_ui_overlay_report", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_ui_overlay_report")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
