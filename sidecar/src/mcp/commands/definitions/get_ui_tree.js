"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetUiTree =
    typeof source.validateGetUiTree === "function"
      ? source.validateGetUiTree
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
    "Read structured UI tree for deterministic targeting via SSOT isolated query pipeline.";

  return {
    name: "get_ui_tree",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_ui_tree",
      source: "body",
    },
    turnServiceMethod: "getUiTreeForMcp",
    validate: validateGetUiTree,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_ui_tree", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_ui_tree")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
