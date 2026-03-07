"use strict";

const { normalizeErrorCode } = require("../../utils/turnUtils");

const SSOT_ERROR_CODE_ALIAS_TO_CANONICAL = Object.freeze({
  // L3 historical alias from save_prefab executor.
  E_OBJECT_NOT_FOUND: "E_TARGET_NOT_FOUND",
  // L3 get_current_selection empty-state alias; L2 template already uses E_SELECTION_UNAVAILABLE.
  E_SELECTION_EMPTY: "E_SELECTION_UNAVAILABLE",
  // Generic Unity query-handler failure should map to SSOT route failure taxonomy in L2.
  E_QUERY_HANDLER_FAILED: "E_SSOT_ROUTE_FAILED",
});

function normalizeSsotErrorCodeForMcp(errorCode) {
  const normalized = normalizeErrorCode(errorCode, "E_SSOT_ROUTE_FAILED");
  return SSOT_ERROR_CODE_ALIAS_TO_CANONICAL[normalized] || normalized;
}

module.exports = {
  SSOT_ERROR_CODE_ALIAS_TO_CANONICAL,
  normalizeSsotErrorCodeForMcp,
};

