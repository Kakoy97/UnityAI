"use strict";

function executeGetActionCatalog(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const capabilityStore =
    ctx.capabilityStore && typeof ctx.capabilityStore === "object"
      ? ctx.capabilityStore
      : null;
  if (!capabilityStore || typeof capabilityStore.getActionCatalog !== "function") {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error_code: "E_INTERNAL",
        message: "Capability store is unavailable",
      },
    };
  }

  const catalog = capabilityStore.getActionCatalog(payload);
  if (!catalog.ok && catalog.reason === "capability_mismatch") {
    return {
      statusCode: 409,
      body: {
        ok: false,
        error_code: "E_ACTION_CAPABILITY_MISMATCH",
        message: "catalog_version does not match current capability_version",
        suggestion:
          "Refresh tools/list to sync latest Unity capabilities, then retry get_action_catalog.",
        recoverable: true,
        ...capabilityStore.getSnapshot(),
      },
    };
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      ...catalog,
    },
  };
}

module.exports = {
  executeGetActionCatalog,
};
