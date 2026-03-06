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
  const validateRemoveComponent =
    typeof source.validateRemoveComponent === "function"
      ? source.validateRemoveComponent
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
    "Remove one explicit component from one explicit target object in SSOT isolated write pipeline.";

  return {
    name: "remove_component",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/remove_component", source: "body" },
    turnServiceMethod: "removeComponentForMcp",
    validate: validateRemoveComponent,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("remove_component", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("remove_component")
        : fallbackSchema(),
    },
  };
};
