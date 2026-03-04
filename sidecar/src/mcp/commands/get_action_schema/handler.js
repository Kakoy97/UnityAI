"use strict";

const {
  buildActionSchemaUsabilityPack,
} = require("../../../application/writeContractBundle");
const {
  createCapabilityActionContractRegistry,
} = require("../../../domain/actionContractRegistry");

function executeGetActionSchema(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const capabilityStore =
    ctx.capabilityStore && typeof ctx.capabilityStore === "object"
      ? ctx.capabilityStore
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

  const actionType =
    typeof payload.action_type === "string" ? payload.action_type.trim() : "";
  const schema = capabilityStore.getActionSchema({
    action_type: actionType,
    catalog_version: payload.catalog_version,
    if_none_match: payload.if_none_match,
  });
  if (!schema.ok && schema.reason === "capability_mismatch") {
    return {
      statusCode: 409,
      body: {
        ok: false,
        error_code: "E_ACTION_CAPABILITY_MISMATCH",
        message: "catalog_version does not match current capability_version",
        suggestion:
          "Refresh tools/list to sync latest Unity capabilities, then retry get_action_schema.",
        recoverable: true,
        action_type: actionType,
        ...capabilityStore.getSnapshot(),
      },
    };
  }
  if (!schema.ok && schema.reason === "action_not_found") {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error_code: "E_ACTION_SCHEMA_NOT_FOUND",
        message: `Action schema not found for '${actionType}'`,
        suggestion:
          "Call get_action_catalog to inspect available action types, then retry get_action_schema with a valid action_type.",
        recoverable: true,
        action_type: actionType,
        ...capabilityStore.getSnapshot(),
      },
    };
  }

  let actionCapability =
    schema && schema.action && typeof schema.action === "object"
      ? schema.action
      : null;
  if (!actionCapability && schema.ok && schema.not_modified === true) {
    const uncached = capabilityStore.getActionSchema({
      action_type: actionType,
      catalog_version: payload.catalog_version,
    });
    if (uncached && uncached.ok && uncached.action && typeof uncached.action === "object") {
      actionCapability = uncached.action;
    }
  }
  const actionContractRegistry = createCapabilityActionContractRegistry(
    capabilityStore
  );
  const usabilityPack = buildActionSchemaUsabilityPack({
    actionType,
    action: actionCapability || {},
    actionContractRegistry,
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      action_type: actionType,
      ...schema,
      ...usabilityPack,
    },
  };
}

module.exports = {
  executeGetActionSchema,
};
