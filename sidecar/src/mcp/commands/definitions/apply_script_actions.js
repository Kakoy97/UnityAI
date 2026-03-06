"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateApplyScriptActions =
    typeof source.validateApplyScriptActions === "function"
      ? source.validateApplyScriptActions
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
    "Apply script/file actions via SSOT-generated write schema.";

  return {
    name: "apply_script_actions",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/apply_script_actions", source: "body" },
    turnServiceMethod: "applyScriptActionsForMcp",
    validate: validateApplyScriptActions,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("apply_script_actions", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("apply_script_actions")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
