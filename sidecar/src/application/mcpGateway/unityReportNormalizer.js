"use strict";

const { cloneJson, normalizeUnityActionFailureCode } = require("../../utils/turnUtils");

function normalizeUnityCompileResultBody(gateway, body) {
  const source = body && typeof body === "object" ? cloneJson(body) : {};
  const payload =
    source.payload && typeof source.payload === "object" ? source.payload : null;
  if (!payload) {
    return source;
  }

  payload.success = payload.success === true;
  if (payload.duration_ms !== undefined) {
    const duration = Number(payload.duration_ms);
    payload.duration_ms =
      Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : 0;
  }
  if (!Array.isArray(payload.errors)) {
    payload.errors = [];
  }

  if (payload.success !== true) {
    const firstError =
      payload.errors.length > 0 &&
      payload.errors[0] &&
      typeof payload.errors[0] === "object"
        ? payload.errors[0]
        : null;
    const feedback = gateway.withMcpErrorFeedback({
      status: "failed",
      error_code:
        typeof payload.error_code === "string" && payload.error_code.trim()
          ? payload.error_code.trim()
          : firstError && typeof firstError.code === "string" && firstError.code.trim()
            ? firstError.code.trim()
            : "E_COMPILE_FAILED",
      message:
        typeof payload.error_message === "string" && payload.error_message.trim()
          ? payload.error_message.trim()
          : firstError &&
              typeof firstError.message === "string" &&
              firstError.message.trim()
            ? firstError.message.trim()
            : "Unity compile failed",
    });
    payload.error_code = feedback.error_code;
    payload.error_message = feedback.error_message;
    payload.suggestion = feedback.suggestion;
    payload.recoverable = feedback.recoverable;
    return source;
  }

  payload.error_code =
    typeof payload.error_code === "string" ? payload.error_code.trim() : "";
  payload.error_message =
    typeof payload.error_message === "string" ? payload.error_message : "";
  payload.suggestion =
    typeof payload.suggestion === "string" ? payload.suggestion : "";
  payload.recoverable = payload.recoverable === true;
  return source;
}

function normalizeUnityActionResultBody(gateway, body) {
  const source = body && typeof body === "object" ? cloneJson(body) : {};
  const payload =
    source.payload && typeof source.payload === "object" ? source.payload : null;
  if (!payload) {
    return source;
  }

  payload.action_type =
    typeof payload.action_type === "string" ? payload.action_type.trim() : "";
  payload.success = payload.success === true;

  if (payload.success !== true) {
    const normalizedFailureCode = normalizeUnityActionFailureCode(
      payload,
      "E_ACTION_RESULT_MISSING_ERROR_CODE"
    );
    if (normalizedFailureCode === "E_ACTION_RESULT_MISSING_ERROR_CODE") {
      gateway.recordActionErrorCodeMissing();
    }
    const feedback = gateway.withMcpErrorFeedback({
      status: "failed",
      error_code: normalizedFailureCode,
      message:
        typeof payload.error_message === "string" && payload.error_message.trim()
          ? payload.error_message.trim()
          : typeof payload.message === "string" && payload.message.trim()
            ? payload.message.trim()
            : "Unity visual action failed",
    });
    payload.error_code = feedback.error_code;
    payload.error_message = feedback.error_message;
    payload.suggestion = feedback.suggestion;
    payload.recoverable = feedback.recoverable;
    return source;
  }

  payload.error_code =
    typeof payload.error_code === "string" ? payload.error_code.trim() : "";
  payload.error_message =
    typeof payload.error_message === "string" ? payload.error_message : "";
  payload.suggestion =
    typeof payload.suggestion === "string" ? payload.suggestion : "";
  payload.recoverable = payload.recoverable === true;
  return source;
}

function normalizeUnityQueryReportBody(gateway, body) {
  const source = body && typeof body === "object" ? cloneJson(body) : {};
  if (typeof source.query_id === "string") {
    source.query_id = source.query_id.trim();
  }

  let result = null;
  if (source.result && typeof source.result === "object") {
    result = source.result;
  } else if (source.response && typeof source.response === "object") {
    result = source.response;
  } else {
    return source;
  }

  if (resolveUnityQueryResultSuccess(result)) {
    if (result.ok === undefined) {
      result.ok = true;
    }
    if (result.success === undefined) {
      result.success = true;
    }
    return source;
  }

  const feedback = gateway.withMcpErrorFeedback({
    status: "failed",
    error_code:
      typeof result.error_code === "string" && result.error_code.trim()
        ? result.error_code.trim()
        : "E_QUERY_FAILED",
    message:
      typeof result.error_message === "string" && result.error_message.trim()
        ? result.error_message.trim()
        : typeof result.message === "string" && result.message.trim()
          ? result.message.trim()
          : "Unity query failed",
  });
  result.ok = false;
  result.success = false;
  result.error_code = feedback.error_code;
  result.error_message = feedback.error_message;
  result.suggestion = feedback.suggestion;
  result.recoverable = feedback.recoverable;
  return source;
}

function resolveUnityQueryResultSuccess(result) {
  const source = result && typeof result === "object" ? result : {};
  if (typeof source.ok === "boolean") {
    return source.ok;
  }
  if (typeof source.success === "boolean") {
    return source.success;
  }
  if (typeof source.error_code === "string" && source.error_code.trim()) {
    return false;
  }
  return true;
}

module.exports = {
  normalizeUnityCompileResultBody,
  normalizeUnityActionResultBody,
  normalizeUnityQueryReportBody,
  resolveUnityQueryResultSuccess,
};

