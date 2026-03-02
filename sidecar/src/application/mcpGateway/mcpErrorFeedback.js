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
  normalizeErrorSuggestionByCode,
} = require("../../utils/turnUtils");
const {
  isAutoCancelErrorCode,
  resolveAutoCancelErrorMessage,
  buildValidationSchemaCompensation,
  getMcpErrorFeedbackTemplate,
} = require("../turnPolicies");
const { enforceFixedErrorSuggestion } = require("../../domain/validators");

const errorFeedbackMetrics = {
  error_feedback_normalized_total: 0,
  error_stack_sanitized_total: 0,
  error_path_sanitized_total: 0,
  error_message_truncated_total: 0,
  error_fixed_suggestion_enforced_total: 0,
  error_feedback_by_code: Object.create(null),
};

function normalizeSchemaRef(ref) {
  const source = ref && typeof ref === "object" ? ref : null;
  if (!source) {
    return null;
  }
  const tool =
    typeof source.tool === "string" && source.tool.trim() ? source.tool.trim() : "";
  if (!tool) {
    return null;
  }
  const params =
    source.params && typeof source.params === "object" && !Array.isArray(source.params)
      ? { ...source.params }
      : {};
  return {
    tool,
    params,
  };
}

function bumpByCode(errorCode) {
  const code = normalizeErrorCode(errorCode, "E_INTERNAL");
  const current = Number(errorFeedbackMetrics.error_feedback_by_code[code]) || 0;
  errorFeedbackMetrics.error_feedback_by_code[code] = current + 1;
}

function mapMcpErrorFeedback(errorCode, errorMessage) {
  return getMcpErrorFeedbackTemplate(errorCode, errorMessage);
}

function withMcpErrorFeedback(body) {
  const source = body && typeof body === "object" ? body : {};
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
  const feedback = mapMcpErrorFeedback(errorCode, sanitized.message);
  const suggestionFromCode = normalizeErrorSuggestionByCode(
    errorCode,
    feedback.suggestion
  );
  const fixedSuggestion = enforceFixedErrorSuggestion(
    errorCode,
    suggestionFromCode
  );

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
  if (fixedSuggestion.enforced === true) {
    errorFeedbackMetrics.error_fixed_suggestion_enforced_total += 1;
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
    suggestion: fixedSuggestion.suggestion,
    recoverable: feedback.recoverable,
    message: sanitized.message,
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
    error_fixed_suggestion_enforced_total:
      Number(errorFeedbackMetrics.error_fixed_suggestion_enforced_total) || 0,
    error_feedback_by_code: { ...errorFeedbackMetrics.error_feedback_by_code },
  };
}

function resetMcpErrorFeedbackMetrics() {
  errorFeedbackMetrics.error_feedback_normalized_total = 0;
  errorFeedbackMetrics.error_stack_sanitized_total = 0;
  errorFeedbackMetrics.error_path_sanitized_total = 0;
  errorFeedbackMetrics.error_message_truncated_total = 0;
  errorFeedbackMetrics.error_fixed_suggestion_enforced_total = 0;
  errorFeedbackMetrics.error_feedback_by_code = Object.create(null);
}

function validationError(validation, options) {
  const schemaCompensationRaw = buildValidationSchemaCompensation(validation, options);
  const schemaCompensation =
    schemaCompensationRaw && typeof schemaCompensationRaw === "object"
      ? {
          ...schemaCompensationRaw,
          ...(normalizeSchemaRef(schemaCompensationRaw.schema_ref)
            ? { schema_ref: normalizeSchemaRef(schemaCompensationRaw.schema_ref) }
            : {}),
          ...(normalizeSchemaRef(schemaCompensationRaw.tool_schema_ref)
            ? {
                tool_schema_ref: normalizeSchemaRef(
                  schemaCompensationRaw.tool_schema_ref
                ),
              }
            : {}),
        }
      : null;
  return {
    statusCode: validation.statusCode,
    body: withMcpErrorFeedback({
      status: "rejected",
      error_code: validation.errorCode,
      message: validation.message,
      ...(schemaCompensation && typeof schemaCompensation === "object"
        ? schemaCompensation
        : {}),
    }),
  };
}

module.exports = {
  withMcpErrorFeedback,
  validationError,
  getMcpErrorFeedbackMetricsSnapshot,
  resetMcpErrorFeedbackMetrics,
};

