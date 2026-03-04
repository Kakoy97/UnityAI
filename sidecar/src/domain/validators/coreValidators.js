"use strict";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const FIXED_ERROR_SUGGESTION_BY_CODE = Object.freeze({
  E_STALE_SNAPSHOT: "请先调用读工具获取最新 token，并仅重试一次写操作。",
});

function enforceFixedErrorSuggestion(errorCode, suggestion) {
  const code = isNonEmptyString(errorCode)
    ? String(errorCode).trim().toUpperCase()
    : "";
  const expected = FIXED_ERROR_SUGGESTION_BY_CODE[code];
  const normalizedSuggestion = isNonEmptyString(suggestion)
    ? String(suggestion).trim()
    : "";
  if (!expected) {
    return {
      suggestion: normalizedSuggestion,
      enforced: false,
    };
  }
  if (normalizedSuggestion !== expected) {
    return {
      suggestion: expected,
      enforced: true,
    };
  }
  return {
    suggestion: expected,
    enforced: false,
  };
}

module.exports = {
  FIXED_ERROR_SUGGESTION_BY_CODE,
  enforceFixedErrorSuggestion,
};
