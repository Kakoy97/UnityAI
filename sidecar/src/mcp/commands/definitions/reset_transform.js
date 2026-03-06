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
  const validateResetTransform =
    typeof source.validateResetTransform === "function"
      ? source.validateResetTransform
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
    "Reset local transform (position, rotation, scale) for one explicit target in SSOT isolated write pipeline.";

  return {
    name: "reset_transform",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/reset_transform", source: "body" },
    turnServiceMethod: "resetTransformForMcp",
    validate: validateResetTransform,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("reset_transform", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("reset_transform")
        : fallbackSchema(),
    },
  };
};
