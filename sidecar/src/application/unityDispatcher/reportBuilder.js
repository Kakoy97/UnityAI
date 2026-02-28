"use strict";

const {
  cloneJson,
  normalizeErrorCode,
} = require("../../utils/turnUtils");

function buildExecutionReport(runtime, extra, nowIso) {
  const details = extra && typeof extra === "object" ? extra : {};
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

