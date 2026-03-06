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
  const validateSetLocalScale =
    typeof source.validateSetLocalScale === "function"
      ? source.validateSetLocalScale
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
    "Set local scale for one explicit target transform in SSOT isolated write pipeline.";

  return {
    name: "set_local_scale",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_local_scale", source: "body" },
    turnServiceMethod: "setLocalScaleForMcp",
    validate: validateSetLocalScale,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_local_scale", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_local_scale")
        : fallbackSchema(),
    },
  };
};
