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
  const validateSetWorldRotation =
    typeof source.validateSetWorldRotation === "function"
      ? source.validateSetWorldRotation
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
    "Set world Euler rotation for one explicit target transform in SSOT isolated write pipeline.";

  return {
    name: "set_world_rotation",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_world_rotation", source: "body" },
    turnServiceMethod: "setWorldRotationForMcp",
    validate: validateSetWorldRotation,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_world_rotation", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_world_rotation")
        : fallbackSchema(),
    },
  };
};
