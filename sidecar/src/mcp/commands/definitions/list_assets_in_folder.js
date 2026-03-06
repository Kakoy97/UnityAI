"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateListAssetsInFolder =
    typeof source.validateListAssetsInFolder === "function"
      ? source.validateListAssetsInFolder
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
    "List Unity assets under one explicit folder path via SSOT isolated query pipeline.";

  return {
    name: "list_assets_in_folder",
    kind: "read",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/list_assets_in_folder", source: "body" },
    turnServiceMethod: "listAssetsInFolderForMcp",
    validate: validateListAssetsInFolder,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("list_assets_in_folder", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("list_assets_in_folder")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
