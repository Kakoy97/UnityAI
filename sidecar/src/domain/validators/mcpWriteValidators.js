"use strict";

function legacyWriteRemovedValidation(apiName) {
  return {
    ok: false,
    errorCode: "E_GONE",
    statusCode: 410,
    message: `${apiName} is removed from legacy write pipeline. Use SSOT-generated write tools instead.`,
  };
}

module.exports = {
  validateMcpSubmitUnityTask() {
    return legacyWriteRemovedValidation("submit_unity_task");
  },
  validateMcpApplyScriptActions() {
    return legacyWriteRemovedValidation("apply_script_actions");
  },
  validateMcpApplyVisualActions() {
    return legacyWriteRemovedValidation("apply_visual_actions");
  },
  validateMcpSetUiProperties() {
    return legacyWriteRemovedValidation("set_ui_properties");
  },
  validateFileActionsApply() {
    return legacyWriteRemovedValidation("file-actions/apply");
  },
  validateVisualLayerActionsArray() {
    return legacyWriteRemovedValidation("visual_layer_actions");
  },
};
