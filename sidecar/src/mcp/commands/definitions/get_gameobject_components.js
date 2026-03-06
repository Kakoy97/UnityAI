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
  const validateGetGameobjectComponents =
    typeof source.validateGetGameobjectComponents === "function"
      ? source.validateGetGameobjectComponents
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
    "Read component list for an explicit target anchor via SSOT isolated query pipeline.";

  return {
    name: "get_gameobject_components",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_gameobject_components",
      source: "body",
    },
    turnServiceMethod: "getGameObjectComponentsSsotForMcp",
    validate: validateGetGameobjectComponents,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_gameobject_components", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_gameobject_components")
        : fallbackSchema(),
    },
  };
};
