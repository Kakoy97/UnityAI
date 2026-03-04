"use strict";

const impl = require("./_unityCallbackValidatorsImpl");

module.exports = {
  validateUnityCompileResult: impl.validateUnityCompileResult,
  validateUnityActionResult: impl.validateUnityActionResult,
  validateUnityRuntimePing: impl.validateUnityRuntimePing,
  validateUnityCapabilitiesReport: impl.validateUnityCapabilitiesReport,
  validateUnitySelectionSnapshot: impl.validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot: impl.validateUnityConsoleSnapshot,
};
