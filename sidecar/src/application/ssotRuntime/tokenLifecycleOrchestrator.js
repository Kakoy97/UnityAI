"use strict";

const { SSOT_QUERY_TYPES } = require("./queryTypes");
const { validateSsotWriteToken } = require("./ssotWriteTokenGuard");
const { getSsotTokenRegistrySingleton } = require("./ssotTokenRegistry");
const { getSsotRevisionStateSingleton } = require("./ssotRevisionState");
const { getValidatorRegistrySingleton } = require("./validatorRegistry");
const {
  getTokenPolicyRuntimeSingleton,
} = require("./tokenPolicyRuntime");
const {
  getTokenLifecycleMetricsCollectorSingleton,
} = require("./tokenLifecycleMetricsCollector");
const {
  stripTokenEnvelope,
  resolveTokenIssuanceDecision,
} = require("./tokenIssuancePolicy");

let tokenLifecycleOrchestratorSingleton = null;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToolKind(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeTokenFamily(value) {
  return normalizeString(value).toLowerCase();
}

function hasTokenEnvelopeFields(result) {
  const source = isObject(result) ? result : null;
  if (!source) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(source, "read_token")) {
    return true;
  }
  const data = isObject(source.data) ? source.data : null;
  if (!data) {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(data, "read_token_candidate") ||
    Object.prototype.hasOwnProperty.call(data, "read_token_candidate_legacy")
  );
}

function resolveFallbackToolPolicy(toolName, validatorRegistry) {
  const registry =
    validatorRegistry &&
    typeof validatorRegistry.getToolMetadata === "function"
      ? validatorRegistry
      : null;
  if (!registry) {
    return {
      name: normalizeString(toolName),
      kind: "read",
      token_family: "read_issues_token",
      scene_revision_capable: true,
      requires_based_on_read_token: false,
    };
  }
  const metadata = registry.getToolMetadata(toolName);
  const kind = normalizeToolKind(metadata && metadata.kind) || "read";
  return {
    name: normalizeString(toolName),
    kind,
    token_family: kind === "write" ? "write_requires_token" : "read_issues_token",
    scene_revision_capable: true,
    requires_based_on_read_token: kind === "write",
  };
}

function createTokenLifecycleOrchestrator(options = {}) {
  const opts = isObject(options) ? options : {};
  const tokenRegistry = opts.tokenRegistry || getSsotTokenRegistrySingleton();
  const revisionState = opts.revisionState || getSsotRevisionStateSingleton();
  const validatorRegistry =
    opts.validatorRegistry || getValidatorRegistrySingleton();
  const tokenPolicyRuntime =
    opts.tokenPolicyRuntime || getTokenPolicyRuntimeSingleton();
  const tokenAutoIssueEnabled = opts.tokenAutoIssueEnabled !== false;
  const metricsCollector =
    opts.metricsCollector || getTokenLifecycleMetricsCollectorSingleton();

  function resolveToolPolicy(toolName) {
    const normalizedToolName = normalizeString(toolName);
    if (!normalizedToolName) {
      return null;
    }
    if (
      tokenPolicyRuntime &&
      typeof tokenPolicyRuntime.getToolPolicy === "function"
    ) {
      const policy = tokenPolicyRuntime.getToolPolicy(normalizedToolName);
      if (policy && typeof policy === "object") {
        return policy;
      }
    }
    return resolveFallbackToolPolicy(normalizedToolName, validatorRegistry);
  }

  function validateBeforeDispatch(input = {}) {
    const source = isObject(input) ? input : {};
    const toolName = normalizeString(source.toolName);
    const payload = isObject(source.payload) ? source.payload : {};
    const toolPolicy = resolveToolPolicy(toolName);
    if (!toolPolicy) {
      return {
        ok: true,
        tool_policy: null,
      };
    }

    const tokenFamily = normalizeTokenFamily(toolPolicy.token_family);
    if (tokenFamily !== "write_requires_token") {
      return {
        ok: true,
        tool_policy: toolPolicy,
      };
    }

    const tokenValidation = validateSsotWriteToken({
      tokenRegistry,
      revisionState,
      token: payload.based_on_read_token,
    });
    if (tokenValidation.ok === true) {
      return {
        ok: true,
        tool_policy: toolPolicy,
        token_validation: tokenValidation,
      };
    }
    const errorCode = normalizeString(tokenValidation.error_code) || "E_TOKEN_UNKNOWN";
    return {
      ok: false,
      error_code: errorCode,
      statusCode:
        Number.isFinite(Number(tokenValidation.statusCode)) &&
        Number(tokenValidation.statusCode) > 0
          ? Math.floor(Number(tokenValidation.statusCode))
          : 409,
      message:
        normalizeString(tokenValidation.message) ||
        "based_on_read_token validation failed.",
      suggestion: normalizeString(tokenValidation.suggestion),
      retry_policy:
        tokenValidation.retry_policy &&
        typeof tokenValidation.retry_policy === "object"
          ? { ...tokenValidation.retry_policy }
          : null,
      context: {
        stage: "before_write",
        previous_operation: "validate_write_token",
        scene_revision_changed: errorCode === "E_SCENE_REVISION_DRIFT",
      },
      tool_policy: toolPolicy,
    };
  }

  function maybeUpdateLatestKnownSceneRevisionFromResponse(input = {}) {
    const source = isObject(input) ? input : {};
    const result = isObject(source.result) ? source.result : null;
    if (!result || result.ok !== true) {
      return result;
    }
    const toolPolicy = isObject(source.toolPolicy)
      ? source.toolPolicy
      : resolveToolPolicy(source.toolName);
    if (
      toolPolicy &&
      Object.prototype.hasOwnProperty.call(toolPolicy, "scene_revision_capable") &&
      toolPolicy.scene_revision_capable !== true
    ) {
      return result;
    }

    const data = isObject(result.data) ? result.data : {};
    const sceneRevision =
      normalizeString(data.scene_revision) ||
      normalizeString(result.scene_revision);
    if (!sceneRevision) {
      return result;
    }

    const state =
      source.revisionState && typeof source.revisionState === "object"
        ? source.revisionState
        : revisionState;
    if (
      !state ||
      typeof state.updateLatestKnownSceneRevision !== "function"
    ) {
      return result;
    }
    state.updateLatestKnownSceneRevision(sceneRevision, {
      source_tool_name: normalizeString(source.toolName),
      source_query_type: SSOT_QUERY_TYPES.SSOT_REQUEST,
      source_request_id: normalizeString(source.requestId),
      source_thread_id: normalizeString(source.threadId),
      source_turn_id: normalizeString(source.turnId),
    });
    return result;
  }

  function issueReadTokenFromDecision(decision, source) {
    const result = decision.result;
    const data = isObject(result && result.data) ? result.data : {};
    const registry =
      source.tokenRegistry && typeof source.tokenRegistry === "object"
        ? source.tokenRegistry
        : tokenRegistry;
    if (!registry || typeof registry.issueToken !== "function") {
      return {
        result,
        decision,
        continuation_issued: false,
      };
    }

    const issued = registry.issueToken({
      source_tool_name: normalizeString(source.toolName),
      scene_revision: decision.scene_revision,
      scope_kind:
        decision.scope_kind ||
        (normalizeToolKind(decision.tool_kind) === "write"
          ? "write_result"
          : "scene"),
      object_id: decision.object_id,
      path: decision.path,
    });
    if (!issued || issued.ok !== true) {
      return {
        result,
        decision,
        continuation_issued: false,
      };
    }

    const outputData = {
      ...data,
      read_token_candidate: issued.token,
    };
    delete outputData.read_token_candidate_legacy;

    return {
      decision,
      continuation_issued: true,
      result: {
        ...result,
        data: outputData,
        read_token: {
          token: issued.token,
          issued_at: issued.issued_at,
          hard_max_age_ms: issued.hard_max_age_ms,
          revision_vector: {
            scene_revision: issued.scene_revision,
          },
          scope: {
            kind: issued.scope.kind,
            object_id: issued.scope.object_id,
            path: issued.scope.path,
          },
        },
      },
    };
  }

  function issueReadTokenFromResponseWithDecision(input = {}) {
    const source = isObject(input) ? input : {};
    const decision = resolveTokenIssuanceDecision({
      toolName: source.toolName,
      result: source.result,
      tokenPolicyRuntime:
        source.tokenPolicyRuntime && typeof source.tokenPolicyRuntime === "object"
          ? source.tokenPolicyRuntime
          : tokenPolicyRuntime,
      validatorRegistry:
        source.validatorRegistry && typeof source.validatorRegistry === "object"
          ? source.validatorRegistry
          : validatorRegistry,
    });
    if (!decision.should_issue) {
      return {
        result: decision.result,
        decision,
        continuation_issued: false,
      };
    }
    return issueReadTokenFromDecision(decision, source);
  }

  function maybeIssueReadTokenFromResponse(input = {}) {
    return issueReadTokenFromResponseWithDecision(input).result;
  }

  function recordFinalizeMetrics(eventInput = {}) {
    if (
      !metricsCollector ||
      typeof metricsCollector.recordFinalizeOutcome !== "function"
    ) {
      return;
    }
    metricsCollector.recordFinalizeOutcome(eventInput);
  }

  function resolveFinalizeAnomalyCode(input = {}) {
    const source = isObject(input) ? input : {};
    if (
      source.redaction_candidate === true &&
      source.redaction_applied !== true
    ) {
      return "TOKEN_REDACTION_FAILED";
    }
    if (
      source.continuation_eligible_success === true &&
      source.continuation_issued !== true &&
      source.decision_reason !== "scene_revision_missing" &&
      source.decision_reason !== "token_auto_issue_disabled"
    ) {
      return "CONTINUATION_ISSUE_FAILED";
    }
    if (
      source.continuation_eligible_success !== true &&
      source.continuation_issued === true
    ) {
      return "CONTINUATION_ISSUED_OUTSIDE_POLICY";
    }
    if (
      source.continuation_eligible_success === true &&
      source.continuation_issued !== true &&
      source.decision_reason === "scene_revision_missing"
    ) {
      return "CONTINUATION_SKIPPED_MISSING_SCENE_REVISION";
    }
    return "";
  }

  function finalizeDispatchResult(input = {}) {
    const startedAt = Date.now();
    const source = isObject(input) ? input : {};
    const toolName = normalizeString(source.toolName);
    const toolPolicy = isObject(source.toolPolicy)
      ? source.toolPolicy
      : resolveToolPolicy(toolName);
    const tokenFamily = normalizeTokenFamily(toolPolicy && toolPolicy.token_family);
    const revisionUpdatedResult = maybeUpdateLatestKnownSceneRevisionFromResponse({
      toolName,
      result: source.result,
      toolPolicy,
      revisionState:
        source.revisionState && typeof source.revisionState === "object"
          ? source.revisionState
          : revisionState,
      requestId: source.requestId,
      threadId: source.threadId,
      turnId: source.turnId,
    });
    const hadTokenEnvelopeBefore = hasTokenEnvelopeFields(revisionUpdatedResult);

    let finalized = null;
    let decision = null;
    let continuationIssued = false;
    if (source.tokenAutoIssueEnabled === false || tokenAutoIssueEnabled !== true) {
      decision = resolveTokenIssuanceDecision({
        toolName,
        result: revisionUpdatedResult,
        tokenPolicyRuntime:
          source.tokenPolicyRuntime && typeof source.tokenPolicyRuntime === "object"
            ? source.tokenPolicyRuntime
            : tokenPolicyRuntime,
        validatorRegistry:
          source.validatorRegistry && typeof source.validatorRegistry === "object"
            ? source.validatorRegistry
            : validatorRegistry,
      });
      finalized = stripTokenEnvelope(decision.result);
      continuationIssued = false;
      decision = {
        ...decision,
        reason: "token_auto_issue_disabled",
      };
    } else {
      const outcome = issueReadTokenFromResponseWithDecision({
        toolName,
        result: revisionUpdatedResult,
        tokenPolicyRuntime:
          source.tokenPolicyRuntime && typeof source.tokenPolicyRuntime === "object"
            ? source.tokenPolicyRuntime
            : tokenPolicyRuntime,
        validatorRegistry:
          source.validatorRegistry && typeof source.validatorRegistry === "object"
            ? source.validatorRegistry
            : validatorRegistry,
        tokenRegistry:
          source.tokenRegistry && typeof source.tokenRegistry === "object"
            ? source.tokenRegistry
            : tokenRegistry,
      });
      finalized = outcome.result;
      decision = outcome.decision;
      continuationIssued = outcome.continuation_issued === true;
    }
    const hadTokenEnvelopeAfter = hasTokenEnvelopeFields(finalized);
    const continuationEligibleSuccess =
      decision &&
      (decision.reason === "eligible" ||
        decision.reason === "scene_revision_missing");
    const redactionApplied =
      hadTokenEnvelopeBefore &&
      (!hadTokenEnvelopeAfter || continuationIssued === true);
    const skippedMissingSceneRevision =
      continuationEligibleSuccess && decision.reason === "scene_revision_missing";
    const skippedIneligiblePolicy =
      decision &&
      (decision.reason === "token_family_not_eligible" ||
        decision.reason === "tool_kind_not_eligible");
    const finalizeDurationMs = Math.max(0, Date.now() - startedAt);

    const anomalyCode = resolveFinalizeAnomalyCode({
      continuation_eligible_success: continuationEligibleSuccess,
      continuation_issued: continuationIssued,
      redaction_candidate: hadTokenEnvelopeBefore,
      redaction_applied: redactionApplied,
      decision_reason: decision ? decision.reason : "",
    });

    recordFinalizeMetrics({
      tool_name: toolName,
      token_family: tokenFamily,
      result_ok: isObject(revisionUpdatedResult) && revisionUpdatedResult.ok === true,
      continuation_eligible_success: continuationEligibleSuccess,
      continuation_issued: continuationIssued,
      skipped_missing_scene_revision: skippedMissingSceneRevision,
      skipped_ineligible_policy: skippedIneligiblePolicy,
      redaction_candidate: hadTokenEnvelopeBefore,
      redaction_applied: redactionApplied,
      anomaly_code: anomalyCode,
      decision_reason: decision ? decision.reason : "",
      finalize_duration_ms: finalizeDurationMs,
    });

    return finalized;
  }

  return {
    resolveToolPolicy,
    validateBeforeDispatch,
    maybeUpdateLatestKnownSceneRevisionFromResponse,
    maybeIssueReadTokenFromResponse,
    finalizeDispatchResult,
  };
}

function getTokenLifecycleOrchestratorSingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return createTokenLifecycleOrchestrator(options);
  }
  if (!tokenLifecycleOrchestratorSingleton) {
    tokenLifecycleOrchestratorSingleton = createTokenLifecycleOrchestrator();
  }
  return tokenLifecycleOrchestratorSingleton;
}

function resetTokenLifecycleOrchestratorSingletonForTests() {
  tokenLifecycleOrchestratorSingleton = null;
}

module.exports = {
  createTokenLifecycleOrchestrator,
  getTokenLifecycleOrchestratorSingleton,
  resetTokenLifecycleOrchestratorSingletonForTests,
};
