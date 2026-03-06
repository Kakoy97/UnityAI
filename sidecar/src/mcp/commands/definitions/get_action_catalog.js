"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetActionCatalog =
    typeof source.validateGetActionCatalog === "function"
      ? source.validateGetActionCatalog
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
    "Get paged action capability index via SSOT contract.";

  return {
    name: "get_action_catalog",
    kind: "read",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/get_action_catalog", source: "body" },
    turnServiceMethod: "getActionCatalogForMcp",
    validate: validateGetActionCatalog,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_action_catalog", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_action_catalog")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
