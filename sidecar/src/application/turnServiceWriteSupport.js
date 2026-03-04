"use strict";

const { cloneJson } = require("../utils/turnUtils");
const { normalizeWriteToolOutcome } = require("./writeReceiptFormatter");

function normalizeRequestId(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isWriteFailureBody(statusCode, body) {
  const source = isObject(body) ? body : {};
  if (Number.isFinite(Number(statusCode)) && Number(statusCode) >= 400) {
    return true;
  }
  const status = normalizeString(source.status).toLowerCase();
  if (status === "failed" || status === "rejected" || status === "cancelled") {
    return true;
  }
  if (source.ok === false) {
    return true;
  }
  if (normalizeString(source.error_code)) {
    return true;
  }
  return false;
}

function buildUnityActionRequestEnvelopeWithIds(options) {
  const input = options && typeof options === "object" ? options : {};
  const item = input.action && typeof input.action === "object" ? input.action : {};
  const nowIso = typeof input.nowIso === "function" ? input.nowIso : () => "";
  const resolveApprovalMode =
    typeof input.resolveApprovalMode === "function"
      ? input.resolveApprovalMode
      : () => "";
  const normalizedRequestId = normalizeRequestId(input.requestId);
  const approvalMode = resolveApprovalMode(normalizedRequestId);
  return {
    event: "unity.action.request",
    request_id: normalizedRequestId,
    thread_id: typeof input.threadId === "string" ? input.threadId : "",
    turn_id: typeof input.turnId === "string" ? input.turnId : "",
    timestamp: nowIso(),
    payload: {
      action_type: typeof item.type === "string" ? item.type : "",
      target: typeof item.target === "string" ? item.target : "",
      target_object_path:
        typeof item.target_object_path === "string" ? item.target_object_path : "",
      target_object_id:
        typeof item.target_object_id === "string" ? item.target_object_id : "",
      component_assembly_qualified_name:
        typeof item.component_assembly_qualified_name === "string"
          ? item.component_assembly_qualified_name
          : "",
      component_name:
        typeof item.component_name === "string" ? item.component_name : "",
      remove_mode:
        typeof item.remove_mode === "string" ? item.remove_mode : "single",
      expected_count:
        Number.isFinite(Number(item.expected_count)) &&
        Number(item.expected_count) >= 0
          ? Math.floor(Number(item.expected_count))
          : 1,
      requires_confirmation: approvalMode === "require_user",
    },
  };
}

function buildValidationErrorResponse(validation) {
  const expected =
    validation && validation.expected && typeof validation.expected === "object"
      ? validation.expected
      : null;
  const actual =
    validation && validation.actual && typeof validation.actual === "object"
      ? validation.actual
      : null;
  const diff =
    validation && Array.isArray(validation.diff) ? validation.diff : null;
  return {
    statusCode: validation.statusCode,
    body: {
      error_code: validation.errorCode,
      message: validation.message,
      ...(expected ? { expected } : {}),
      ...(actual ? { actual } : {}),
      ...(diff ? { diff } : {}),
    },
  };
}

function decorateWriteFailureOutcome(outcome, options) {
  const source = outcome && typeof outcome === "object" ? outcome : null;
  if (!source || !isObject(source.body)) {
    return outcome;
  }
  if (!isWriteFailureBody(source.statusCode, source.body)) {
    return outcome;
  }

  const resolveRequestIdFromFailureBody =
    options && typeof options.resolveRequestIdFromFailureBody === "function"
      ? options.resolveRequestIdFromFailureBody
      : () => "";
  const body = source.body;
  const executionReport =
    body.execution_report && isObject(body.execution_report)
      ? body.execution_report
      : null;
  const actionError =
    executionReport &&
    executionReport.action_error &&
    isObject(executionReport.action_error)
      ? executionReport.action_error
      : null;

  const requestIdFromJob = resolveRequestIdFromFailureBody(body);
  const requestId =
    normalizeString(body.request_id) ||
    requestIdFromJob ||
    normalizeString(actionError && actionError.request_id);
  const errorCode =
    normalizeString(body.error_code) ||
    normalizeString(actionError && actionError.error_code);
  const errorMessage =
    normalizeString(body.error_message) ||
    normalizeString(body.message) ||
    normalizeString(actionError && actionError.error_message);
  const fieldPath =
    normalizeString(body.field_path) ||
    normalizeString(actionError && actionError.field_path);
  const anchorSnapshot =
    isObject(body.anchor_snapshot)
      ? cloneJson(body.anchor_snapshot)
      : isObject(actionError && actionError.anchor_snapshot)
        ? cloneJson(actionError.anchor_snapshot)
        : null;

  let mutated = false;
  const nextBody = {
    ...body,
  };
  if (requestId && requestId !== normalizeString(body.request_id)) {
    nextBody.request_id = requestId;
    mutated = true;
  }
  if (errorCode && errorCode !== normalizeString(body.error_code)) {
    nextBody.error_code = errorCode;
    mutated = true;
  }
  if (errorMessage) {
    if (errorMessage !== normalizeString(body.error_message)) {
      nextBody.error_message = errorMessage;
      mutated = true;
    }
    if (errorMessage !== normalizeString(body.message)) {
      nextBody.message = errorMessage;
      mutated = true;
    }
  }
  if (fieldPath && fieldPath !== normalizeString(body.field_path)) {
    nextBody.field_path = fieldPath;
    mutated = true;
  }
  if (anchorSnapshot && !isObject(body.anchor_snapshot)) {
    nextBody.anchor_snapshot = anchorSnapshot;
    mutated = true;
  }

  if (!mutated) {
    return outcome;
  }
  return {
    ...source,
    body: nextBody,
  };
}

function normalizeWriteOutcome(outcome, options) {
  const normalizeSingleOutcome = (source) =>
    decorateWriteFailureOutcome(normalizeWriteToolOutcome(source), options);
  if (outcome && typeof outcome.then === "function") {
    return outcome.then((resolved) => normalizeSingleOutcome(resolved));
  }
  return normalizeSingleOutcome(outcome);
}

function mapFileErrorToStatus(errorCode) {
  if (errorCode === "E_FILE_EXISTS_BLOCKED") {
    return 409;
  }
  if (errorCode === "E_FILE_PATH_FORBIDDEN") {
    return 403;
  }
  if (errorCode === "E_FILE_SIZE_EXCEEDED") {
    return 413;
  }
  if (errorCode === "E_FILE_NOT_FOUND") {
    return 404;
  }
  if (errorCode === "E_SCHEMA_INVALID") {
    return 400;
  }
  return 500;
}

module.exports = {
  normalizeRequestId,
  normalizeString,
  isObject,
  buildUnityActionRequestEnvelopeWithIds,
  buildValidationErrorResponse,
  normalizeWriteOutcome,
  mapFileErrorToStatus,
};
