"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateQueryPrefabInfo =
    typeof source.validateQueryPrefabInfo === "function"
      ? source.validateQueryPrefabInfo
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
    "Inspect prefab hierarchy structure with explicit depth and budget controls via SSOT isolated query pipeline.";

  return {
    name: "query_prefab_info",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/query_prefab_info", source: "body" },
    turnServiceMethod: "queryPrefabInfoForMcp",
    validate: validateQueryPrefabInfo,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("query_prefab_info", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("query_prefab_info")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
