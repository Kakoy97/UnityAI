"use strict";

const legacy = require("./legacyValidators");

module.exports = {
  validateMcpSubmitUnityTask: legacy.validateMcpSubmitUnityTask,
  validateMcpApplyScriptActions: legacy.validateMcpApplyScriptActions,
  validateMcpApplyVisualActions: legacy.validateMcpApplyVisualActions,
  validateMcpSetUiProperties: legacy.validateMcpSetUiProperties,
  validateFileActionsApply: legacy.validateFileActionsApply,
  validateVisualLayerActionsArray: legacy.validateVisualLayerActionsArray,
};

