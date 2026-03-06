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
  const validateReplaceComponent =
    typeof source.validateReplaceComponent === "function"
      ? source.validateReplaceComponent
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
    "Replace one explicit component type on one explicit target object in SSOT isolated write pipeline.";

  return {
    name: "replace_component",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/replace_component", source: "body" },
    turnServiceMethod: "replaceComponentForMcp",
    validate: validateReplaceComponent,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("replace_component", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("replace_component")
        : fallbackSchema(),
    },
  };
};
