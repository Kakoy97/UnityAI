"use strict";

const legacy = require("./legacyTurnUtils");

module.exports = {
  normalizeSelectionComponentIndex: legacy.normalizeSelectionComponentIndex,
  findComponentIndexEntryByPath: legacy.findComponentIndexEntryByPath,
  findComponentIndexEntryByObjectId: legacy.findComponentIndexEntryByObjectId,
  findSelectionNodeByPath: legacy.findSelectionNodeByPath,
  findSelectionNodeByObjectId: legacy.findSelectionNodeByObjectId,
  normalizeCompileErrors: legacy.normalizeCompileErrors,
  normalizeConsoleSnapshotErrors: legacy.normalizeConsoleSnapshotErrors,
  buildConsoleErrorEntries: legacy.buildConsoleErrorEntries,
  parseTimestampMs: legacy.parseTimestampMs,
  normalizeComponentAlias: legacy.normalizeComponentAlias,
  cloneJson: legacy.cloneJson,
  resolveSnapshotTarget: legacy.resolveSnapshotTarget,
  mapTargetResolveReasonToPreconditionReason:
    legacy.mapTargetResolveReasonToPreconditionReason,
};

