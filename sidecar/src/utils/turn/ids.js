"use strict";

const legacy = require("./legacyTurnUtils");

module.exports = {
  normalizeRequestId: legacy.normalizeRequestId,
  normalizeNonEmptyString: legacy.normalizeNonEmptyString,
  normalizeObjectId: legacy.normalizeObjectId,
  createSplitWriteIdempotencyKey: legacy.createSplitWriteIdempotencyKey,
  createReadTokenValue: legacy.createReadTokenValue,
  createUnityQueryId: legacy.createUnityQueryId,
  createMcpJobId: legacy.createMcpJobId,
  createMcpRequestId: legacy.createMcpRequestId,
  createMcpTurnId: legacy.createMcpTurnId,
};

