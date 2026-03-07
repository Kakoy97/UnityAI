"use strict";

const { SSOT_QUERY_TYPES } = require("./queryTypes");
const {
  createTokenLifecycleOrchestrator,
  getTokenLifecycleOrchestratorSingleton,
} = require("./tokenLifecycleOrchestrator");
const {
  createTokenDriftRecoveryCoordinator,
  getTokenDriftRecoveryCoordinatorSingleton,
} = require("./tokenDriftRecoveryCoordinator");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeErrorCode(value) {
  return normalizeString(value).toUpperCase();
}

function toNonNegativeInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Math.floor(Number(fallback) || 0);
  }
  return Math.floor(n);
}

function clonePayload(payload) {
  const source = isObject(payload) ? payload : {};
  return JSON.parse(JSON.stringify(source));
}

function buildSsotQueryPayload(toolName, payload) {
  const normalizedToolName = normalizeString(toolName);
  if (!normalizedToolName) {
    throw new Error("SSOT tool name is required.");
  }

  const source = isObject(payload) ? payload : {};
  const payloadJson = JSON.stringify(source);
  return {
    tool_name: normalizedToolName,
    payload_json: payloadJson,
  };
}

function appendRequestIdSuffix(requestId, suffix) {
  const base = normalizeString(requestId);
  const normalizedSuffix = normalizeString(suffix);
  if (!normalizedSuffix) {
    return base;
  }
  if (!base) {
    return normalizedSuffix;
  }
  return `${base}:${normalizedSuffix}`;
}

function resolveResultErrorCode(result) {
  const source = isObject(result) ? result : {};
  const data = isObject(source.data) ? source.data : {};
  const context = isObject(source.context) ? source.context : {};
  return normalizeErrorCode(
    source.error_code || data.error_code || context.error_code
  );
}

function resolveResultErrorMessage(result, fallback) {
  const source = isObject(result) ? result : {};
  const data = isObject(source.data) ? source.data : {};
  const context = isObject(source.context) ? source.context : {};
  return (
    normalizeString(
      source.error_message ||
        source.message ||
        data.error_message ||
        context.error_message
    ) || normalizeString(fallback)
  );
}

function resolveResultNestedErrorCode(result) {
  const source = isObject(result) ? result : {};
  const data = isObject(source.data) ? source.data : {};
  const context = isObject(source.context) ? source.context : {};
  return normalizeErrorCode(
    source.nested_error_code ||
      data.nested_error_code ||
      context.nested_error_code ||
      source.failed_error_code ||
      data.failed_error_code ||
      context.failed_error_code
  );
}

function buildValidationFailureResult(preDispatchValidation) {
  const blockedErrorCode =
    normalizeString(preDispatchValidation.error_code) || "E_TOKEN_UNKNOWN";
  return {
    ok: false,
    error_code: blockedErrorCode,
    error_message:
      normalizeString(preDispatchValidation.message) ||
      "based_on_read_token validation failed.",
    suggestion: normalizeString(preDispatchValidation.suggestion),
    retry_policy:
      preDispatchValidation.retry_policy &&
      typeof preDispatchValidation.retry_policy === "object"
        ? { ...preDispatchValidation.retry_policy }
        : null,
    context:
      preDispatchValidation.context &&
      typeof preDispatchValidation.context === "object"
        ? { ...preDispatchValidation.context }
        : {
            stage: "before_write",
            previous_operation: "validate_write_token",
          },
  };
}

function buildErrorResultFromException(error, fallback) {
  const source = isObject(error) ? error : {};
  const fallbackMessage =
    typeof fallback === "string" ? fallback : "Unity SSOT dispatch failed.";
  return {
    ok: false,
    error_code: normalizeString(source.error_code) || "E_SSOT_ROUTE_FAILED",
    error_message:
      normalizeString(source.error_message || source.message) || fallbackMessage,
    context:
      source.context && typeof source.context === "object"
        ? { ...source.context }
        : {
            stage: "during_dispatch",
            previous_operation: "dispatch_ssot_request",
          },
    data:
      source.data && typeof source.data === "object" && !Array.isArray(source.data)
        ? { ...source.data }
        : {},
  };
}

function withTokenAutomation(result, tokenAutomation, diagnostics = {}) {
  const base = isObject(result)
    ? result
    : {
        ok: false,
        error_code: "E_SSOT_ROUTE_FAILED",
        error_message: "Unity SSOT dispatch failed.",
      };
  const baseData = isObject(base.data) ? base.data : {};
  const automation = isObject(tokenAutomation) ? { ...tokenAutomation } : {};
  const details = isObject(diagnostics) ? { ...diagnostics } : {};
  return {
    ...base,
    ...details,
    ...automation,
    token_automation: automation,
    data: {
      ...baseData,
      ...details,
      ...automation,
      token_automation: automation,
    },
  };
}

function resolveTokenLifecycleOrchestrator(options = {}) {
  const opts = isObject(options) ? options : {};
  if (
    opts.tokenLifecycleOrchestrator &&
    typeof opts.tokenLifecycleOrchestrator === "object"
  ) {
    return opts.tokenLifecycleOrchestrator;
  }

  const hasCustomDependencies =
    !!opts.validatorRegistry ||
    !!opts.tokenRegistry ||
    !!opts.revisionState ||
    !!opts.tokenPolicyRuntime ||
    Object.prototype.hasOwnProperty.call(opts, "tokenAutoIssueEnabled");
  if (hasCustomDependencies) {
    return createTokenLifecycleOrchestrator({
      validatorRegistry: opts.validatorRegistry,
      tokenRegistry: opts.tokenRegistry,
      revisionState: opts.revisionState,
      tokenPolicyRuntime: opts.tokenPolicyRuntime,
      tokenAutoIssueEnabled: opts.tokenAutoIssueEnabled,
    });
  }
  return getTokenLifecycleOrchestratorSingleton();
}

function resolveTokenDriftRecoveryCoordinator(options = {}) {
  const opts = isObject(options) ? options : {};
  if (
    opts.tokenDriftRecoveryCoordinator &&
    typeof opts.tokenDriftRecoveryCoordinator === "object"
  ) {
    return opts.tokenDriftRecoveryCoordinator;
  }
  const hasCustomDependencies =
    !!opts.tokenPolicyRuntime ||
    Object.prototype.hasOwnProperty.call(opts, "tokenAutoRetryShadowEnabled") ||
    Object.prototype.hasOwnProperty.call(opts, "tokenAutoRetryEnabled");
  if (hasCustomDependencies) {
    return createTokenDriftRecoveryCoordinator({
      tokenPolicyRuntime: opts.tokenPolicyRuntime,
      shadowModeEnabled: opts.tokenAutoRetryShadowEnabled !== false,
      autoRetryEnabled: opts.tokenAutoRetryEnabled === true,
    });
  }
  return getTokenDriftRecoveryCoordinatorSingleton();
}

function maybeRecordTokenDriftRecoveryShadowDecision(input = {}) {
  const source = isObject(input) ? input : {};
  const coordinator =
    source.tokenDriftRecoveryCoordinator &&
    typeof source.tokenDriftRecoveryCoordinator === "object"
      ? source.tokenDriftRecoveryCoordinator
      : null;
  if (
    !coordinator ||
    typeof coordinator.evaluateShadowDecision !== "function"
  ) {
    return null;
  }
  return coordinator.evaluateShadowDecision({
    tool_name: source.toolName,
    error_code: source.errorCode,
    payload: source.payload,
    request_id: source.requestId,
    thread_id: source.threadId,
    turn_id: source.turnId,
    stage: source.stage,
  });
}

function maybeIssueReadTokenFromResponse(options = {}) {
  const orchestrator = resolveTokenLifecycleOrchestrator(options);
  if (
    !orchestrator ||
    typeof orchestrator.maybeIssueReadTokenFromResponse !== "function"
  ) {
    return isObject(options.result) ? options.result : options.result;
  }
  return orchestrator.maybeIssueReadTokenFromResponse({
    toolName: options.toolName,
    result: options.result,
    tokenRegistry: options.tokenRegistry,
    validatorRegistry: options.validatorRegistry,
    tokenPolicyRuntime: options.tokenPolicyRuntime,
  });
}

function maybeUpdateLatestKnownSceneRevisionFromResponse(options = {}) {
  const orchestrator = resolveTokenLifecycleOrchestrator(options);
  if (
    !orchestrator ||
    typeof orchestrator.maybeUpdateLatestKnownSceneRevisionFromResponse !==
      "function"
  ) {
    return isObject(options.result) ? options.result : options.result;
  }
  return orchestrator.maybeUpdateLatestKnownSceneRevisionFromResponse({
    toolName: options.toolName,
    result: options.result,
    revisionState: options.revisionState,
    requestId: options.requestId,
    threadId: options.threadId,
    turnId: options.turnId,
  });
}

async function executeAttempt(options) {
  const source = isObject(options) ? options : {};
  const tokenLifecycleOrchestrator = source.tokenLifecycleOrchestrator;
  const preDispatchValidation =
    tokenLifecycleOrchestrator.validateBeforeDispatch({
      toolName: source.toolName,
      payload: source.payload,
    });
  if (!preDispatchValidation || preDispatchValidation.ok !== true) {
    return {
      result: buildValidationFailureResult(preDispatchValidation || {}),
      stage: "before_write_validation",
      validation: preDispatchValidation || {},
    };
  }

  const queryPayload = buildSsotQueryPayload(source.toolName, source.payload);
  const unityResult = await source.enqueueAndWaitForUnityQuery({
    queryType: SSOT_QUERY_TYPES.SSOT_REQUEST,
    payload: queryPayload,
    queryPayloadJson: JSON.stringify(queryPayload),
    timeoutMs: source.timeoutMs,
    requestId: normalizeString(source.requestId),
    threadId: normalizeString(source.threadId),
    turnId: normalizeString(source.turnId),
  });
  const finalized = tokenLifecycleOrchestrator.finalizeDispatchResult({
    toolName: source.toolName,
    result: unityResult,
    revisionState: source.revisionState,
    requestId: source.requestId,
    threadId: source.threadId,
    turnId: source.turnId,
    tokenRegistry: source.tokenRegistry,
    validatorRegistry: source.validatorRegistry,
    tokenPolicyRuntime: source.tokenPolicyRuntime,
    tokenAutoIssueEnabled: source.tokenAutoIssueEnabled,
  });
  return {
    result: finalized,
    stage: isObject(finalized) && finalized.ok !== true ? "during_dispatch" : "success",
    validation: preDispatchValidation,
  };
}

function isInFlightTransactionDriftFailure(options = {}) {
  const source = isObject(options) ? options : {};
  const toolName = normalizeString(source.toolName);
  const stage = normalizeString(source.stage);
  const driftErrorCode = normalizeErrorCode(source.driftErrorCode);
  const result = source.result;
  if (toolName !== "execute_unity_transaction") {
    return false;
  }
  if (stage !== "during_dispatch") {
    return false;
  }
  if (resolveResultErrorCode(result) !== "E_TRANSACTION_STEP_FAILED") {
    return false;
  }
  return resolveResultNestedErrorCode(result) === driftErrorCode;
}

async function tryAutoRecoverFromDrift(options) {
  const source = isObject(options) ? options : {};
  const coordinator = source.tokenDriftRecoveryCoordinator;
  const initialResult = isObject(source.initialResult) ? source.initialResult : {};
  const toolName = normalizeString(source.toolName);
  const payload = clonePayload(source.payload);
  const requestId = normalizeString(source.requestId);
  const threadId = normalizeString(source.threadId);
  const turnId = normalizeString(source.turnId);
  const initialErrorCode = resolveResultErrorCode(initialResult);
  const initialErrorMessage = resolveResultErrorMessage(
    initialResult,
    "Scene revision drift detected."
  );

  if (!coordinator || typeof coordinator.startRecovery !== "function") {
    return initialResult;
  }

  const recoveryTicket = coordinator.startRecovery({
    tool_name: toolName,
    error_code: initialErrorCode,
    payload,
    request_id: requestId,
    thread_id: threadId,
    turn_id: turnId,
    stage: source.initialStage,
  });
  const blockedDecision =
    recoveryTicket && isObject(recoveryTicket.decision)
      ? recoveryTicket.decision
      : {};
  const refreshToolName =
    normalizeString(blockedDecision.refresh_tool_name) ||
    "get_scene_snapshot_for_write";
  if (!recoveryTicket || recoveryTicket.ok !== true) {
    return withTokenAutomation(
      initialResult,
      {
        auto_recovery_triggered: false,
        auto_recovery_reason: "scene_revision_drift",
        auto_recovery_blocked_reason:
          normalizeString(blockedDecision.blocked_reason) ||
          "auto_recovery_not_available",
        auto_retry_attempted: false,
        auto_retry_succeeded: false,
      },
      {
        initial_error_code: initialErrorCode,
        initial_error_message: initialErrorMessage,
        next_suggested_action: refreshToolName,
      }
    );
  }

  const decision = recoveryTicket.decision;
  const lease = recoveryTicket.lease;
  const policyLimits = isObject(decision.policy_limits)
    ? decision.policy_limits
    : {};
  const snapshotRefreshTimeoutMs = toNonNegativeInteger(
    policyLimits.snapshot_refresh_timeout_ms,
    2000
  );
  const retryDispatchTimeoutMs = toNonNegativeInteger(
    policyLimits.retry_dispatch_timeout_ms,
    5000
  );
  const totalRecoveryTimeoutMs = toNonNegativeInteger(
    policyLimits.total_recovery_timeout_ms,
    8000
  );
  const recoveryStartedAt = Date.now();
  const driftErrorCode = normalizeErrorCode(
    source.driftErrorCode || "E_SCENE_REVISION_DRIFT"
  );

  let recoverySucceeded = false;
  let recoveryFailureReason = "";
  let responseResult = initialResult;

  try {
    const refreshAttempt = await executeAttempt({
      enqueueAndWaitForUnityQuery: source.enqueueAndWaitForUnityQuery,
      tokenLifecycleOrchestrator: source.tokenLifecycleOrchestrator,
      toolName: refreshToolName,
      payload: {},
      timeoutMs: snapshotRefreshTimeoutMs,
      requestId: appendRequestIdSuffix(requestId, "auto_retry_refresh"),
      threadId,
      turnId,
      revisionState: source.revisionState,
      tokenRegistry: source.tokenRegistry,
      validatorRegistry: source.validatorRegistry,
      tokenPolicyRuntime: source.tokenPolicyRuntime,
      tokenAutoIssueEnabled: source.tokenAutoIssueEnabled,
    });
    const refreshResult = isObject(refreshAttempt.result)
      ? refreshAttempt.result
      : {};
    if (refreshResult.ok !== true) {
      recoveryFailureReason = "snapshot_refresh_failed";
      responseResult = withTokenAutomation(
        refreshResult,
        {
          auto_recovery_triggered: true,
          auto_recovery_reason: "scene_revision_drift",
          auto_retry_attempted: true,
          auto_retry_succeeded: false,
          auto_retry_failure_reason: recoveryFailureReason,
          recovery_source: "scene_snapshot_refresh",
        },
        {
          initial_error_code: initialErrorCode,
          initial_error_message: initialErrorMessage,
          retry_error_code: resolveResultErrorCode(refreshResult),
          retry_error_message: resolveResultErrorMessage(refreshResult),
          next_suggested_action: refreshToolName,
        }
      );
      return responseResult;
    }

    const refreshData = isObject(refreshResult.data) ? refreshResult.data : {};
    const refreshedToken = normalizeString(refreshData.read_token_candidate);
    const existingToken = normalizeString(payload.based_on_read_token);
    if (!refreshedToken) {
      recoveryFailureReason = "refresh_token_missing";
      responseResult = withTokenAutomation(
        {
          ok: false,
          error_code: "E_TOKEN_AUTO_RETRY_REFRESH_TOKEN_MISSING",
          error_message:
            "Auto retry snapshot refresh succeeded but no read_token_candidate was issued.",
        },
        {
          auto_recovery_triggered: true,
          auto_recovery_reason: "scene_revision_drift",
          auto_retry_attempted: true,
          auto_retry_succeeded: false,
          auto_retry_failure_reason: recoveryFailureReason,
          recovery_source: "scene_snapshot_refresh",
        },
        {
          initial_error_code: initialErrorCode,
          initial_error_message: initialErrorMessage,
          retry_error_code: "E_TOKEN_AUTO_RETRY_REFRESH_TOKEN_MISSING",
          retry_error_message:
            "Refresh token candidate is missing in snapshot refresh response.",
          next_suggested_action: refreshToolName,
        }
      );
      return responseResult;
    }

    if (existingToken && refreshedToken === existingToken) {
      recoveryFailureReason = "refresh_token_unchanged";
      responseResult = withTokenAutomation(
        {
          ok: false,
          error_code: "E_TOKEN_AUTO_RETRY_REFRESH_TOKEN_UNCHANGED",
          error_message:
            "Auto retry refresh did not produce a new token. Manual refresh is required.",
        },
        {
          auto_recovery_triggered: true,
          auto_recovery_reason: "scene_revision_drift",
          auto_retry_attempted: true,
          auto_retry_succeeded: false,
          auto_retry_failure_reason: recoveryFailureReason,
          recovery_source: "scene_snapshot_refresh",
        },
        {
          initial_error_code: initialErrorCode,
          initial_error_message: initialErrorMessage,
          retry_error_code: "E_TOKEN_AUTO_RETRY_REFRESH_TOKEN_UNCHANGED",
          retry_error_message:
            "Snapshot refresh returned a token identical to the stale token.",
          next_suggested_action: refreshToolName,
        }
      );
      return responseResult;
    }

    const elapsedAfterRefresh = Math.max(0, Date.now() - recoveryStartedAt);
    if (
      totalRecoveryTimeoutMs > 0 &&
      elapsedAfterRefresh > totalRecoveryTimeoutMs
    ) {
      recoveryFailureReason = "recovery_timeout";
      responseResult = withTokenAutomation(
        {
          ok: false,
          error_code: "E_TOKEN_AUTO_RETRY_TIMEOUT",
          error_message:
            "Auto retry timed out before replay dispatch.",
        },
        {
          auto_recovery_triggered: true,
          auto_recovery_reason: "scene_revision_drift",
          auto_retry_attempted: true,
          auto_retry_succeeded: false,
          auto_retry_failure_reason: recoveryFailureReason,
          auto_retry_timeout: true,
          recovery_source: "scene_snapshot_refresh",
        },
        {
          initial_error_code: initialErrorCode,
          initial_error_message: initialErrorMessage,
          retry_error_code: "E_TOKEN_AUTO_RETRY_TIMEOUT",
          retry_error_message: "Auto retry timeout budget exceeded.",
          next_suggested_action: refreshToolName,
        }
      );
      return responseResult;
    }

    const replayPayload = clonePayload(payload);
    replayPayload.based_on_read_token = refreshedToken;

    const replayAttempt = await executeAttempt({
      enqueueAndWaitForUnityQuery: source.enqueueAndWaitForUnityQuery,
      tokenLifecycleOrchestrator: source.tokenLifecycleOrchestrator,
      toolName,
      payload: replayPayload,
      timeoutMs: retryDispatchTimeoutMs,
      requestId: appendRequestIdSuffix(requestId, "auto_retry_replay"),
      threadId,
      turnId,
      revisionState: source.revisionState,
      tokenRegistry: source.tokenRegistry,
      validatorRegistry: source.validatorRegistry,
      tokenPolicyRuntime: source.tokenPolicyRuntime,
      tokenAutoIssueEnabled: source.tokenAutoIssueEnabled,
    });

    const replayResult = isObject(replayAttempt.result) ? replayAttempt.result : {};
    if (replayResult.ok === true) {
      recoverySucceeded = true;
      responseResult = withTokenAutomation(
        replayResult,
        {
          auto_recovery_triggered: true,
          auto_recovery_reason: "scene_revision_drift",
          auto_retry_attempted: true,
          auto_retry_succeeded: true,
          recovery_source: "scene_snapshot_refresh",
          refreshed_token_issued: true,
        },
        {
          initial_error_code: initialErrorCode,
          initial_error_message: initialErrorMessage,
        }
      );
      return responseResult;
    }

    const retryErrorCode = resolveResultErrorCode(replayResult);
    recoveryFailureReason =
      retryErrorCode === driftErrorCode
        ? "retry_result_drift"
        : "retry_dispatch_failed";
    responseResult = withTokenAutomation(
      replayResult,
      {
        auto_recovery_triggered: true,
        auto_recovery_reason: "scene_revision_drift",
        auto_retry_attempted: true,
        auto_retry_succeeded: false,
        auto_retry_failure_reason: recoveryFailureReason,
        recovery_source: "scene_snapshot_refresh",
      },
      {
        initial_error_code: initialErrorCode,
        initial_error_message: initialErrorMessage,
        retry_error_code: retryErrorCode,
        retry_error_message: resolveResultErrorMessage(replayResult),
        next_suggested_action: refreshToolName,
      }
    );
    return responseResult;
  } catch (error) {
    recoveryFailureReason = "recovery_exception";
    const exceptionResult = buildErrorResultFromException(
      error,
      "Auto retry execution failed."
    );
    responseResult = withTokenAutomation(
      exceptionResult,
      {
        auto_recovery_triggered: true,
        auto_recovery_reason: "scene_revision_drift",
        auto_retry_attempted: true,
        auto_retry_succeeded: false,
        auto_retry_failure_reason: recoveryFailureReason,
        recovery_source: "scene_snapshot_refresh",
      },
      {
        initial_error_code: initialErrorCode,
        initial_error_message: initialErrorMessage,
        retry_error_code: resolveResultErrorCode(exceptionResult),
        retry_error_message: resolveResultErrorMessage(exceptionResult),
        next_suggested_action: refreshToolName,
      }
    );
    return responseResult;
  } finally {
    if (coordinator && typeof coordinator.finishRecovery === "function") {
      const completed = coordinator.finishRecovery({
        lease,
        succeeded: recoverySucceeded,
        failure_reason: recoveryFailureReason,
      });
      const durationMs = toNonNegativeInteger(
        completed && completed.duration_ms,
        Math.max(0, Date.now() - recoveryStartedAt)
      );
      responseResult = withTokenAutomation(
        responseResult,
        {
          ...(isObject(responseResult.token_automation)
            ? responseResult.token_automation
            : {}),
          auto_recovery_duration_ms: durationMs,
        },
        {}
      );
    }
  }
}

async function dispatchSsotRequest(options) {
  const opts = isObject(options) ? options : {};
  const enqueueAndWaitForUnityQuery = opts.enqueueAndWaitForUnityQuery;
  if (typeof enqueueAndWaitForUnityQuery !== "function") {
    throw new Error("Unity query runtime is not configured.");
  }
  const tokenLifecycleOrchestrator = resolveTokenLifecycleOrchestrator(opts);
  const tokenDriftRecoveryCoordinator =
    resolveTokenDriftRecoveryCoordinator(opts);
  if (
    !tokenLifecycleOrchestrator ||
    typeof tokenLifecycleOrchestrator.validateBeforeDispatch !== "function" ||
    typeof tokenLifecycleOrchestrator.finalizeDispatchResult !== "function"
  ) {
    throw new Error("SSOT token lifecycle orchestrator is not configured.");
  }

  const firstAttempt = await executeAttempt({
    enqueueAndWaitForUnityQuery,
    tokenLifecycleOrchestrator,
    toolName: opts.toolName,
    payload: opts.payload,
    timeoutMs: opts.timeoutMs,
    requestId: normalizeString(opts.requestId),
    threadId: normalizeString(opts.threadId),
    turnId: normalizeString(opts.turnId),
    revisionState: opts.revisionState,
    tokenRegistry: opts.tokenRegistry,
    validatorRegistry: opts.validatorRegistry,
    tokenPolicyRuntime: opts.tokenPolicyRuntime,
    tokenAutoIssueEnabled: opts.tokenAutoIssueEnabled,
  });

  const firstResult = firstAttempt.result;
  if (isObject(firstResult) && firstResult.ok === true) {
    return firstResult;
  }

  const initialErrorCode = resolveResultErrorCode(firstResult);
  maybeRecordTokenDriftRecoveryShadowDecision({
    tokenDriftRecoveryCoordinator,
    toolName: opts.toolName,
    errorCode: initialErrorCode,
    payload: opts.payload,
    requestId: opts.requestId,
    threadId: opts.threadId,
    turnId: opts.turnId,
    stage: firstAttempt.stage,
  });

  const contractSnapshot =
    tokenDriftRecoveryCoordinator &&
    typeof tokenDriftRecoveryCoordinator.getContractSnapshot === "function"
      ? tokenDriftRecoveryCoordinator.getContractSnapshot()
      : {};
  const driftErrorCode = normalizeErrorCode(
    (isObject(contractSnapshot.drift_recovery)
      ? contractSnapshot.drift_recovery.error_code
      : "") || "E_SCENE_REVISION_DRIFT"
  );

  if (
    isInFlightTransactionDriftFailure({
      toolName: opts.toolName,
      stage: firstAttempt.stage,
      result: firstResult,
      driftErrorCode,
    })
  ) {
    return withTokenAutomation(
      firstResult,
      {
        auto_recovery_triggered: false,
        auto_recovery_reason: "scene_revision_drift",
        auto_recovery_blocked_reason: "inflight_transaction_failure",
        auto_retry_attempted: false,
        auto_retry_succeeded: false,
      },
      {
        initial_error_code: resolveResultErrorCode(firstResult),
        initial_error_message: resolveResultErrorMessage(firstResult),
        next_suggested_action: "get_scene_snapshot_for_write",
      }
    );
  }

  if (initialErrorCode !== driftErrorCode) {
    return firstResult;
  }

  return tryAutoRecoverFromDrift({
    tokenDriftRecoveryCoordinator,
    tokenLifecycleOrchestrator,
    enqueueAndWaitForUnityQuery,
    tokenPolicyRuntime: opts.tokenPolicyRuntime,
    validatorRegistry: opts.validatorRegistry,
    tokenRegistry: opts.tokenRegistry,
    revisionState: opts.revisionState,
    tokenAutoIssueEnabled: opts.tokenAutoIssueEnabled,
    toolName: opts.toolName,
    payload: opts.payload,
    requestId: opts.requestId,
    threadId: opts.threadId,
    turnId: opts.turnId,
    initialResult: firstResult,
    initialStage: firstAttempt.stage,
    driftErrorCode,
  });
}

module.exports = {
  buildSsotQueryPayload,
  maybeUpdateLatestKnownSceneRevisionFromResponse,
  maybeIssueReadTokenFromResponse,
  dispatchSsotRequest,
};
