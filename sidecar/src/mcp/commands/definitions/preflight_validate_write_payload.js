"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validatePreflightValidateWritePayload =
    typeof source.validatePreflightValidateWritePayload === "function"
      ? source.validatePreflightValidateWritePayload
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
    "Validate write payload preflight via SSOT schema without Unity dispatch.";

  return {
    name: "preflight_validate_write_payload",
    kind: "read",
    lifecycle: "stable",
    http: {
      method: "POST",
      path: "/mcp/preflight_validate_write_payload",
      source: "body",
    },
    turnServiceMethod: "preflightValidateWritePayloadForMcp",
    validate: validatePreflightValidateWritePayload,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "preflight_validate_write_payload",
            fallbackDescription
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("preflight_validate_write_payload")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
