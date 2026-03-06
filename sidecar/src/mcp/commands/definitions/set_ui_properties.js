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
  const validateSetUiProperties =
    typeof source.validateSetUiProperties === "function"
      ? source.validateSetUiProperties
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
    "Set UI properties with deterministic contract in SSOT isolated write pipeline.";

  return {
    name: "set_ui_properties",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_ui_properties", source: "body" },
    turnServiceMethod: "setUiPropertiesForMcp",
    validate: validateSetUiProperties,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_ui_properties", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_ui_properties")
        : fallbackSchema(),
    },
  };
};
