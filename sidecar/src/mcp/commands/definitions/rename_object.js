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
  const validateRenameObject =
    typeof source.validateRenameObject === "function"
      ? source.validateRenameObject
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
    "Rename one explicit object by anchor in SSOT isolated write pipeline.";

  return {
    name: "rename_object",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/rename_object", source: "body" },
    turnServiceMethod: "renameObjectForMcp",
    validate: validateRenameObject,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("rename_object", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("rename_object")
        : fallbackSchema(),
    },
  };
};
