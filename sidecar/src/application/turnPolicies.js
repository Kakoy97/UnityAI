/**
 * R10-ARCH-01 Responsibility boundary:
 * - This module only defines cross-cutting policy helpers.
 * - Error-feedback template catalog moved to errorFeedbackTemplateRegistry.
 */

"use strict";

const {
  resolveSchemaIssueClassification,
} = require("./schemaIssueClassifier");

const ERROR_SCHEMA_HINT_MAX_CHARS = 0;

const AUTO_CANCEL_ERROR_CODES = Object.freeze([
  "E_JOB_HEARTBEAT_TIMEOUT",
  "E_JOB_MAX_RUNTIME_EXCEEDED",
  "E_WAITING_FOR_UNITY_REBOOT_TIMEOUT",
]);

const AUTO_CANCEL_ERROR_MESSAGES = Object.freeze({
  E_JOB_HEARTBEAT_TIMEOUT:
    "Job lease heartbeat timed out. Job auto-cancelled.",
  E_JOB_MAX_RUNTIME_EXCEEDED:
    "Job runtime exceeded max_runtime_ms. Job auto-cancelled.",
  E_WAITING_FOR_UNITY_REBOOT_TIMEOUT:
    "Waiting for unity.runtime.ping exceeded reboot_wait_timeout_ms. Job auto-cancelled.",
});

function withAbortTimeout(promise, controller, timeoutMs, message) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        if (controller && typeof controller.abort === "function") {
          controller.abort();
        }
      } catch {
        // ignore abort errors
      }
      reject(new Error(message || `operation timed out after ${ms}ms`));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isUnityRebootWaitErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) {
    return false;
  }
  return (
    code === "WAITING_FOR_UNITY_REBOOT" ||
    code === "E_WAITING_FOR_UNITY_REBOOT"
  );
}

function normalizePolicyErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return code || "E_INTERNAL";
}

function isAutoCancelErrorCode(value) {
  const code = normalizePolicyErrorCode(value);
  return AUTO_CANCEL_ERROR_CODES.includes(code);
}

function resolveAutoCancelErrorMessage(errorCode) {
  const code = normalizePolicyErrorCode(errorCode);
  return AUTO_CANCEL_ERROR_MESSAGES[code] || "";
}

module.exports = {
  AUTO_CANCEL_ERROR_CODES,
  AUTO_CANCEL_ERROR_MESSAGES,
  withAbortTimeout,
  isUnityRebootWaitErrorCode,
  isAutoCancelErrorCode,
  resolveAutoCancelErrorMessage,
  resolveSchemaIssueClassification,
  ERROR_SCHEMA_HINT_MAX_CHARS,
};
