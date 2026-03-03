"use strict";

const {
  cloneJson,
  normalizeErrorCode,
} = require("../../utils/turnUtils");
const {
  normalizeWriteReceipt,
  summarizeWriteReceipt,
} = require("../writeReceiptFormatter");

function buildExecutionReport(runtime, extra, nowIso) {
  const details = extra && typeof extra === "object" ? extra : {};
  const rawWriteReceipt =
    details.action_write_receipt && typeof details.action_write_receipt === "object"
      ? cloneJson(details.action_write_receipt)
      : runtime &&
          runtime.last_action_result &&
          typeof runtime.last_action_result === "object" &&
          runtime.last_action_result.write_receipt &&
          typeof runtime.last_action_result.write_receipt === "object"
        ? cloneJson(runtime.last_action_result.write_receipt)
        : null;
  const actionWriteReceipt = normalizeWriteReceipt(rawWriteReceipt);
  return {
    outcome: typeof details.outcome === "string" ? details.outcome : "completed",
    reason: typeof details.reason === "string" ? details.reason : "",
    compile_success:
      typeof details.compile_success === "boolean" ? details.compile_success : true,
    action_success:
      typeof details.action_success === "boolean" ? details.action_success : true,
    files_changed: Array.isArray(details.files_changed)
      ? cloneJson(details.files_changed)
      : Array.isArray(runtime.files_changed)
        ? cloneJson(runtime.files_changed)
        : [],
    compile_errors: Array.isArray(details.compile_errors)
      ? cloneJson(details.compile_errors)
      : [],
    action_error:
      details.action_error && typeof details.action_error === "object"
        ? cloneJson(details.action_error)
        : null,
    action_result_data:
      details.action_result_data && typeof details.action_result_data === "object"
        ? cloneJson(details.action_result_data)
        : runtime &&
            runtime.last_action_result &&
            typeof runtime.last_action_result === "object" &&
            runtime.last_action_result.result_data &&
            typeof runtime.last_action_result.result_data === "object"
          ? cloneJson(runtime.last_action_result.result_data)
          : null,
    action_write_receipt: actionWriteReceipt,
    action_write_receipt_summary: summarizeWriteReceipt(actionWriteReceipt),
    verification: {
      mode: "reserved",
      diff: null,
      verification_passed: true,
    },
    finished_at: nowIso(),
  };
}

function failedTransition(runtime, errorCode, message, extra, nowIso) {
  const code = normalizeErrorCode(errorCode, "E_INTERNAL");
  const msg =
    typeof message === "string" && message.trim()
      ? message.trim()
      : "Unknown failure";
  const details = extra && typeof extra === "object" ? extra : {};
  return {
    kind: "failed",
    runtime,
    error_code: code,
    error_message: msg,
    execution_report: buildExecutionReport(
      runtime,
      {
        outcome: "failed",
        reason: typeof details.reason === "string" ? details.reason : "execution_failed",
        compile_success:
          typeof details.compile_success === "boolean"
            ? details.compile_success
            : runtime.compile_success !== false,
        action_success:
          typeof details.action_success === "boolean" ? details.action_success : false,
        compile_errors: Array.isArray(details.compile_errors)
          ? cloneJson(details.compile_errors)
          : [],
        files_changed: Array.isArray(details.files_changed)
          ? cloneJson(details.files_changed)
          : runtime.files_changed,
        action_error:
          details.action_error && typeof details.action_error === "object"
            ? cloneJson(details.action_error)
            : null,
      },
      nowIso
    ),
  };
}

module.exports = {
  buildExecutionReport,
  failedTransition,
};
