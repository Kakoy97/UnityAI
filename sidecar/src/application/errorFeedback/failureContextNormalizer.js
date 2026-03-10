"use strict";

const { normalizeErrorCode } = require("../../utils/turnUtils");
const { normalizeSsotErrorCodeForMcp } = require("./ssotErrorCodeCanon");

const DEFAULT_ERROR_CONTEXT_VERSION = "2.0";
const DEFAULT_CONTEXT_TTL_SECONDS = 300;
const FAILURE_DATA_KEYS = Object.freeze([
  "failed_step_index",
  "failed_step_id",
  "failed_tool_name",
  "failed_error_code",
  "failed_error_message",
  "nested_error_code",
  "nested_error_message",
  "nested_context_json",
  "rollback_applied",
  "rollback_policy",
  "rollback_reason",
  "ambiguity_kind",
  "resolved_candidates_count",
  "path_candidate_path",
  "path_candidate_object_id",
  "object_id_candidate_path",
  "object_id_candidate_object_id",
  "suppressed_error_count",
  "resolved_ref_count",
  "executed_step_count",
  "scene_revision_at_failure",
  "error_context_issued_at",
  "error_context_version",
  "requires_context_refresh",
  "planner_failure_stage",
  "planner_execution_shape",
  "planner_execution_shape_reason",
  "planner_shape_degraded",
  "planner_original_shape",
  "planner_degraded_reason",
  "planner_auto_transaction_applied",
  "planner_blocked_reason",
  "planner_dispatch_mode",
  "planner_source_shape_reason",
  "planner_transaction_id",
  "planner_step_count",
]);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBooleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJsonObject(jsonText) {
  const normalized = normalizeString(jsonText);
  if (!normalized) {
    return {};
  }
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeErrorCodeOrEmpty(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return normalizeSsotErrorCodeForMcp(normalized);
}

function parseIsoToMs(isoText) {
  const normalized = normalizeString(isoText);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildContextFingerprint(normalizedContext) {
  const source = normalizeObject(normalizedContext);
  const parts = [
    normalizeString(source.stage),
    normalizeString(source.previous_operation),
    normalizeString(source.failed_step_id),
    normalizeString(source.failed_tool_name),
    normalizeString(source.failed_error_code),
    normalizeString(source.ambiguity_kind),
    normalizeString(source.scene_revision_at_failure),
    normalizeString(source.path_candidate_object_id),
    normalizeString(source.object_id_candidate_object_id),
    normalizeString(source.planner_failure_stage),
    normalizeString(source.planner_execution_shape),
    normalizeString(source.planner_blocked_reason),
    typeof source.planner_auto_transaction_applied === "boolean"
      ? String(source.planner_auto_transaction_applied)
      : "",
  ];
  return parts.join("|");
}

function collectContractMissingFields(errorCode, context, globalContracts) {
  const contracts = normalizeObject(globalContracts);
  const errorContract = normalizeObject(contracts.error_context_contract);
  const normalizedErrorCode = normalizeErrorCode(errorCode, "E_INTERNAL");
  let required = [];
  if (normalizedErrorCode === "E_TRANSACTION_STEP_FAILED") {
    required = Array.isArray(errorContract.transaction_failure?.required_fields)
      ? errorContract.transaction_failure.required_fields
      : [];
  } else if (normalizedErrorCode === "E_TARGET_ANCHOR_CONFLICT") {
    required = Array.isArray(errorContract.anchor_conflict?.required_fields)
      ? errorContract.anchor_conflict.required_fields
      : [];
  }
  const source = normalizeObject(context);
  const missing = [];
  for (const field of required) {
    const name = normalizeString(field);
    if (!name) {
      continue;
    }
    const rawValue = source[name];
    if (typeof rawValue === "boolean") {
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      continue;
    }
    if (typeof rawValue === "string" && rawValue.trim()) {
      continue;
    }
    missing.push(name);
  }
  return missing;
}

function normalizeFailureContext(options = {}) {
  const input = normalizeObject(options);
  const rawContext = normalizeObject(input.context);
  const rawData = normalizeObject(input.data);
  const globalContracts = normalizeObject(input.globalContracts);
  const nowMs = Number.isFinite(Number(input.nowMs))
    ? Number(input.nowMs)
    : Date.now();
  const contextValidity = normalizeObject(
    normalizeObject(globalContracts.recovery_action_contract).context_validity
  );
  const ttlSeconds =
    Number.isFinite(Number(contextValidity.ttl_seconds)) &&
    Number(contextValidity.ttl_seconds) > 0
      ? Number(contextValidity.ttl_seconds)
      : DEFAULT_CONTEXT_TTL_SECONDS;
  const nestedContextJsonRaw =
    normalizeString(rawData.nested_context_json) ||
    normalizeString(rawContext.nested_context_json);
  const nestedContext = parseJsonObject(nestedContextJsonRaw);
  const plannerOrchestrationData = normalizeObject(rawData.planner_orchestration);
  const plannerOrchestrationContext = normalizeObject(rawContext.planner_orchestration);
  const plannerOrchestrationNested = normalizeObject(
    nestedContext.planner_orchestration
  );

  const normalized = {
    stage:
      normalizeString(rawContext.stage) ||
      normalizeString(rawData.stage) ||
      normalizeString(nestedContext.stage) ||
      normalizeString(plannerOrchestrationData.failure_stage) ||
      normalizeString(plannerOrchestrationContext.failure_stage) ||
      normalizeString(plannerOrchestrationNested.failure_stage) ||
      "during_dispatch",
    previous_operation:
      normalizeString(rawContext.previous_operation) ||
      normalizeString(rawData.previous_operation) ||
      normalizeString(nestedContext.previous_operation),
    scene_revision_changed:
      typeof rawContext.scene_revision_changed === "boolean"
        ? rawContext.scene_revision_changed
        : typeof rawData.scene_revision_changed === "boolean"
          ? rawData.scene_revision_changed
          : null,
    failed_step_index:
      normalizeNumberOrNull(rawData.failed_step_index) ??
      normalizeNumberOrNull(rawContext.failed_step_index),
    failed_step_id:
      normalizeString(rawData.failed_step_id) ||
      normalizeString(rawContext.failed_step_id),
    failed_tool_name:
      normalizeString(rawData.failed_tool_name) ||
      normalizeString(rawContext.failed_tool_name),
    failed_error_code:
      normalizeErrorCodeOrEmpty(rawData.failed_error_code) ||
      normalizeErrorCodeOrEmpty(rawContext.failed_error_code) ||
      normalizeErrorCodeOrEmpty(nestedContext.failed_error_code) ||
      normalizeErrorCodeOrEmpty(nestedContext.error_code),
    failed_error_message:
      normalizeString(rawData.failed_error_message) ||
      normalizeString(rawContext.failed_error_message) ||
      normalizeString(nestedContext.failed_error_message) ||
      normalizeString(nestedContext.error_message),
    nested_error_code:
      normalizeErrorCodeOrEmpty(rawData.nested_error_code) ||
      normalizeErrorCodeOrEmpty(rawContext.nested_error_code) ||
      normalizeErrorCodeOrEmpty(nestedContext.nested_error_code) ||
      normalizeErrorCodeOrEmpty(nestedContext.error_code),
    nested_error_message:
      normalizeString(rawData.nested_error_message) ||
      normalizeString(rawContext.nested_error_message) ||
      normalizeString(nestedContext.nested_error_message) ||
      normalizeString(nestedContext.error_message),
    nested_context_json: nestedContextJsonRaw,
    rollback_applied:
      typeof rawData.rollback_applied === "boolean"
        ? rawData.rollback_applied
        : typeof rawContext.rollback_applied === "boolean"
          ? rawContext.rollback_applied
          : null,
    rollback_policy:
      normalizeString(rawData.rollback_policy) ||
      normalizeString(rawContext.rollback_policy),
    rollback_reason:
      normalizeString(rawData.rollback_reason) ||
      normalizeString(rawContext.rollback_reason),
    ambiguity_kind:
      normalizeString(rawData.ambiguity_kind) ||
      normalizeString(rawContext.ambiguity_kind) ||
      normalizeString(nestedContext.ambiguity_kind),
    resolved_candidates_count:
      normalizeNumberOrNull(rawData.resolved_candidates_count) ??
      normalizeNumberOrNull(rawContext.resolved_candidates_count) ??
      normalizeNumberOrNull(nestedContext.resolved_candidates_count),
    path_candidate_path:
      normalizeString(rawData.path_candidate_path) ||
      normalizeString(rawContext.path_candidate_path) ||
      normalizeString(nestedContext.path_candidate_path),
    path_candidate_object_id:
      normalizeString(rawData.path_candidate_object_id) ||
      normalizeString(rawContext.path_candidate_object_id) ||
      normalizeString(nestedContext.path_candidate_object_id),
    object_id_candidate_path:
      normalizeString(rawData.object_id_candidate_path) ||
      normalizeString(rawContext.object_id_candidate_path) ||
      normalizeString(nestedContext.object_id_candidate_path),
    object_id_candidate_object_id:
      normalizeString(rawData.object_id_candidate_object_id) ||
      normalizeString(rawContext.object_id_candidate_object_id) ||
      normalizeString(nestedContext.object_id_candidate_object_id),
    suppressed_error_count:
      normalizeNumberOrNull(rawData.suppressed_error_count) ??
      normalizeNumberOrNull(rawContext.suppressed_error_count),
    resolved_ref_count:
      normalizeNumberOrNull(rawData.resolved_ref_count) ??
      normalizeNumberOrNull(rawContext.resolved_ref_count),
    executed_step_count:
      normalizeNumberOrNull(rawData.executed_step_count) ??
      normalizeNumberOrNull(rawContext.executed_step_count),
    scene_revision_at_failure:
      normalizeString(rawData.scene_revision_at_failure) ||
      normalizeString(rawContext.scene_revision_at_failure) ||
      normalizeString(nestedContext.scene_revision_at_failure) ||
      normalizeString(nestedContext.scene_revision),
    error_context_issued_at:
      normalizeString(rawData.error_context_issued_at) ||
      normalizeString(rawContext.error_context_issued_at) ||
      normalizeString(nestedContext.error_context_issued_at),
    error_context_version:
      normalizeString(rawData.error_context_version) ||
      normalizeString(rawContext.error_context_version) ||
      normalizeString(
        normalizeObject(globalContracts.error_context_contract)
          .error_context_version
      ) ||
      DEFAULT_ERROR_CONTEXT_VERSION,
    requires_context_refresh:
      rawData.requires_context_refresh === true ||
      rawContext.requires_context_refresh === true ||
      nestedContext.requires_context_refresh === true,
    planner_failure_stage:
      normalizeString(rawData.planner_failure_stage) ||
      normalizeString(rawContext.planner_failure_stage) ||
      normalizeString(plannerOrchestrationData.failure_stage) ||
      normalizeString(plannerOrchestrationContext.failure_stage) ||
      normalizeString(plannerOrchestrationNested.failure_stage),
    planner_execution_shape:
      normalizeString(rawData.planner_execution_shape) ||
      normalizeString(rawContext.planner_execution_shape) ||
      normalizeString(plannerOrchestrationData.execution_shape) ||
      normalizeString(plannerOrchestrationContext.execution_shape) ||
      normalizeString(plannerOrchestrationNested.execution_shape),
    planner_execution_shape_reason:
      normalizeString(rawData.planner_execution_shape_reason) ||
      normalizeString(rawContext.planner_execution_shape_reason) ||
      normalizeString(plannerOrchestrationData.execution_shape_reason) ||
      normalizeString(plannerOrchestrationContext.execution_shape_reason) ||
      normalizeString(plannerOrchestrationNested.execution_shape_reason),
    planner_shape_degraded:
      typeof rawData.planner_shape_degraded === "boolean"
        ? rawData.planner_shape_degraded
        : typeof rawContext.planner_shape_degraded === "boolean"
          ? rawContext.planner_shape_degraded
          : typeof plannerOrchestrationData.shape_degraded === "boolean"
            ? plannerOrchestrationData.shape_degraded
            : typeof plannerOrchestrationContext.shape_degraded === "boolean"
              ? plannerOrchestrationContext.shape_degraded
              : typeof plannerOrchestrationNested.shape_degraded === "boolean"
                ? plannerOrchestrationNested.shape_degraded
                : null,
    planner_original_shape:
      normalizeString(rawData.planner_original_shape) ||
      normalizeString(rawContext.planner_original_shape) ||
      normalizeString(plannerOrchestrationData.original_shape) ||
      normalizeString(plannerOrchestrationContext.original_shape) ||
      normalizeString(plannerOrchestrationNested.original_shape),
    planner_degraded_reason:
      normalizeString(rawData.planner_degraded_reason) ||
      normalizeString(rawContext.planner_degraded_reason) ||
      normalizeString(plannerOrchestrationData.degraded_reason) ||
      normalizeString(plannerOrchestrationContext.degraded_reason) ||
      normalizeString(plannerOrchestrationNested.degraded_reason),
    planner_auto_transaction_applied:
      typeof rawData.planner_auto_transaction_applied === "boolean"
        ? rawData.planner_auto_transaction_applied
        : typeof rawContext.planner_auto_transaction_applied === "boolean"
          ? rawContext.planner_auto_transaction_applied
          : typeof plannerOrchestrationData.auto_transaction_applied === "boolean"
            ? plannerOrchestrationData.auto_transaction_applied
            : typeof plannerOrchestrationContext.auto_transaction_applied === "boolean"
              ? plannerOrchestrationContext.auto_transaction_applied
              : typeof plannerOrchestrationNested.auto_transaction_applied === "boolean"
                ? plannerOrchestrationNested.auto_transaction_applied
                : null,
    planner_blocked_reason:
      normalizeString(rawData.planner_blocked_reason) ||
      normalizeString(rawContext.planner_blocked_reason) ||
      normalizeString(plannerOrchestrationData.blocked_reason) ||
      normalizeString(plannerOrchestrationContext.blocked_reason) ||
      normalizeString(plannerOrchestrationNested.blocked_reason),
    planner_dispatch_mode:
      normalizeString(rawData.planner_dispatch_mode) ||
      normalizeString(rawContext.planner_dispatch_mode) ||
      normalizeString(plannerOrchestrationData.dispatch_mode) ||
      normalizeString(plannerOrchestrationContext.dispatch_mode) ||
      normalizeString(plannerOrchestrationNested.dispatch_mode),
    planner_source_shape_reason:
      normalizeString(rawData.planner_source_shape_reason) ||
      normalizeString(rawContext.planner_source_shape_reason) ||
      normalizeString(plannerOrchestrationData.source_shape_reason) ||
      normalizeString(plannerOrchestrationContext.source_shape_reason) ||
      normalizeString(plannerOrchestrationNested.source_shape_reason),
    planner_transaction_id:
      normalizeString(rawData.planner_transaction_id) ||
      normalizeString(rawContext.planner_transaction_id) ||
      normalizeString(plannerOrchestrationData.transaction_id) ||
      normalizeString(plannerOrchestrationContext.transaction_id) ||
      normalizeString(plannerOrchestrationNested.transaction_id),
    planner_step_count:
      normalizeNumberOrNull(rawData.planner_step_count) ??
      normalizeNumberOrNull(rawContext.planner_step_count) ??
      normalizeNumberOrNull(plannerOrchestrationData.step_count) ??
      normalizeNumberOrNull(plannerOrchestrationContext.step_count) ??
      normalizeNumberOrNull(plannerOrchestrationNested.step_count),
    l3_context: {
      ...normalizeObject(rawContext.l3_context),
      ...(Object.keys(nestedContext).length > 0
        ? { nested_context: nestedContext }
        : {}),
    },
  };
  if (!normalized.nested_error_code && normalized.failed_error_code) {
    normalized.nested_error_code = normalized.failed_error_code;
  }
  if (!normalized.nested_error_message && normalized.failed_error_message) {
    normalized.nested_error_message = normalized.failed_error_message;
  }

  const issuedAtMs = parseIsoToMs(normalized.error_context_issued_at);
  const contextAgeMs =
    issuedAtMs === null || !Number.isFinite(issuedAtMs)
      ? null
      : Math.max(0, nowMs - issuedAtMs);
  const contextStale =
    contextAgeMs !== null && contextAgeMs > Math.max(0, ttlSeconds) * 1000;
  const missingFields = collectContractMissingFields(
    input.errorCode,
    normalized,
    globalContracts
  );
  const requiresContextRefresh =
    normalized.requires_context_refresh === true || contextStale;
  normalized.requires_context_refresh = requiresContextRefresh;

  return {
    context: normalized,
    context_missing: missingFields.length > 0,
    missing_fields: missingFields,
    context_stale: contextStale,
    context_age_ms: contextAgeMs,
    context_ttl_seconds: ttlSeconds,
    requires_context_refresh: requiresContextRefresh,
    context_fingerprint: buildContextFingerprint(normalized),
  };
}

function projectFailureDataFromContext(value) {
  const context = normalizeObject(value);
  const output = {};
  for (const key of FAILURE_DATA_KEYS) {
    const raw = context[key];
    if (typeof raw === "boolean") {
      output[key] = raw;
      continue;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      output[key] = raw;
      continue;
    }
    if (typeof raw === "string" && raw.trim()) {
      output[key] = raw.trim();
    }
  }
  return output;
}

module.exports = {
  DEFAULT_CONTEXT_TTL_SECONDS,
  DEFAULT_ERROR_CONTEXT_VERSION,
  FAILURE_DATA_KEYS,
  normalizeFailureContext,
  buildContextFingerprint,
  projectFailureDataFromContext,
};
