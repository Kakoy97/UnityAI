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
  const validateSetLocalPosition =
    typeof source.validateSetLocalPosition === "function"
      ? source.validateSetLocalPosition
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
    "Set local position for one explicit target transform in SSOT isolated write pipeline.";

  return {
    name: "set_local_position",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_local_position", source: "body" },
    turnServiceMethod: "setLocalPositionForMcp",
    validate: validateSetLocalPosition,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_local_position", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_local_position")
        : fallbackSchema(),
    },
  };
};
