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
  const validateSetComponentProperties =
    typeof source.validateSetComponentProperties === "function"
      ? source.validateSetComponentProperties
      : null;
  const getSsotInputSchemaForTool =
    typeof source.getSsotInputSchemaForTool === "function"
      ? source.getSsotInputSchemaForTool
      : null;

  return {
    name: "set_component_properties",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/set_component_properties",
      source: "body",
    },
    turnServiceMethod: "setComponentPropertiesForMcp",
    validate: validateSetComponentProperties,
    mcp: {
      expose: true,
      description:
        "Set one explicit component property on one explicit target object. This route is SSOT-isolated and never falls back to non-SSOT pipeline.",
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_component_properties")
        : fallbackSchema(),
    },
  };
};
