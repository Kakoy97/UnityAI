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
  const validateGetHierarchySubtree =
    typeof source.validateGetHierarchySubtree === "function"
      ? source.validateGetHierarchySubtree
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
    "Read hierarchy subtree for an explicit target anchor via SSOT isolated query pipeline.";

  return {
    name: "get_hierarchy_subtree",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_hierarchy_subtree",
      source: "body",
    },
    turnServiceMethod: "getHierarchySubtreeSsotForMcp",
    validate: validateGetHierarchySubtree,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_hierarchy_subtree", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_hierarchy_subtree")
        : fallbackSchema(),
    },
  };
};
