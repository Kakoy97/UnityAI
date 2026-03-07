"use strict";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// R20/V3: suggestion templates are governed by errorFeedbackTemplateRegistry + SSOT contract.
// Validators no longer carry suggestion text to avoid multi-source drift.
const FIXED_ERROR_SUGGESTION_BY_CODE = Object.freeze({});

function enforceFixedErrorSuggestion(errorCode, suggestion) {
  void errorCode;
  const normalizedSuggestion = isNonEmptyString(suggestion)
    ? String(suggestion).trim()
    : "";
  return {
    suggestion: normalizedSuggestion,
    enforced: false,
  };
}

module.exports = {
  FIXED_ERROR_SUGGESTION_BY_CODE,
  enforceFixedErrorSuggestion,
};
