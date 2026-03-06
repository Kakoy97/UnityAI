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
  const validateSetLocalRotation =
    typeof source.validateSetLocalRotation === "function"
      ? source.validateSetLocalRotation
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
    "Set local Euler rotation for one explicit target transform in SSOT isolated write pipeline.";

  return {
    name: "set_local_rotation",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_local_rotation", source: "body" },
    turnServiceMethod: "setLocalRotationForMcp",
    validate: validateSetLocalRotation,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_local_rotation", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_local_rotation")
        : fallbackSchema(),
    },
  };
};
