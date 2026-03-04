"use strict";

const {
  buildWriteContractBundle,
  normalizeBudgetChars,
} = require("../../../application/writeContractBundle");
const {
  createCapabilityActionContractRegistry,
} = require("../../../domain/actionContractRegistry");

function executeGetWriteContractBundle(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload = requestBody && typeof requestBody === "object" ? requestBody : {};
  const capabilityStore =
    ctx.capabilityStore && typeof ctx.capabilityStore === "object"
      ? ctx.capabilityStore
      : null;
  const registry =
    ctx.commandRegistry && typeof ctx.commandRegistry === "object"
      ? ctx.commandRegistry
      : null;

  if (!capabilityStore || typeof capabilityStore.getActionSchema !== "function") {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error_code: "E_INTERNAL",
        message: "Capability store is unavailable",
      },
    };
  }
  if (!registry || typeof registry.getToolMetadataByName !== "function") {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error_code: "E_INTERNAL",
        message: "Command registry is unavailable",
      },
    };
  }

  const toolName =
    typeof payload.tool_name === "string" && payload.tool_name.trim()
      ? payload.tool_name.trim()
      : "apply_visual_actions";
  const actionType =
    typeof payload.action_type === "string" && payload.action_type.trim()
      ? payload.action_type.trim()
      : "rename_object";
  const catalogVersion =
    typeof payload.catalog_version === "string" ? payload.catalog_version : "";

  const toolMetadata = registry.getToolMetadataByName(toolName, ctx);
  if (!toolMetadata) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error_code: "E_TOOL_SCHEMA_NOT_FOUND",
        message: `Tool schema not found for '${toolName}'`,
        suggestion:
          "Call tools/list to inspect visible tool names, then retry get_write_contract_bundle with a valid tool_name.",
        recoverable: true,
      },
    };
  }

  const actionSchema = capabilityStore.getActionSchema({
    action_type: actionType,
    catalog_version: catalogVersion,
  });
  if (!actionSchema.ok && actionSchema.reason === "capability_mismatch") {
    return {
      statusCode: 409,
      body: {
        ok: false,
        error_code: "E_ACTION_CAPABILITY_MISMATCH",
        message: "catalog_version does not match current capability_version",
        suggestion:
          "Refresh tools/list to sync latest Unity capabilities, then retry get_write_contract_bundle.",
        recoverable: true,
        tool_name: toolName,
        action_type: actionType,
        ...capabilityStore.getSnapshot(),
      },
    };
  }
  if (!actionSchema.ok && actionSchema.reason === "action_not_found") {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error_code: "E_ACTION_SCHEMA_NOT_FOUND",
        message: `Action schema not found for '${actionType}'`,
        suggestion:
          "Call get_action_catalog to inspect available action types, then retry get_write_contract_bundle with a valid action_type.",
        recoverable: true,
        tool_name: toolName,
        action_type: actionType,
      },
    };
  }

  const actionContractRegistry = createCapabilityActionContractRegistry(
    capabilityStore
  );
  const actionContract =
    actionContractRegistry &&
    typeof actionContractRegistry.resolveActionContract === "function"
      ? actionContractRegistry.resolveActionContract(actionType)
      : null;

  const bundle = buildWriteContractBundle({
    toolName,
    actionType,
    anchorPolicy:
      actionSchema && actionSchema.action && typeof actionSchema.action === "object"
        ? actionSchema.action.anchor_policy
        : "",
    action:
      actionSchema && actionSchema.action && typeof actionSchema.action === "object"
        ? actionSchema.action
        : {},
    actionContract,
    actionContractRegistry,
    actionSchema,
    toolMetadata,
    budget_chars: payload.budget_chars,
    include_error_fix_map: payload.include_error_fix_map,
    include_canonical_examples: payload.include_canonical_examples,
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      tool_name: toolName,
      action_type: actionType,
      bundle_budget_chars: normalizeBudgetChars(payload.budget_chars),
      ...bundle,
    },
  };
}

module.exports = {
  executeGetWriteContractBundle,
};
