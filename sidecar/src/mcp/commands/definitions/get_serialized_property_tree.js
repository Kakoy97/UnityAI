"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetSerializedPropertyTree =
    typeof source.validateGetSerializedPropertyTree === "function"
      ? source.validateGetSerializedPropertyTree
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
    "Read SerializedProperty tree via SSOT isolated query pipeline.";

  return {
    name: "get_serialized_property_tree",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_serialized_property_tree",
      source: "body",
    },
    turnServiceMethod: "getSerializedPropertyTreeForMcp",
    validate: validateGetSerializedPropertyTree,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "get_serialized_property_tree",
            fallbackDescription
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_serialized_property_tree")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};

