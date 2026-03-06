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
  const validateSetParent =
    typeof source.validateSetParent === "function"
      ? source.validateSetParent
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
    "Reparent one explicit object under one explicit parent in SSOT isolated write pipeline.";

  return {
    name: "set_parent",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_parent", source: "body" },
    turnServiceMethod: "setParentForMcp",
    validate: validateSetParent,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_parent", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_parent")
        : fallbackSchema(),
    },
  };
};
