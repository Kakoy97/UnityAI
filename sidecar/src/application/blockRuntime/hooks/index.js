"use strict";

const {
  VERIFY_HOOK_VERSION,
  VERIFY_STATUS,
  createVerifyHook,
} = require("./VerifyHook");
const {
  RECOVERY_HOOK_VERSION,
  RECOVERY_OUTCOME,
  RECOVERY_ALLOWLIST,
  createRecoveryHook,
} = require("./RecoveryHook");

module.exports = {
  VERIFY_HOOK_VERSION,
  VERIFY_STATUS,
  createVerifyHook,
  RECOVERY_HOOK_VERSION,
  RECOVERY_OUTCOME,
  RECOVERY_ALLOWLIST,
  createRecoveryHook,
};
