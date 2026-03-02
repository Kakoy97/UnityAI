"use strict";

const legacy = require("./legacyTurnUtils");

module.exports = {
  normalizeErrorCode: legacy.normalizeErrorCode,
  sanitizeMcpErrorMessage: legacy.sanitizeMcpErrorMessage,
  normalizeErrorSuggestionByCode: legacy.normalizeErrorSuggestionByCode,
  normalizeUnityActionFailureCode: legacy.normalizeUnityActionFailureCode,
  normalizeUnityQueryErrorCode: legacy.normalizeUnityQueryErrorCode,
  mapMcpErrorFeedback: legacy.mapMcpErrorFeedback,
};

