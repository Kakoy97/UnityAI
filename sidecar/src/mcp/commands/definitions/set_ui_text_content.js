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
  const validateSetUiTextContent =
    typeof source.validateSetUiTextContent === "function"
      ? source.validateSetUiTextContent
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
    "Set UI text content for one explicit target in SSOT isolated write pipeline.";

  return {
    name: "set_ui_text_content",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_ui_text_content",
      source: "body",
    },
    turnServiceMethod: "setUiTextContentForMcp",
    validate: validateSetUiTextContent,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_ui_text_content", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_ui_text_content")
        : fallbackSchema(),
    },
  };
};
