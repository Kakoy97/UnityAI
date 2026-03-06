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
  const validateCreateObject =
    typeof source.validateCreateObject === "function"
      ? source.validateCreateObject
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
    "Create one explicit object under one explicit parent in SSOT isolated write pipeline.";

  return {
    name: "create_object",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/create_object", source: "body" },
    turnServiceMethod: "createObjectForMcp",
    validate: validateCreateObject,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("create_object", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("create_object")
        : fallbackSchema(),
    },
  };
};
