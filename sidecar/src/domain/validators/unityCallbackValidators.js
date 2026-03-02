"use strict";

const legacy = require("./legacyValidators");

module.exports = {
  validateUnityCompileResult: legacy.validateUnityCompileResult,
  validateUnityActionResult: legacy.validateUnityActionResult,
  validateUnityRuntimePing: legacy.validateUnityRuntimePing,
  validateUnityCapabilitiesReport: legacy.validateUnityCapabilitiesReport,
  validateUnitySelectionSnapshot: legacy.validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot: legacy.validateUnityConsoleSnapshot,
};

