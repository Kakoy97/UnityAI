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
  const validateExecuteUnityTransaction =
    typeof source.validateExecuteUnityTransaction === "function"
      ? source.validateExecuteUnityTransaction
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
    "Execute multiple SSOT write steps atomically in one Undo transaction.";

  return {
    name: "execute_unity_transaction",
    kind: "write",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/execute_unity_transaction",
      source: "body",
    },
    turnServiceMethod: "executeUnityTransactionForMcp",
    validate: validateExecuteUnityTransaction,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "execute_unity_transaction",
            fallbackDescription,
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("execute_unity_transaction")
        : fallbackSchema(),
    },
  };
};
