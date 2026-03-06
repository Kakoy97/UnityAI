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
  const validateSetSerializedProperty =
    typeof source.validateSetSerializedProperty === "function"
      ? source.validateSetSerializedProperty
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
    "Set one explicit SerializedProperty path on one explicit component instance in SSOT isolated write pipeline.";

  return {
    name: "set_serialized_property",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_serialized_property", source: "body" },
    turnServiceMethod: "setSerializedPropertyForMcp",
    validate: validateSetSerializedProperty,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_serialized_property", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_serialized_property")
        : fallbackSchema(),
    },
  };
};
