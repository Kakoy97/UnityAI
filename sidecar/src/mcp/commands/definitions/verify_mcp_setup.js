"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateVerifyMcpSetup =
    typeof source.validateVerifyMcpSetup === "function"
      ? source.validateVerifyMcpSetup
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
    "Verify Cursor MCP setup readiness via SSOT-generated schema.";

  return {
    name: "verify_mcp_setup",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/verify_mcp_setup",
      source: "body",
    },
    validate: validateVerifyMcpSetup,
    turnServiceMethod: "verifyMcpSetupForMcp",
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool("verify_mcp_setup", fallbackDescription)
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("verify_mcp_setup")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
