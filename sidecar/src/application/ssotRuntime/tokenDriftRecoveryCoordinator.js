"use strict";

const crypto = require("node:crypto");
const {
  getTokenPolicyRuntimeSingleton,
} = require("./tokenPolicyRuntime");

let tokenDriftRecoveryCoordinatorSingleton = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeErrorCode(value) {
  return normalizeString(value).toUpperCase();
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toBoolean(value) {
  return value === true;
}

function toNonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Math.floor(Number(fallback) || 0);
  }
  return Math.floor(n);
}

function safeRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const output = {};
  for (const key of keys) {
    output[key] = stableClone(value[key]);
  }
  return output;
}

function buildRequestFingerprint(input = {}) {
  const source = isObject(input) ? input : {};
  const payload = isObject(source.payload) ? source.payload : {};
  const normalizedPayload = stableClone(payload);
  const digest = crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        tool_name: normalizeString(source.tool_name),
        idempotency_key: normalizeString(source.idempotency_key),
        request_id: normalizeString(source.request_id),
        thread_id: normalizeString(source.thread_id),
        turn_id: normalizeString(source.turn_id),
        payload: normalizedPayload,
      })
    )
    .digest("hex");
  return `shadow_${digest}`;
}

function createToolCounters() {
  return {
    events_total: 0,
    drift_error_total: 0,
    recoverable_total: 0,
    blocked_total: 0,
    stage_before_write_validation_total: 0,
    stage_during_dispatch_total: 0,
    stage_other_total: 0,
    blocked_by_reason: Object.create(null),
    token_family: "",
  };
}

function createEmptyState() {
  return {
    events_total: 0,
    drift_error_total: 0,
    recoverable_total: 0,
    blocked_total: 0,
    blocked_by_reason: Object.create(null),
    by_tool: Object.create(null),
    samples: [],
  };
}

function createRecoveryState() {
  return {
    attempt_total: 0,
    success_total: 0,
    fail_total: 0,
    blocked_total: 0,
    blocked_by_reason: Object.create(null),
    fail_by_reason: Object.create(null),
    triggered_by_tool: Object.create(null),
    duration_samples_ms: [],
  };
}

function bumpReasonCounter(target, reason) {
  const key = normalizeString(reason) || "unknown";
  const current = Number(target[key]) || 0;
  target[key] = current + 1;
}

function bumpNamedCounter(target, name, delta = 1) {
  const key = normalizeString(name) || "unknown";
  const current = Number(target[key]) || 0;
  target[key] = current + Number(delta || 0);
}

function getNamedCounter(target, name) {
  const key = normalizeString(name) || "unknown";
  return Number(target[key]) || 0;
}

function normalizeFiniteMs(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.floor(n);
}

function computePercentile(values, percentile) {
  const source = Array.isArray(values) ? values : [];
  if (source.length <= 0) {
    return 0;
  }
  const ordered = source
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .sort((a, b) => a - b);
  if (ordered.length <= 0) {
    return 0;
  }
  const p = Number(percentile);
  const normalizedP = Number.isFinite(p) ? Math.min(Math.max(p, 0), 1) : 0.95;
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * normalizedP) - 1)
  );
  return Math.floor(ordered[index]);
}

function appendSample(state, sample) {
  if (!Array.isArray(state.samples)) {
    state.samples = [];
  }
  if (state.samples.length >= 64) {
    return;
  }
  state.samples.push(sample);
}

function createTokenDriftRecoveryCoordinator(options = {}) {
  const opts = isObject(options) ? options : {};
  const tokenPolicyRuntime =
    opts.tokenPolicyRuntime || getTokenPolicyRuntimeSingleton();
  const shadowModeEnabled = opts.shadowModeEnabled !== false;
  const autoRetryEnabled = opts.autoRetryEnabled === true;
  const nowIso =
    typeof opts.nowIso === "function"
      ? opts.nowIso
      : () => new Date().toISOString();
  const nowMs =
    typeof opts.nowMs === "function"
      ? opts.nowMs
      : () => Date.now();
  const policyLimits = {
    snapshot_refresh_timeout_ms: toNonNegativeInteger(
      opts.snapshotRefreshTimeoutMs,
      2000
    ),
    retry_dispatch_timeout_ms: toNonNegativeInteger(
      opts.retryDispatchTimeoutMs,
      5000
    ),
    total_recovery_timeout_ms: toNonNegativeInteger(
      opts.totalRecoveryTimeoutMs,
      8000
    ),
    max_global_recovery_tasks: toNonNegativeInteger(
      opts.maxGlobalRecoveryTasks,
      10
    ),
    max_session_recovery_tasks: toNonNegativeInteger(
      opts.maxSessionRecoveryTasks,
      1
    ),
    max_tool_recovery_tasks: toNonNegativeInteger(opts.maxToolRecoveryTasks, 1),
    max_recovery_queue_size: toNonNegativeInteger(opts.maxRecoveryQueueSize, 10),
  };
  const shadowState = createEmptyState();
  const recoveryState = createRecoveryState();
  const inflightState = {
    global: 0,
    by_session: Object.create(null),
    by_tool: Object.create(null),
  };
  const replayLedgerByFingerprint = new Map();
  const replayLedgerTtlMs = normalizeFiniteMs(
    opts.replayLedgerTtlMs,
    Math.max(policyLimits.total_recovery_timeout_ms, 8000) * 4
  );

  function getContract() {
    if (
      tokenPolicyRuntime &&
      typeof tokenPolicyRuntime.getContract === "function"
    ) {
      return tokenPolicyRuntime.getContract();
    }
    return {
      drift_recovery: {
        enabled: false,
        error_code: "E_SCENE_REVISION_DRIFT",
        max_retry: 0,
        requires_idempotency: true,
        refresh_tool_name: "get_scene_snapshot_for_write",
      },
      auto_retry_policy: {
        max_retry: 1,
        requires_idempotency_key: true,
      },
      auto_retry_safe_family: [],
    };
  }

  function getToolPolicy(toolName) {
    if (
      tokenPolicyRuntime &&
      typeof tokenPolicyRuntime.getToolPolicy === "function"
    ) {
      return tokenPolicyRuntime.getToolPolicy(toolName);
    }
    return null;
  }

  function cleanupReplayLedger(now) {
    const threshold = Number(now) - Math.max(1000, replayLedgerTtlMs);
    for (const [fingerprint, ts] of replayLedgerByFingerprint.entries()) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= threshold) {
        replayLedgerByFingerprint.delete(fingerprint);
      }
    }
  }

  function buildEvaluationDecision(input = {}, runtime = {}) {
    const source = isObject(input) ? input : {};
    const mode =
      normalizeString(runtime.mode).toLowerCase() === "execute"
        ? "execute"
        : "shadow";
    const toolName = normalizeString(source.tool_name || source.toolName);
    const errorCode = normalizeErrorCode(source.error_code || source.errorCode);
    const payload = isObject(source.payload) ? source.payload : {};
    const contract = getContract();
    const driftRecovery = isObject(contract.drift_recovery)
      ? contract.drift_recovery
      : {};
    const autoRetryPolicy = isObject(contract.auto_retry_policy)
      ? contract.auto_retry_policy
      : {};
    const policyErrorCode = normalizeErrorCode(
      driftRecovery.error_code || "E_SCENE_REVISION_DRIFT"
    );
    const toolPolicy = getToolPolicy(toolName);
    const tokenFamily = normalizeString(toolPolicy && toolPolicy.token_family);
    const safeFamilySet = new Set(
      Array.isArray(contract.auto_retry_safe_family)
        ? contract.auto_retry_safe_family.map((item) => normalizeString(item))
        : []
    );
    const requiresIdempotency =
      toBoolean(autoRetryPolicy.requires_idempotency_key) ||
      toBoolean(driftRecovery.requires_idempotency);
    const idempotencyKey = normalizeString(payload.idempotency_key);
    const stage = normalizeString(source.stage) || "during_dispatch";
    const sessionKey =
      normalizeString(source.session_id || source.sessionId) ||
      normalizeString(source.thread_id || source.threadId) ||
      "__session_unknown__";
    const requestFingerprint = buildRequestFingerprint({
      tool_name: toolName,
      idempotency_key: idempotencyKey,
      request_id: source.request_id || source.requestId,
      thread_id: source.thread_id || source.threadId,
      turn_id: source.turn_id || source.turnId,
      payload,
    });
    const seenBefore = replayLedgerByFingerprint.has(requestFingerprint);
    const globalRecoveryInflight = toNonNegativeInteger(
      source.global_recovery_inflight,
      runtime.global_recovery_inflight
    );
    const sessionRecoveryInflight = toNonNegativeInteger(
      source.session_recovery_inflight,
      runtime.session_recovery_inflight
    );
    const toolRecoveryInflight = toNonNegativeInteger(
      source.tool_recovery_inflight,
      runtime.tool_recovery_inflight
    );
    const recoveryQueueSize = toNonNegativeInteger(
      source.recovery_queue_size,
      runtime.recovery_queue_size
    );
    const recoveryElapsedMs = toNonNegativeInteger(
      source.recovery_elapsed_ms,
      runtime.recovery_elapsed_ms
    );
    const idempotencyConflict =
      source.idempotency_conflict === true || seenBefore;

    let blockedReason = "";
    const driftErrorMatched = !!policyErrorCode && errorCode === policyErrorCode;
    if (mode === "shadow" && !shadowModeEnabled) {
      blockedReason = "shadow_mode_disabled";
    } else if (mode === "execute" && autoRetryEnabled !== true) {
      blockedReason = "auto_retry_disabled";
    } else if (driftRecovery.enabled !== true) {
      blockedReason = "drift_recovery_disabled";
    } else if (!driftErrorMatched) {
      blockedReason = "error_code_not_drift";
    } else if (!toolPolicy || !tokenFamily) {
      blockedReason = "tool_policy_missing";
    } else if (safeFamilySet.has(tokenFamily) !== true) {
      blockedReason = "tool_family_not_safe";
    } else if (requiresIdempotency && !idempotencyKey) {
      blockedReason = "idempotency_key_missing";
    } else if (idempotencyConflict) {
      blockedReason = "idempotency_conflict";
    } else if (
      policyLimits.max_global_recovery_tasks > 0 &&
      globalRecoveryInflight >= policyLimits.max_global_recovery_tasks
    ) {
      blockedReason = "global_limit";
    } else if (
      policyLimits.max_session_recovery_tasks > 0 &&
      sessionRecoveryInflight >= policyLimits.max_session_recovery_tasks
    ) {
      blockedReason = "session_busy";
    } else if (
      policyLimits.max_tool_recovery_tasks > 0 &&
      toolRecoveryInflight >= policyLimits.max_tool_recovery_tasks
    ) {
      blockedReason = "tool_busy";
    } else if (
      policyLimits.max_recovery_queue_size > 0 &&
      recoveryQueueSize >= policyLimits.max_recovery_queue_size
    ) {
      blockedReason = "queue_limit";
    } else if (
      policyLimits.total_recovery_timeout_ms > 0 &&
      recoveryElapsedMs > policyLimits.total_recovery_timeout_ms
    ) {
      blockedReason = "recovery_timeout";
    }

    const recoverable = !blockedReason;
    const decision = {
      mode,
      timestamp: nowIso(),
      tool_name: toolName || "unknown_tool",
      error_code: errorCode || "E_UNKNOWN",
      stage,
      shadow_mode_enabled: shadowModeEnabled,
      drift_error_matched: driftErrorMatched,
      recoverable,
      blocked_reason: blockedReason,
      token_family: tokenFamily,
      policy_limits: { ...policyLimits },
      max_retry:
        Number.isFinite(Number(autoRetryPolicy.max_retry)) &&
        Number(autoRetryPolicy.max_retry) >= 0
          ? Math.floor(Number(autoRetryPolicy.max_retry))
          : 0,
      refresh_tool_name: normalizeString(driftRecovery.refresh_tool_name),
      requires_idempotency_key: requiresIdempotency,
      idempotency_key_present: !!idempotencyKey,
      idempotency_conflict: idempotencyConflict,
      global_recovery_inflight: globalRecoveryInflight,
      session_recovery_inflight: sessionRecoveryInflight,
      tool_recovery_inflight: toolRecoveryInflight,
      recovery_queue_size: recoveryQueueSize,
      recovery_elapsed_ms: recoveryElapsedMs,
      request_fingerprint: requestFingerprint,
      session_key: sessionKey,
      shadow_only: mode === "shadow",
      auto_retry_enabled: autoRetryEnabled,
    };
    return decision;
  }

  function recordShadowDecision(decision) {
    shadowState.events_total += 1;
    const driftErrorMatched = decision.drift_error_matched === true;
    if (driftErrorMatched) {
      shadowState.drift_error_total += 1;
    }
    if (decision.recoverable) {
      shadowState.recoverable_total += 1;
    } else {
      shadowState.blocked_total += 1;
      bumpReasonCounter(shadowState.blocked_by_reason, decision.blocked_reason);
    }

    const normalizedToolName = decision.tool_name || "unknown_tool";
    if (!shadowState.by_tool[normalizedToolName]) {
      shadowState.by_tool[normalizedToolName] = createToolCounters();
    }
    const byTool = shadowState.by_tool[normalizedToolName];
    byTool.token_family = decision.token_family || byTool.token_family || "";
    byTool.events_total += 1;
    if (driftErrorMatched) {
      byTool.drift_error_total += 1;
    }
    if (decision.stage === "before_write_validation") {
      byTool.stage_before_write_validation_total += 1;
    } else if (decision.stage === "during_dispatch") {
      byTool.stage_during_dispatch_total += 1;
    } else {
      byTool.stage_other_total += 1;
    }
    if (decision.recoverable) {
      byTool.recoverable_total += 1;
    } else {
      byTool.blocked_total += 1;
      bumpReasonCounter(byTool.blocked_by_reason, decision.blocked_reason);
    }

    appendSample(shadowState, {
      timestamp: decision.timestamp,
      tool_name: decision.tool_name,
      error_code: decision.error_code,
      stage: decision.stage,
      recoverable: decision.recoverable,
      blocked_reason: decision.blocked_reason,
      request_fingerprint: decision.request_fingerprint,
    });
  }

  function evaluateShadowDecision(input = {}) {
    const decision = buildEvaluationDecision(input, {
      mode: "shadow",
      global_recovery_inflight: 0,
      session_recovery_inflight: 0,
      tool_recovery_inflight: 0,
      recovery_queue_size: 0,
      recovery_elapsed_ms: 0,
    });
    recordShadowDecision(decision);
    return decision;
  }

  function evaluateRecoveryDecision(input = {}) {
    cleanupReplayLedger(nowMs());
    const source = isObject(input) ? input : {};
    const toolName = normalizeString(source.tool_name || source.toolName);
    const sessionKey =
      normalizeString(source.session_id || source.sessionId) ||
      normalizeString(source.thread_id || source.threadId) ||
      "__session_unknown__";
    const decision = buildEvaluationDecision(
      {
        ...source,
        tool_name: toolName,
        session_id: sessionKey,
      },
      {
        mode: "execute",
        global_recovery_inflight: inflightState.global,
        session_recovery_inflight: getNamedCounter(
          inflightState.by_session,
          sessionKey
        ),
        tool_recovery_inflight: getNamedCounter(inflightState.by_tool, toolName),
        recovery_queue_size: 0,
        recovery_elapsed_ms: 0,
      }
    );
    return decision;
  }

  function startRecovery(input = {}) {
    const decision = evaluateRecoveryDecision(input);
    if (!decision.recoverable) {
      recoveryState.blocked_total += 1;
      bumpReasonCounter(recoveryState.blocked_by_reason, decision.blocked_reason);
      return {
        ok: false,
        decision,
      };
    }
    const sessionKey = normalizeString(decision.session_key) || "__session_unknown__";
    const toolName = normalizeString(decision.tool_name) || "unknown_tool";
    const fingerprint =
      normalizeString(decision.request_fingerprint) ||
      buildRequestFingerprint(input);

    replayLedgerByFingerprint.set(fingerprint, nowMs());
    inflightState.global += 1;
    bumpNamedCounter(inflightState.by_session, sessionKey, 1);
    bumpNamedCounter(inflightState.by_tool, toolName, 1);
    recoveryState.attempt_total += 1;
    bumpNamedCounter(recoveryState.triggered_by_tool, toolName, 1);

    return {
      ok: true,
      decision,
      lease: {
        request_fingerprint: fingerprint,
        session_key: sessionKey,
        tool_name: toolName,
        started_at_ms: nowMs(),
      },
    };
  }

  function finishRecovery(input = {}) {
    const source = isObject(input) ? input : {};
    const lease = isObject(source.lease) ? source.lease : {};
    const sessionKey = normalizeString(lease.session_key) || "__session_unknown__";
    const toolName = normalizeString(lease.tool_name) || "unknown_tool";
    inflightState.global = Math.max(0, inflightState.global - 1);
    bumpNamedCounter(inflightState.by_session, sessionKey, -1);
    bumpNamedCounter(inflightState.by_tool, toolName, -1);
    if (getNamedCounter(inflightState.by_session, sessionKey) <= 0) {
      delete inflightState.by_session[sessionKey];
    }
    if (getNamedCounter(inflightState.by_tool, toolName) <= 0) {
      delete inflightState.by_tool[toolName];
    }
    const startedAtMs = normalizeFiniteMs(lease.started_at_ms, nowMs());
    const durationMs = Math.max(0, nowMs() - startedAtMs);
    if (recoveryState.duration_samples_ms.length >= 512) {
      recoveryState.duration_samples_ms.shift();
    }
    recoveryState.duration_samples_ms.push(durationMs);
    if (source.succeeded === true) {
      recoveryState.success_total += 1;
    } else {
      recoveryState.fail_total += 1;
      bumpReasonCounter(recoveryState.fail_by_reason, source.failure_reason);
    }
    return {
      duration_ms: durationMs,
      succeeded: source.succeeded === true,
    };
  }

  function getShadowMetricsSnapshot() {
    const byTool = Object.entries(shadowState.by_tool)
      .map(([toolName, counters]) => ({
        tool_name: toolName,
        events_total: Number(counters.events_total) || 0,
        drift_error_total: Number(counters.drift_error_total) || 0,
        recoverable_total: Number(counters.recoverable_total) || 0,
        blocked_total: Number(counters.blocked_total) || 0,
        stage_before_write_validation_total:
          Number(counters.stage_before_write_validation_total) || 0,
        stage_during_dispatch_total:
          Number(counters.stage_during_dispatch_total) || 0,
        stage_other_total: Number(counters.stage_other_total) || 0,
        token_family: normalizeString(counters.token_family),
        recoverable_rate: safeRatio(
          counters.recoverable_total,
          counters.drift_error_total
        ),
        blocked_by_reason: { ...counters.blocked_by_reason },
      }))
      .sort((a, b) => {
        if (b.events_total !== a.events_total) {
          return b.events_total - a.events_total;
        }
        return String(a.tool_name).localeCompare(String(b.tool_name));
      });

    return {
      schema_version: "token_drift_recovery_shadow_metrics.v1",
      generated_at: nowIso(),
      shadow_mode_enabled: shadowModeEnabled,
      totals: {
        events_total: shadowState.events_total,
        drift_error_total: shadowState.drift_error_total,
        recoverable_total: shadowState.recoverable_total,
        blocked_total: shadowState.blocked_total,
      },
      rates: {
        trigger_rate: safeRatio(
          shadowState.drift_error_total,
          shadowState.events_total
        ),
        recoverable_rate: safeRatio(
          shadowState.recoverable_total,
          shadowState.drift_error_total
        ),
      },
      blocked_by_reason: { ...shadowState.blocked_by_reason },
      policy_limits: { ...policyLimits },
      by_tool: byTool,
      samples: [...shadowState.samples],
    };
  }

  function getRecoveryMetricsSnapshot() {
    return {
      schema_version: "token_drift_recovery_execute_metrics.v1",
      generated_at: nowIso(),
      auto_retry_enabled: autoRetryEnabled,
      policy_limits: { ...policyLimits },
      totals: {
        attempt_total: recoveryState.attempt_total,
        success_total: recoveryState.success_total,
        fail_total: recoveryState.fail_total,
        blocked_total: recoveryState.blocked_total,
      },
      rates: {
        success_rate: safeRatio(
          recoveryState.success_total,
          recoveryState.attempt_total
        ),
        fail_rate: safeRatio(recoveryState.fail_total, recoveryState.attempt_total),
      },
      blocked_by_reason: { ...recoveryState.blocked_by_reason },
      fail_by_reason: { ...recoveryState.fail_by_reason },
      triggered_by_tool: { ...recoveryState.triggered_by_tool },
      duration_ms: {
        p50: computePercentile(recoveryState.duration_samples_ms, 0.5),
        p95: computePercentile(recoveryState.duration_samples_ms, 0.95),
      },
      inflight: {
        global: inflightState.global,
        by_session: { ...inflightState.by_session },
        by_tool: { ...inflightState.by_tool },
      },
    };
  }

  function resetForTests() {
    const emptyShadow = createEmptyState();
    shadowState.events_total = emptyShadow.events_total;
    shadowState.drift_error_total = emptyShadow.drift_error_total;
    shadowState.recoverable_total = emptyShadow.recoverable_total;
    shadowState.blocked_total = emptyShadow.blocked_total;
    shadowState.blocked_by_reason = emptyShadow.blocked_by_reason;
    shadowState.by_tool = emptyShadow.by_tool;
    shadowState.samples = emptyShadow.samples;
    const emptyRecovery = createRecoveryState();
    recoveryState.attempt_total = emptyRecovery.attempt_total;
    recoveryState.success_total = emptyRecovery.success_total;
    recoveryState.fail_total = emptyRecovery.fail_total;
    recoveryState.blocked_total = emptyRecovery.blocked_total;
    recoveryState.blocked_by_reason = emptyRecovery.blocked_by_reason;
    recoveryState.fail_by_reason = emptyRecovery.fail_by_reason;
    recoveryState.triggered_by_tool = emptyRecovery.triggered_by_tool;
    recoveryState.duration_samples_ms = emptyRecovery.duration_samples_ms;
    inflightState.global = 0;
    inflightState.by_session = Object.create(null);
    inflightState.by_tool = Object.create(null);
    replayLedgerByFingerprint.clear();
  }

  function getContractSnapshot() {
    const contract = getContract();
    const driftRecovery = isObject(contract.drift_recovery)
      ? { ...contract.drift_recovery }
      : {};
    const autoRetryPolicy = isObject(contract.auto_retry_policy)
      ? { ...contract.auto_retry_policy }
      : {};
    return {
      drift_recovery: driftRecovery,
      auto_retry_policy: autoRetryPolicy,
      auto_retry_safe_family: Array.isArray(contract.auto_retry_safe_family)
        ? [...contract.auto_retry_safe_family]
        : [],
      policy_limits: { ...policyLimits },
      auto_retry_enabled: autoRetryEnabled,
      shadow_mode_enabled: shadowModeEnabled,
    };
  }

  return {
    evaluateShadowDecision,
    evaluateRecoveryDecision,
    startRecovery,
    finishRecovery,
    getShadowMetricsSnapshot,
    getRecoveryMetricsSnapshot,
    getContractSnapshot,
    resetForTests,
  };
}

function getTokenDriftRecoveryCoordinatorSingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return createTokenDriftRecoveryCoordinator(options);
  }
  if (!tokenDriftRecoveryCoordinatorSingleton) {
    tokenDriftRecoveryCoordinatorSingleton =
      createTokenDriftRecoveryCoordinator();
  }
  return tokenDriftRecoveryCoordinatorSingleton;
}

function resetTokenDriftRecoveryCoordinatorSingletonForTests() {
  tokenDriftRecoveryCoordinatorSingleton = null;
}

module.exports = {
  createTokenDriftRecoveryCoordinator,
  getTokenDriftRecoveryCoordinatorSingleton,
  resetTokenDriftRecoveryCoordinatorSingletonForTests,
};
