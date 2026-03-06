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
  const validateSetUiTextFontSize =
    typeof source.validateSetUiTextFontSize === "function"
      ? source.validateSetUiTextFontSize
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
    "Set UI text font size for one explicit target in SSOT isolated write pipeline.";

  return {
    name: "set_ui_text_font_size",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_ui_text_font_size",
      source: "body",
    },
    turnServiceMethod: "setUiTextFontSizeForMcp",
    validate: validateSetUiTextFontSize,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_ui_text_font_size", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_ui_text_font_size")
        : fallbackSchema(),
    },
  };
};
