"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetActionSchema =
    typeof source.validateGetActionSchema === "function"
      ? source.validateGetActionSchema
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
    "Get static SSOT schema fragment by action_type.";

  return {
    name: "get_action_schema",
    kind: "read",
    lifecycle: "experimental",
    http: { method: "POST", path: "/mcp/get_action_schema", source: "body" },
    turnServiceMethod: "getActionSchemaForMcp",
    validate: validateGetActionSchema,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_action_schema", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_action_schema")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
