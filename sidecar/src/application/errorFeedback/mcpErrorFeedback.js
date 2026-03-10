/**
 * R10-ARCH-01 Responsibility boundary:
 * - This module only normalizes/renders MCP error feedback payload fields.
 * - This module must not perform schema validation or payload structure rewrite.
 * - This module must not build request transport payloads.
 */

"use strict";

const {
  normalizeErrorCode,
  sanitizeMcpErrorMessage,
} = require("../../utils/turnUtils");
const {
  isAutoCancelErrorCode,
  resolveAutoCancelErrorMessage,
} = require("../turnPolicies");
const { resolveErrorGuidance } = require("./errorGuidanceRegistry");

const errorFeedbackMetrics = {
  error_feedback_normalized_total: 0,
  error_stack_sanitized_total: 0,
  error_path_sanitized_total: 0,
  error_message_truncated_total: 0,
  error_feedback_by_code: Object.create(null),
};

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeOptionalNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeOptionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function firstOptionalNumber(...values) {
  for (const value of values) {
    const normalized = normalizeOptionalNumber(value);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function firstOptionalBoolean(...values) {
  for (const value of values) {
    const normalized = normalizeOptionalBoolean(value);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function normalizeRetryPolicy(policy) {
  const source = policy && typeof policy === "object" ? policy : null;
  if (!source) {
    return null;
  }
  const output = {
    allow_auto_retry: source.allow_auto_retry === true,
    max_attempts:
      Number.isFinite(Number(source.max_attempts)) && Number(source.max_attempts) >= 0
        ? Math.floor(Number(source.max_attempts))
        : source.allow_auto_retry === true
          ? 1
          : 0,
    strategy: normalizeOptionalString(source.strategy) || "manual_fix_required",
  };
  if (Array.isArray(source.required_sequence) && source.required_sequence.length > 0) {
    output.required_sequence = source.required_sequence
      .filter((item) => normalizeOptionalString(item))
      .map((item) => normalizeOptionalString(item));
  }
  return output;
}

function bumpByCode(errorCode) {
  const code = normalizeErrorCode(errorCode, "E_INTERNAL");
  const current = Number(errorFeedbackMetrics.error_feedback_by_code[code]) || 0;
  errorFeedbackMetrics.error_feedback_by_code[code] = current + 1;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => normalizeOptionalString(item))
      .map((item) => normalizeOptionalString(item));
}

function normalizeFixSteps(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const stepTool =
      typeof item.tool === "string" && item.tool.trim() ? item.tool.trim() : "";
    const stepId =
      typeof item.step_id === "string" && item.step_id.trim()
        ? item.step_id.trim()
        : `fix_step_${index + 1}`;
    output.push({
      step:
        Number.isFinite(Number(item.step)) && Number(item.step) >= 1
          ? Math.floor(Number(item.step))
          : index + 1,
      step_id: stepId,
      tool: stepTool,
      required: item.required !== false,
      depends_on: normalizeStringArray(item.depends_on),
      ...(typeof item.idempotent === "boolean"
        ? { idempotent: item.idempotent }
        : {}),
      ...(item.verification &&
      typeof item.verification === "object" &&
      !Array.isArray(item.verification)
        ? { verification: { ...item.verification } }
        : {}),
      ...(Array.isArray(item.context_bindings)
        ? { context_bindings: [...item.context_bindings] }
        : {}),
    });
  }
  return output;
}

function buildAnchorConflictCandidates(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const candidates = [];
  const pathCandidatePath = normalizeOptionalString(source.path_candidate_path);
  const pathCandidateObjectId = normalizeOptionalString(
    source.path_candidate_object_id
  );
  const objectIdCandidatePath = normalizeOptionalString(
    source.object_id_candidate_path
  );
  const objectIdCandidateObjectId = normalizeOptionalString(
    source.object_id_candidate_object_id
  );

  if (pathCandidatePath || pathCandidateObjectId) {
    candidates.push({
      source: "path_anchor",
      target_path: pathCandidatePath,
      target_object_id: pathCandidateObjectId,
    });
  }
  if (objectIdCandidatePath || objectIdCandidateObjectId) {
    candidates.push({
      source: "object_id_anchor",
      target_path: objectIdCandidatePath,
      target_object_id: objectIdCandidateObjectId,
    });
  }

  return candidates;
}

function withMcpErrorFeedback(body) {
  const source = body && typeof body === "object" ? body : {};
  const sourceData =
    source.data && typeof source.data === "object" && !Array.isArray(source.data)
      ? source.data
      : {};
  const sourceContext =
    source.context &&
    typeof source.context === "object" &&
    !Array.isArray(source.context)
      ? source.context
      : {};
  const plannerOrchestrationData =
    sourceData.planner_orchestration &&
    typeof sourceData.planner_orchestration === "object" &&
    !Array.isArray(sourceData.planner_orchestration)
      ? sourceData.planner_orchestration
      : {};
  const plannerOrchestrationContext =
    sourceContext.planner_orchestration &&
    typeof sourceContext.planner_orchestration === "object" &&
    !Array.isArray(sourceContext.planner_orchestration)
      ? sourceContext.planner_orchestration
      : {};
  const errorCode = normalizeErrorCode(source.error_code, "E_INTERNAL");
  const isAutoCancelError = isAutoCancelErrorCode(errorCode);
  const incomingMessage =
    typeof source.error_message === "string" && source.error_message.trim()
      ? source.error_message.trim()
      : typeof source.message === "string" && source.message.trim()
        ? source.message.trim()
        : "";
  const autoCancelMessage = resolveAutoCancelErrorMessage(errorCode);
  const rawMessage =
    isAutoCancelError && autoCancelMessage ? autoCancelMessage : incomingMessage;
  const sanitized = sanitizeMcpErrorMessage(rawMessage, {
    fallback: "Unknown error",
  });
  const guidance = resolveErrorGuidance({
    error_code: errorCode,
    error_message: sanitized.message,
    tool_name: source.tool_name,
    context: source.context,
    data: source.data,
    fallback_strategy: source.fallback_strategy,
    now_ms: source.now_ms,
  });
  const normalizedSuggestion = normalizeOptionalString(guidance.suggestion);
  const retryPolicy = normalizeRetryPolicy(
    source.retry_policy || guidance.retry_policy
  );
  const suggestedAction = normalizeOptionalString(
    guidance.suggested_action || source.suggested_action
  );
  const suggestedTool = normalizeOptionalString(
    guidance.suggested_tool || source.suggested_tool
  );
  const fixHint = normalizeOptionalString(guidance.fix_hint || source.fix_hint);
  const contextualHint = normalizeOptionalString(
    guidance.contextual_hint || source.contextual_hint
  );
  const missingFields = normalizeStringArray(
    guidance.missing_fields && guidance.missing_fields.length > 0
      ? guidance.missing_fields
      : source.missing_fields
  );
  const contextMissing =
    guidance.context_missing === true || source.context_missing === true;
  const warning = normalizeOptionalString(guidance.warning || source.warning);
  const guidanceFixSteps = Array.isArray(guidance.fix_steps) ? guidance.fix_steps : [];
  const fixSteps = normalizeFixSteps(
    guidanceFixSteps.length > 0 ? guidanceFixSteps : source.fix_steps
  );
  const failedStepIndex = firstOptionalNumber(
    source.failed_step_index,
    sourceData.failed_step_index,
    sourceContext.failed_step_index
  );
  const failedStepId = firstNonEmptyString(
    source.failed_step_id,
    sourceData.failed_step_id,
    sourceContext.failed_step_id
  );
  const failedToolName = firstNonEmptyString(
    source.failed_tool_name,
    sourceData.failed_tool_name,
    sourceContext.failed_tool_name
  );
  const failedErrorCode = firstNonEmptyString(
    source.failed_error_code,
    sourceData.failed_error_code,
    sourceContext.failed_error_code
  );
  const failedErrorMessage = firstNonEmptyString(
    source.failed_error_message,
    sourceData.failed_error_message,
    sourceContext.failed_error_message
  );
  const nestedErrorCode = firstNonEmptyString(
    source.nested_error_code,
    sourceData.nested_error_code,
    sourceContext.nested_error_code
  );
  const nestedErrorMessage = firstNonEmptyString(
    source.nested_error_message,
    sourceData.nested_error_message,
    sourceContext.nested_error_message
  );
  const nestedContextJson = firstNonEmptyString(
    source.nested_context_json,
    sourceData.nested_context_json,
    sourceContext.nested_context_json
  );
  const ambiguityKind = firstNonEmptyString(
    source.ambiguity_kind,
    sourceData.ambiguity_kind,
    sourceContext.ambiguity_kind
  );
  const resolvedCandidatesCount = firstOptionalNumber(
    source.resolved_candidates_count,
    sourceData.resolved_candidates_count,
    sourceContext.resolved_candidates_count
  );
  const pathCandidatePath = firstNonEmptyString(
    source.path_candidate_path,
    sourceData.path_candidate_path,
    sourceContext.path_candidate_path
  );
  const pathCandidateObjectId = firstNonEmptyString(
    source.path_candidate_object_id,
    sourceData.path_candidate_object_id,
    sourceContext.path_candidate_object_id
  );
  const objectIdCandidatePath = firstNonEmptyString(
    source.object_id_candidate_path,
    sourceData.object_id_candidate_path,
    sourceContext.object_id_candidate_path
  );
  const objectIdCandidateObjectId = firstNonEmptyString(
    source.object_id_candidate_object_id,
    sourceData.object_id_candidate_object_id,
    sourceContext.object_id_candidate_object_id
  );
  const anchorConflictCandidates = buildAnchorConflictCandidates({
    path_candidate_path: pathCandidatePath,
    path_candidate_object_id: pathCandidateObjectId,
    object_id_candidate_path: objectIdCandidatePath,
    object_id_candidate_object_id: objectIdCandidateObjectId,
  });
  const rollbackApplied = firstOptionalBoolean(
    source.rollback_applied,
    sourceData.rollback_applied,
    sourceContext.rollback_applied
  );
  const rollbackPolicy = firstNonEmptyString(
    source.rollback_policy,
    sourceData.rollback_policy,
    sourceContext.rollback_policy
  );
  const rollbackReason = firstNonEmptyString(
    source.rollback_reason,
    sourceData.rollback_reason,
    sourceContext.rollback_reason
  );
  const suppressedErrorCount = firstOptionalNumber(
    source.suppressed_error_count,
    sourceData.suppressed_error_count,
    sourceContext.suppressed_error_count
  );
  const resolvedRefCount = firstOptionalNumber(
    source.resolved_ref_count,
    sourceData.resolved_ref_count,
    sourceContext.resolved_ref_count
  );
  const executedStepCount = firstOptionalNumber(
    source.executed_step_count,
    sourceData.executed_step_count,
    sourceContext.executed_step_count
  );
  const sceneRevisionAtFailure = firstNonEmptyString(
    source.scene_revision_at_failure,
    sourceData.scene_revision_at_failure,
    sourceContext.scene_revision_at_failure
  );
  const errorContextIssuedAt = firstNonEmptyString(
    source.error_context_issued_at,
    sourceData.error_context_issued_at,
    sourceContext.error_context_issued_at
  );
  const executionOrder = normalizeOptionalString(
    guidance.execution_order || source.execution_order
  );
  const plannerFailureStage = firstNonEmptyString(
    source.planner_failure_stage,
    sourceData.planner_failure_stage,
    sourceContext.planner_failure_stage,
    plannerOrchestrationData.failure_stage,
    plannerOrchestrationContext.failure_stage
  );
  const plannerExecutionShape = firstNonEmptyString(
    source.planner_execution_shape,
    sourceData.planner_execution_shape,
    sourceContext.planner_execution_shape,
    plannerOrchestrationData.execution_shape,
    plannerOrchestrationContext.execution_shape
  );
  const plannerExecutionShapeReason = firstNonEmptyString(
    source.planner_execution_shape_reason,
    sourceData.planner_execution_shape_reason,
    sourceContext.planner_execution_shape_reason,
    plannerOrchestrationData.execution_shape_reason,
    plannerOrchestrationContext.execution_shape_reason
  );
  const plannerShapeDegraded = firstOptionalBoolean(
    source.planner_shape_degraded,
    sourceData.planner_shape_degraded,
    sourceContext.planner_shape_degraded,
    plannerOrchestrationData.shape_degraded,
    plannerOrchestrationContext.shape_degraded
  );
  const plannerOriginalShape = firstNonEmptyString(
    source.planner_original_shape,
    sourceData.planner_original_shape,
    sourceContext.planner_original_shape,
    plannerOrchestrationData.original_shape,
    plannerOrchestrationContext.original_shape
  );
  const plannerDegradedReason = firstNonEmptyString(
    source.planner_degraded_reason,
    sourceData.planner_degraded_reason,
    sourceContext.planner_degraded_reason,
    plannerOrchestrationData.degraded_reason,
    plannerOrchestrationContext.degraded_reason
  );
  const plannerAutoTransactionApplied = firstOptionalBoolean(
    source.planner_auto_transaction_applied,
    sourceData.planner_auto_transaction_applied,
    sourceContext.planner_auto_transaction_applied,
    plannerOrchestrationData.auto_transaction_applied,
    plannerOrchestrationContext.auto_transaction_applied
  );
  const plannerBlockedReason = firstNonEmptyString(
    source.planner_blocked_reason,
    sourceData.planner_blocked_reason,
    sourceContext.planner_blocked_reason,
    plannerOrchestrationData.blocked_reason,
    plannerOrchestrationContext.blocked_reason
  );
  const plannerDispatchMode = firstNonEmptyString(
    source.planner_dispatch_mode,
    sourceData.planner_dispatch_mode,
    sourceContext.planner_dispatch_mode,
    plannerOrchestrationData.dispatch_mode,
    plannerOrchestrationContext.dispatch_mode
  );
  const plannerSourceShapeReason = firstNonEmptyString(
    source.planner_source_shape_reason,
    sourceData.planner_source_shape_reason,
    sourceContext.planner_source_shape_reason,
    plannerOrchestrationData.source_shape_reason,
    plannerOrchestrationContext.source_shape_reason
  );
  const plannerTransactionId = firstNonEmptyString(
    source.planner_transaction_id,
    sourceData.planner_transaction_id,
    sourceContext.planner_transaction_id,
    plannerOrchestrationData.transaction_id,
    plannerOrchestrationContext.transaction_id
  );
  const plannerStepCount = firstOptionalNumber(
    source.planner_step_count,
    sourceData.planner_step_count,
    sourceContext.planner_step_count,
    plannerOrchestrationData.step_count,
    plannerOrchestrationContext.step_count
  );
  const failureHandling = normalizeOptionalString(
    guidance.failure_handling || source.failure_handling
  );
  const fallbackStrategy = normalizeOptionalString(
    guidance.fallback_strategy || source.fallback_strategy
  );
  const recoveryPlanErrorCode = normalizeOptionalString(
    guidance.recovery_plan_error_code || source.recovery_plan_error_code
  );
  const recoveryPlanErrorMessage = normalizeOptionalString(
    guidance.recovery_plan_error_message || source.recovery_plan_error_message
  );
  const routedErrorCode = normalizeOptionalString(
    guidance.routed_error_code || source.routed_error_code
  );
  const routedSource = normalizeOptionalString(
    guidance.routed_source || source.routed_source
  );
  const errorContextVersion = firstNonEmptyString(
    source.error_context_version,
    sourceData.error_context_version,
    sourceContext.error_context_version
  );
  const requiresContextRefresh =
    guidance.requires_context_refresh === true ||
    source.requires_context_refresh === true;

  errorFeedbackMetrics.error_feedback_normalized_total += 1;
  if (sanitized.diagnostics && sanitized.diagnostics.stack_sanitized) {
    errorFeedbackMetrics.error_stack_sanitized_total += 1;
  }
  if (sanitized.diagnostics && sanitized.diagnostics.path_sanitized) {
    errorFeedbackMetrics.error_path_sanitized_total += 1;
  }
  if (sanitized.diagnostics && sanitized.diagnostics.truncated) {
    errorFeedbackMetrics.error_message_truncated_total += 1;
  }
  bumpByCode(errorCode);

  return {
    ...source,
    status:
      typeof source.status === "string" && source.status.trim()
        ? source.status.trim()
        : "rejected",
    error_code: errorCode,
    error_message: sanitized.message,
    suggestion: normalizedSuggestion,
    recoverable: guidance.recoverable === true,
    message: sanitized.message,
    suggested_action: suggestedAction,
    suggested_tool: suggestedTool,
    fix_hint: fixHint,
    contextual_hint: contextualHint,
    fix_steps: fixSteps,
    execution_order: executionOrder || "sequential",
    failure_handling: failureHandling || "stop_on_first_failure",
    fallback_strategy: fallbackStrategy || "return_manual_instructions",
    requires_context_refresh: requiresContextRefresh,
    recovery_plan_error_code: recoveryPlanErrorCode,
    recovery_plan_error_message: recoveryPlanErrorMessage,
    ...(routedErrorCode ? { routed_error_code: routedErrorCode } : {}),
    ...(routedSource ? { routed_source: routedSource } : {}),
    context_missing: contextMissing,
    missing_fields: missingFields,
    warning,
    ...(failedStepIndex !== null ? { failed_step_index: failedStepIndex } : {}),
    ...(failedStepId ? { failed_step_id: failedStepId } : {}),
    ...(failedToolName ? { failed_tool_name: failedToolName } : {}),
    ...(failedErrorCode ? { failed_error_code: failedErrorCode } : {}),
    ...(failedErrorMessage ? { failed_error_message: failedErrorMessage } : {}),
    ...(nestedErrorCode ? { nested_error_code: nestedErrorCode } : {}),
    ...(nestedErrorMessage ? { nested_error_message: nestedErrorMessage } : {}),
    ...(nestedContextJson ? { nested_context_json: nestedContextJson } : {}),
    ...(ambiguityKind ? { ambiguity_kind: ambiguityKind } : {}),
    ...(resolvedCandidatesCount !== null
      ? { resolved_candidates_count: resolvedCandidatesCount }
      : {}),
    ...(pathCandidatePath ? { path_candidate_path: pathCandidatePath } : {}),
    ...(pathCandidateObjectId
      ? { path_candidate_object_id: pathCandidateObjectId }
      : {}),
    ...(objectIdCandidatePath
      ? { object_id_candidate_path: objectIdCandidatePath }
      : {}),
    ...(objectIdCandidateObjectId
      ? { object_id_candidate_object_id: objectIdCandidateObjectId }
      : {}),
    ...(anchorConflictCandidates.length > 0
      ? { anchor_conflict_candidates: anchorConflictCandidates }
      : {}),
    ...(rollbackApplied !== null ? { rollback_applied: rollbackApplied } : {}),
    ...(rollbackPolicy ? { rollback_policy: rollbackPolicy } : {}),
    ...(rollbackReason ? { rollback_reason: rollbackReason } : {}),
    ...(suppressedErrorCount !== null
      ? { suppressed_error_count: suppressedErrorCount }
      : {}),
    ...(resolvedRefCount !== null ? { resolved_ref_count: resolvedRefCount } : {}),
    ...(executedStepCount !== null
      ? { executed_step_count: executedStepCount }
      : {}),
    ...(sceneRevisionAtFailure
      ? { scene_revision_at_failure: sceneRevisionAtFailure }
      : {}),
    ...(errorContextIssuedAt ? { error_context_issued_at: errorContextIssuedAt } : {}),
    ...(errorContextVersion ? { error_context_version: errorContextVersion } : {}),
    ...(plannerFailureStage ? { planner_failure_stage: plannerFailureStage } : {}),
    ...(plannerExecutionShape ? { planner_execution_shape: plannerExecutionShape } : {}),
    ...(plannerExecutionShapeReason
      ? { planner_execution_shape_reason: plannerExecutionShapeReason }
      : {}),
    ...(plannerShapeDegraded !== null
      ? { planner_shape_degraded: plannerShapeDegraded }
      : {}),
    ...(plannerOriginalShape ? { planner_original_shape: plannerOriginalShape } : {}),
    ...(plannerDegradedReason ? { planner_degraded_reason: plannerDegradedReason } : {}),
    ...(plannerAutoTransactionApplied !== null
      ? { planner_auto_transaction_applied: plannerAutoTransactionApplied }
      : {}),
    ...(plannerBlockedReason ? { planner_blocked_reason: plannerBlockedReason } : {}),
    ...(plannerDispatchMode ? { planner_dispatch_mode: plannerDispatchMode } : {}),
    ...(plannerSourceShapeReason
      ? { planner_source_shape_reason: plannerSourceShapeReason }
      : {}),
    ...(plannerTransactionId ? { planner_transaction_id: plannerTransactionId } : {}),
    ...(plannerStepCount !== null ? { planner_step_count: plannerStepCount } : {}),
    ...(retryPolicy ? { retry_policy: retryPolicy } : {}),
  };
}

function getMcpErrorFeedbackMetricsSnapshot() {
  return {
    error_feedback_normalized_total:
      Number(errorFeedbackMetrics.error_feedback_normalized_total) || 0,
    error_stack_sanitized_total:
      Number(errorFeedbackMetrics.error_stack_sanitized_total) || 0,
    error_path_sanitized_total:
      Number(errorFeedbackMetrics.error_path_sanitized_total) || 0,
    error_message_truncated_total:
      Number(errorFeedbackMetrics.error_message_truncated_total) || 0,
    error_feedback_by_code: { ...errorFeedbackMetrics.error_feedback_by_code },
  };
}

function resetMcpErrorFeedbackMetrics() {
  errorFeedbackMetrics.error_feedback_normalized_total = 0;
  errorFeedbackMetrics.error_stack_sanitized_total = 0;
  errorFeedbackMetrics.error_path_sanitized_total = 0;
  errorFeedbackMetrics.error_message_truncated_total = 0;
  errorFeedbackMetrics.error_feedback_by_code = Object.create(null);
}

function validationError(validation, options) {
  void options;
  return {
    statusCode: validation.statusCode,
    body: withMcpErrorFeedback({
      status: "rejected",
      error_code: validation.errorCode,
      message: validation.message,
    }),
  };
}

module.exports = {
  withMcpErrorFeedback,
  validationError,
  getMcpErrorFeedbackMetricsSnapshot,
  resetMcpErrorFeedbackMetrics,
};

