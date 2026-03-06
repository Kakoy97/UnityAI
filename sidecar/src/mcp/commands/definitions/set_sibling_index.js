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
  const validateSetSiblingIndex =
    typeof source.validateSetSiblingIndex === "function"
      ? source.validateSetSiblingIndex
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
    "Set sibling order index for one explicit object in SSOT isolated write pipeline.";

  return {
    name: "set_sibling_index",
    kind: "write",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/set_sibling_index", source: "body" },
    turnServiceMethod: "setSiblingIndexForMcp",
    validate: validateSetSiblingIndex,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("set_sibling_index", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("set_sibling_index")
        : fallbackSchema(),
    },
  };
};
