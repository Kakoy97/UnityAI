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
  const validateAddComponent =
    typeof source.validateAddComponent === "function"
      ? source.validateAddComponent
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
    "Add one explicit component to one explicit target object in SSOT isolated write pipeline.";

  return {
    name: "add_component",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/add_component", source: "body" },
    turnServiceMethod: "addComponentForMcp",
    validate: validateAddComponent,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("add_component", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("add_component")
        : fallbackSchema(),
    },
  };
};
