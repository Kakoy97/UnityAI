"use strict";

const { normalizeErrorCode } = require("../../utils/turnUtils");
const {
  getMcpErrorFeedbackTemplate,
} = require("./errorFeedbackTemplateRegistry");
const {
  getStaticToolCatalogSingleton,
} = require("../ssotRuntime/staticToolCatalog");
const { normalizeFailureContext } = require("./failureContextNormalizer");
const {
  listStructuredGuidanceErrorCodes,
  planRecoveryAction,
} = require("./recoveryPlanner");

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRetryPolicy(policy) {
  const source = normalizeObject(policy);
  if (Object.keys(source).length <= 0) {
    return null;
  }
  return source;
}

function tryLoadCatalog() {
  try {
    return getStaticToolCatalogSingleton();
  } catch {
    return null;
  }
}

function deriveStructuredGuidanceCodes() {
  const catalog = tryLoadCatalog();
  const codes = listStructuredGuidanceErrorCodes(
    catalog || { tools: [], byName: new Map() }
  );
  return Object.freeze(codes);
}

const STRUCTURED_GUIDANCE_ERROR_CODES = deriveStructuredGuidanceCodes();

function mergeMissingFields(...items) {
  const output = [];
  const seen = new Set();
  for (const item of items) {
    const list = Array.isArray(item) ? item : [];
    for (const raw of list) {
      const normalized = normalizeString(raw);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output;
}

function resolveErrorGuidance(options = {}) {
  const source = normalizeObject(options);
  const errorCode = normalizeErrorCode(source.error_code, "E_INTERNAL");
  const message = normalizeString(source.error_message);
  const toolName = normalizeString(source.tool_name);
  const fallbackStrategy = normalizeString(source.fallback_strategy);
  const template = getMcpErrorFeedbackTemplate(errorCode, message);
  const retryPolicy = normalizeRetryPolicy(
    source.retry_policy || template.retry_policy
  );

  const catalog = tryLoadCatalog();
  const globalContracts = normalizeObject(catalog && catalog.globalContracts);
  const toolRecord =
    catalog && catalog.byName instanceof Map
      ? catalog.byName.get(toolName) || null
      : null;
  const normalizedContext = normalizeFailureContext({
    errorCode,
    context: source.context,
    data: source.data,
    globalContracts,
    nowMs: source.now_ms,
  });

  const plan = planRecoveryAction({
    errorCode,
    toolName,
    toolRecord,
    catalog,
    globalContracts,
    failureContext: normalizedContext.context,
    fallbackStrategy,
    contextStale: normalizedContext.context_stale,
    requiresContextRefresh: normalizedContext.requires_context_refresh,
  });

  const allMissingFields = mergeMissingFields(
    normalizedContext.missing_fields,
    plan.context_requirement_missing
  );
  const contextMissing = allMissingFields.length > 0;
  const warningParts = [];
  if (contextMissing) {
    warningParts.push("error context is incomplete for structured recovery guidance");
  }
  if (normalizedContext.context_stale) {
    warningParts.push("error context snapshot is stale");
  }
  if (plan.plan_error_code) {
    warningParts.push(plan.plan_error_message || plan.plan_error_code);
  }
  const warning = warningParts.join("; ");

  return {
    recoverable: template.recoverable === true,
    suggestion:
      typeof template.suggestion === "string" ? template.suggestion : "",
    retry_policy: retryPolicy,
    suggested_action: plan.suggested_action,
    suggested_tool: plan.suggested_tool,
    fix_hint: plan.fix_hint,
    contextual_hint: plan.contextual_hint,
    fix_steps: Array.isArray(plan.fix_steps) ? plan.fix_steps : [],
    execution_order: plan.execution_order,
    failure_handling: plan.failure_handling,
    fallback_strategy: plan.fallback_strategy,
    requires_context_refresh: plan.requires_context_refresh === true,
    context_missing: contextMissing,
    missing_fields: allMissingFields,
    warning,
    recovery_plan_error_code: plan.plan_error_code || "",
    recovery_plan_error_message: plan.plan_error_message || "",
    routed_error_code: plan.routed_error_code || "",
    routed_source: plan.routed_source || "",
  };
}

module.exports = {
  STRUCTURED_GUIDANCE_ERROR_CODES,
  resolveErrorGuidance,
};
