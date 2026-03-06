"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateUiLayout =
    typeof source.validateUiLayout === "function" ? source.validateUiLayout : null;
  const getSsotInputSchemaForTool =
    typeof source.getSsotInputSchemaForTool === "function"
      ? source.getSsotInputSchemaForTool
      : null;
  const getSsotToolDescriptionForTool =
    typeof source.getSsotToolDescriptionForTool === "function"
      ? source.getSsotToolDescriptionForTool
      : null;
  const fallbackDescription =
    "Validate UI layout issues via SSOT isolated query pipeline.";

  return {
    name: "validate_ui_layout",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/validate_ui_layout",
      source: "body",
    },
    turnServiceMethod: "validateUiLayoutForMcp",
    validate: validateUiLayout,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("validate_ui_layout", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("validate_ui_layout")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};

