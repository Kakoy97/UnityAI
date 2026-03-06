"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetUnityTaskStatus =
    typeof source.validateGetUnityTaskStatus === "function"
      ? source.validateGetUnityTaskStatus
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
    "Query one Unity task status by job_id via SSOT-generated schema.";

  return {
    name: "get_unity_task_status",
    kind: "status",
    lifecycle: "stable",
    http: {
      method: "GET",
      path: "/mcp/get_unity_task_status",
      source: "query",
      queryKey: "job_id",
    },
    turnServiceMethod: "getUnityTaskStatusForMcp",
    validate: validateGetUnityTaskStatus,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("get_unity_task_status", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_unity_task_status")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
