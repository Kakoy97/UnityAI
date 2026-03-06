"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateCancelUnityTask =
    typeof source.validateCancelUnityTask === "function"
      ? source.validateCancelUnityTask
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
    "Cancel one queued/running Unity task by job_id via SSOT schema.";

  return {
    name: "cancel_unity_task",
    kind: "status",
    lifecycle: "stable",
    http: { method: "POST", path: "/mcp/cancel_unity_task", source: "body" },
    turnServiceMethod: "cancelUnityTaskForMcp",
    validate: validateCancelUnityTask,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("cancel_unity_task", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("cancel_unity_task")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
