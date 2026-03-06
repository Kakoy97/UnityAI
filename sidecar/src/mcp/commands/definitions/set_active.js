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
  const validateSetActive =
    typeof source.validateSetActive === "function"
      ? source.validateSetActive
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
    "Set active state for one explicit object in SSOT isolated write pipeline.";

  return {
    name: "set_active",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_active", source: "body" },
    turnServiceMethod: "setActiveForMcp",
    validate: validateSetActive,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_active", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_active")
        : fallbackSchema(),
    },
  };
};
