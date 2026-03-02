"use strict";

const legacy = require("./legacyTurnUtils");

module.exports = {
  normalizeApprovalMode: legacy.normalizeApprovalMode,
  toOptionalBoolean: legacy.toOptionalBoolean,
  normalizeMcpJobSnapshotItem: legacy.normalizeMcpJobSnapshotItem,
  normalizeMcpJobStatus: legacy.normalizeMcpJobStatus,
  sameJson: legacy.sameJson,
  normalizeMcpStreamEventType: legacy.normalizeMcpStreamEventType,
  mapTurnStateToMcpStatus: legacy.mapTurnStateToMcpStatus,
  isTerminalMcpStatus: legacy.isTerminalMcpStatus,
};

