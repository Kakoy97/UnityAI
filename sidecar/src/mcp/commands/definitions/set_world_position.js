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
  const validateSetWorldPosition =
    typeof source.validateSetWorldPosition === "function"
      ? source.validateSetWorldPosition
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
    "Set world position for one explicit target transform in SSOT isolated write pipeline.";

  return {
    name: "set_world_position",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_world_position", source: "body" },
    turnServiceMethod: "setWorldPositionForMcp",
    validate: validateSetWorldPosition,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_world_position", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_world_position")
        : fallbackSchema(),
    },
  };
};
