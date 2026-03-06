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
  const validateDuplicateObject =
    typeof source.validateDuplicateObject === "function"
      ? source.validateDuplicateObject
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
    "Duplicate one explicit target object in SSOT isolated write pipeline.";

  return {
    name: "duplicate_object",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/duplicate_object", source: "body" },
    turnServiceMethod: "duplicateObjectForMcp",
    validate: validateDuplicateObject,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("duplicate_object", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("duplicate_object")
        : fallbackSchema(),
    },
  };
};
