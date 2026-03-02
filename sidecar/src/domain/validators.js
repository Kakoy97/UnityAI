"use strict";

/**
 * R10-ARCH-01 Responsibility boundary:
 * - This module only validates request/response schema and invariants.
 * - This module must not stringify payloads or mutate transport contracts.
 * - This module must not render MCP error feedback text templates.
 */
/**
 * R11-ARCH-01 Responsibility boundary:
 * - This module owns shared schema validation and invariant checks only.
 * - This module must not register MCP tools, wire HTTP routes, or execute side-effects.
 * - Command policy text/templates belong to policy/feedback modules, not validators.
 * - Command-specific read validators may be duplicated in command modules during migration.
 */

const {
  FIXED_ERROR_SUGGESTION_BY_CODE,
  enforceFixedErrorSuggestion: enforceFixedErrorSuggestionImpl,
} = require("./validators/coreValidators");
const {
  validateMcpSubmitUnityTask: validateMcpSubmitUnityTaskImpl,
  validateMcpApplyScriptActions: validateMcpApplyScriptActionsImpl,
  validateMcpApplyVisualActions: validateMcpApplyVisualActionsImpl,
  validateMcpSetUiProperties: validateMcpSetUiPropertiesImpl,
  validateFileActionsApply: validateFileActionsApplyImpl,
  validateVisualLayerActionsArray: validateVisualLayerActionsArrayImpl,
} = require("./validators/mcpWriteValidators");
const {
  validateMcpGetUnityTaskStatus: validateMcpGetUnityTaskStatusImpl,
  validateMcpCancelUnityTask: validateMcpCancelUnityTaskImpl,
  validateMcpHeartbeat: validateMcpHeartbeatImpl,
} = require("./validators/lifecycleValidators");
const {
  validateMcpListAssetsInFolder: validateMcpListAssetsInFolderImpl,
  validateMcpGetSceneRoots: validateMcpGetSceneRootsImpl,
  validateMcpFindObjectsByComponent: validateMcpFindObjectsByComponentImpl,
  validateMcpQueryPrefabInfo: validateMcpQueryPrefabInfoImpl,
} = require("./validators/readQueryValidators");
const {
  validateUnityCompileResult: validateUnityCompileResultImpl,
  validateUnityActionResult: validateUnityActionResultImpl,
  validateUnityRuntimePing: validateUnityRuntimePingImpl,
  validateUnityCapabilitiesReport: validateUnityCapabilitiesReportImpl,
  validateUnitySelectionSnapshot: validateUnitySelectionSnapshotImpl,
  validateUnityConsoleSnapshot: validateUnityConsoleSnapshotImpl,
} = require("./validators/unityCallbackValidators");

function enforceFixedErrorSuggestion(errorCode, suggestion) {
  return enforceFixedErrorSuggestionImpl(errorCode, suggestion);
}

function validateMcpSubmitUnityTask(body, options) {
  return validateMcpSubmitUnityTaskImpl(body, options);
}

function validateMcpApplyScriptActions(body) {
  return validateMcpApplyScriptActionsImpl(body);
}

function validateMcpApplyVisualActions(body, options) {
  return validateMcpApplyVisualActionsImpl(body, options);
}

function validateMcpSetUiProperties(body) {
  return validateMcpSetUiPropertiesImpl(body);
}

function validateMcpGetUnityTaskStatus(jobId) {
  return validateMcpGetUnityTaskStatusImpl(jobId);
}

function validateMcpCancelUnityTask(body) {
  return validateMcpCancelUnityTaskImpl(body);
}

function validateMcpHeartbeat(body) {
  return validateMcpHeartbeatImpl(body);
}

function validateMcpListAssetsInFolder(body) {
  return validateMcpListAssetsInFolderImpl(body);
}

function validateMcpGetSceneRoots(body) {
  return validateMcpGetSceneRootsImpl(body);
}

function validateMcpFindObjectsByComponent(body) {
  return validateMcpFindObjectsByComponentImpl(body);
}

function validateMcpQueryPrefabInfo(body) {
  return validateMcpQueryPrefabInfoImpl(body);
}

function validateFileActionsApply(body) {
  return validateFileActionsApplyImpl(body);
}

function validateUnityCompileResult(body) {
  return validateUnityCompileResultImpl(body);
}

function validateUnityActionResult(body) {
  return validateUnityActionResultImpl(body);
}

function validateUnityRuntimePing(body) {
  return validateUnityRuntimePingImpl(body);
}

function validateUnityCapabilitiesReport(body) {
  return validateUnityCapabilitiesReportImpl(body);
}

function validateUnitySelectionSnapshot(body) {
  return validateUnitySelectionSnapshotImpl(body);
}

function validateUnityConsoleSnapshot(body) {
  return validateUnityConsoleSnapshotImpl(body);
}

function validateVisualLayerActionsArray(actions, fieldPath, options) {
  return validateVisualLayerActionsArrayImpl(actions, fieldPath, options);
}

module.exports = {
  FIXED_ERROR_SUGGESTION_BY_CODE,
  enforceFixedErrorSuggestion,
  validateMcpSubmitUnityTask,
  validateMcpApplyScriptActions,
  validateMcpApplyVisualActions,
  validateMcpSetUiProperties,
  validateMcpGetUnityTaskStatus,
  validateMcpCancelUnityTask,
  validateMcpHeartbeat,
  validateMcpListAssetsInFolder,
  validateMcpGetSceneRoots,
  validateMcpFindObjectsByComponent,
  validateMcpQueryPrefabInfo,
  validateFileActionsApply,
  validateUnityCompileResult,
  validateUnityActionResult,
  validateUnityRuntimePing,
  validateUnityCapabilitiesReport,
  validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot,
  validateVisualLayerActionsArray,
};
