"use strict";

module.exports = function buildDefinition(deps) {
  const source = deps && typeof deps === "object" ? deps : {};
  const validateGetWriteContractBundle =
    typeof source.validateGetWriteContractBundle === "function"
      ? source.validateGetWriteContractBundle
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
    "Aggregate write contract guidance via SSOT contract for authoring.";

  return {
    name: "get_write_contract_bundle",
    kind: "read",
    lifecycle: "experimental",
    http: {
      method: "POST",
      path: "/mcp/get_write_contract_bundle",
      source: "body",
    },
    turnServiceMethod: "getWriteContractBundleForMcp",
    validate: validateGetWriteContractBundle,
    mcp: {
      expose: true,
      description: getSsotToolDescriptionForTool
        ? getSsotToolDescriptionForTool(
            "get_write_contract_bundle",
            fallbackDescription
          )
        : fallbackDescription,
      inputSchema: getSsotInputSchemaForTool
        ? getSsotInputSchemaForTool("get_write_contract_bundle")
        : {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
    },
  };
};
