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
  const validateSetLayoutElement =
    typeof source.validateSetLayoutElement === "function"
      ? source.validateSetLayoutElement
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
    "Set LayoutElement constraints for one explicit UI target in SSOT isolated write pipeline.";

  return {
    name: "set_layout_element",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_layout_element",
      source: "body",
    },
    turnServiceMethod: "setLayoutElementForMcp",
    validate: validateSetLayoutElement,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_layout_element", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_layout_element")
        : fallbackSchema(),
    },
  };
};
