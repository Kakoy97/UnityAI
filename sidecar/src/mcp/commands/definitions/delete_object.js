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
  const validateDeleteObject =
    typeof source.validateDeleteObject === "function"
      ? source.validateDeleteObject
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
    "Delete one explicit target object in SSOT isolated write pipeline.";

  return {
    name: "delete_object",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/delete_object", source: "body" },
    turnServiceMethod: "deleteObjectForMcp",
    validate: validateDeleteObject,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("delete_object", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("delete_object")
        : fallbackSchema(),
    },
  };
};
