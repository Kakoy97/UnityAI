"use strict";

const legacy = require("./legacyTurnUtils");

module.exports = {
  normalizeErrorCode: legacy.normalizeErrorCode,
  sanitizeMcpErrorMessage: legacy.sanitizeMcpErrorMessage,
  normalizeUnityActionFailureCode: legacy.normalizeUnityActionFailureCode,
  normalizeUnityQueryErrorCode: legacy.normalizeUnityQueryErrorCode,
};
