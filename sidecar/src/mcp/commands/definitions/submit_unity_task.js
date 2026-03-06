"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateSubmitUnityTask =
    typeof source.validateSubmitUnityTask === "function"
      ? source.validateSubmitUnityTask
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
    "Submit one async Unity write task via SSOT-generated schema.";

  return {
    name: "submit_unity_task",
    kind: "write",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/submit_unity_task", source: "body" },
    turnServiceMethod: "submitUnityTaskForMcp",
    validate: validateSubmitUnityTask,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("submit_unity_task", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("submit_unity_task")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
