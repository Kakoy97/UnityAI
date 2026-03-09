"use strict";

const DIRECT_COMPATIBILITY_MODE = Object.freeze({
  ALLOW: "allow",
  WARN: "warn",
  DENY: "deny",
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function toUniqueStringArray(value) {
  const source = Array.isArray(value) ? value : [];
  const output = [];
  const seen = new Set();
  for (const item of source) {
    const normalized = normalizeString(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return Object.freeze(output);
}

function toManagedToolFamilyMap(value, managedToolNames) {
  const source = value && typeof value === "object" ? value : {};
  const managed = new Set(toUniqueStringArray(managedToolNames));
  const output = {};
  for (const [toolNameRaw, familyKeyRaw] of Object.entries(source)) {
    const toolName = normalizeString(toolNameRaw);
    const familyKey = normalizeString(familyKeyRaw);
    if (!toolName || !familyKey || !managed.has(toolName)) {
      continue;
    }
    output[toolName] = familyKey;
  }
  return Object.freeze(output);
}

function resolveRequestedMode(contract) {
  const requested = normalizeString(contract && contract.requested_mode);
  if (
    requested === DIRECT_COMPATIBILITY_MODE.ALLOW ||
    requested === DIRECT_COMPATIBILITY_MODE.WARN ||
    requested === DIRECT_COMPATIBILITY_MODE.DENY
  ) {
    return requested;
  }
  return DIRECT_COMPATIBILITY_MODE.ALLOW;
}

function resolveThresholds(contract) {
  const denyGate =
    contract && typeof contract.deny_gate === "object" ? contract.deny_gate : {};
  const rollbackTrigger =
    contract && typeof contract.rollback_trigger === "object"
      ? contract.rollback_trigger
      : {};
  return Object.freeze({
    deny_gate: Object.freeze({
      direct_warn_soak_days_min:
        normalizeNonNegativeNumber(denyGate.direct_warn_soak_days_min) ?? 7,
      planner_success_rate_min:
        normalizeNonNegativeNumber(denyGate.planner_success_rate_min) ?? 0.99,
      direct_share_for_deny_max:
        normalizeNonNegativeNumber(denyGate.direct_share_for_deny_max) ?? 0.1,
    }),
    rollback_trigger: Object.freeze({
      deny_incident_guard_max:
        normalizeNonNegativeNumber(rollbackTrigger.deny_incident_guard_max) ?? 0,
      deny_failure_guard_24h_max:
        normalizeNonNegativeNumber(rollbackTrigger.deny_failure_guard_24h_max) ??
        0.015,
    }),
  });
}

function resolveMetrics(contract) {
  const denyGateMetrics =
    contract && contract.deny_gate && typeof contract.deny_gate.metrics === "object"
      ? contract.deny_gate.metrics
      : {};
  const rollbackMetrics =
    contract &&
    contract.rollback_trigger &&
    typeof contract.rollback_trigger.metrics === "object"
      ? contract.rollback_trigger.metrics
      : {};
  return Object.freeze({
    deny_gate: Object.freeze({
      direct_warn_soak_days: normalizeNonNegativeNumber(
        denyGateMetrics.direct_warn_soak_days
      ),
      planner_success_rate_for_deny: normalizeNonNegativeNumber(
        denyGateMetrics.planner_success_rate_for_deny
      ),
      direct_share_for_deny: normalizeNonNegativeNumber(
        denyGateMetrics.direct_share_for_deny
      ),
    }),
    rollback_trigger: Object.freeze({
      deny_incident_count_24h: normalizeNonNegativeNumber(
        rollbackMetrics.deny_incident_count_24h
      ),
      deny_failure_rate_24h: normalizeNonNegativeNumber(
        rollbackMetrics.deny_failure_rate_24h
      ),
    }),
  });
}

function evaluateDenyGate(thresholds, metrics) {
  const reasons = [];
  const denyGateThresholds = thresholds.deny_gate;
  const denyGateMetrics = metrics.deny_gate;

  if (denyGateMetrics.direct_warn_soak_days === null) {
    reasons.push("missing_direct_warn_soak_days");
  } else if (
    denyGateMetrics.direct_warn_soak_days <
    denyGateThresholds.direct_warn_soak_days_min
  ) {
    reasons.push("direct_warn_soak_days_below_min");
  }

  if (denyGateMetrics.planner_success_rate_for_deny === null) {
    reasons.push("missing_planner_success_rate_for_deny");
  } else if (
    denyGateMetrics.planner_success_rate_for_deny <
    denyGateThresholds.planner_success_rate_min
  ) {
    reasons.push("planner_success_rate_for_deny_below_min");
  }

  if (denyGateMetrics.direct_share_for_deny === null) {
    reasons.push("missing_direct_share_for_deny");
  } else if (
    denyGateMetrics.direct_share_for_deny >
    denyGateThresholds.direct_share_for_deny_max
  ) {
    reasons.push("direct_share_for_deny_above_max");
  }

  return Object.freeze({
    passed: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

function evaluateRollbackTrigger(thresholds, metrics) {
  const reasons = [];
  const rollbackThresholds = thresholds.rollback_trigger;
  const rollbackMetrics = metrics.rollback_trigger;

  if (
    rollbackMetrics.deny_incident_count_24h !== null &&
    rollbackMetrics.deny_incident_count_24h > rollbackThresholds.deny_incident_guard_max
  ) {
    reasons.push("deny_incident_guard_exceeded");
  }
  if (
    rollbackMetrics.deny_failure_rate_24h !== null &&
    rollbackMetrics.deny_failure_rate_24h >
      rollbackThresholds.deny_failure_guard_24h_max
  ) {
    reasons.push("deny_failure_guard_exceeded");
  }

  return Object.freeze({
    triggered: reasons.length > 0,
    reasons: Object.freeze(reasons),
  });
}

function evaluateDirectCompatibilityState(contract) {
  const requestedMode = resolveRequestedMode(contract);
  const managedToolNames = toUniqueStringArray(contract && contract.managed_tool_names);
  const managedToolFamilyMap = toManagedToolFamilyMap(
    contract && contract.managed_tool_family_map,
    managedToolNames
  );
  const thresholds = resolveThresholds(contract);
  const metrics = resolveMetrics(contract);
  const denyGate = evaluateDenyGate(thresholds, metrics);
  const rollback = evaluateRollbackTrigger(thresholds, metrics);
  const dataSource =
    contract && contract.data_source && typeof contract.data_source === "object"
      ? { ...contract.data_source }
      : null;

  if (requestedMode === DIRECT_COMPATIBILITY_MODE.ALLOW) {
    return Object.freeze({
      requested_mode: requestedMode,
      active_mode: DIRECT_COMPATIBILITY_MODE.ALLOW,
      deny_gate: denyGate,
      rollback,
      thresholds,
      metrics,
      data_source: dataSource,
      managed_tool_names: managedToolNames,
      managed_tool_family_map: managedToolFamilyMap,
      reason: "requested_allow",
    });
  }

  if (requestedMode === DIRECT_COMPATIBILITY_MODE.WARN) {
    return Object.freeze({
      requested_mode: requestedMode,
      active_mode: DIRECT_COMPATIBILITY_MODE.WARN,
      deny_gate: denyGate,
      rollback,
      thresholds,
      metrics,
      data_source: dataSource,
      managed_tool_names: managedToolNames,
      managed_tool_family_map: managedToolFamilyMap,
      reason: "requested_warn",
    });
  }

  if (!denyGate.passed) {
    return Object.freeze({
      requested_mode: requestedMode,
      active_mode: DIRECT_COMPATIBILITY_MODE.WARN,
      deny_gate: denyGate,
      rollback,
      thresholds,
      metrics,
      data_source: dataSource,
      managed_tool_names: managedToolNames,
      managed_tool_family_map: managedToolFamilyMap,
      reason: "deny_gate_not_satisfied",
    });
  }

  if (rollback.triggered) {
    return Object.freeze({
      requested_mode: requestedMode,
      active_mode: DIRECT_COMPATIBILITY_MODE.WARN,
      deny_gate: denyGate,
      rollback,
      thresholds,
      metrics,
      data_source: dataSource,
      managed_tool_names: managedToolNames,
      managed_tool_family_map: managedToolFamilyMap,
      reason: "deny_rollback_triggered",
    });
  }

  return Object.freeze({
    requested_mode: requestedMode,
    active_mode: DIRECT_COMPATIBILITY_MODE.DENY,
    deny_gate: denyGate,
    rollback,
    thresholds,
    metrics,
    data_source: dataSource,
    managed_tool_names: managedToolNames,
    managed_tool_family_map: managedToolFamilyMap,
    reason: "deny_enabled",
  });
}

function createDecisionCounters() {
  return {
    allow_total: 0,
    warn_total: 0,
    deny_total: 0,
    by_tool: {},
  };
}

function createPlannerDirectCompatibilityRuntime(contract = {}, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const metricsCollector =
    opts.metricsCollector && typeof opts.metricsCollector === "object"
      ? opts.metricsCollector
      : null;
  const state = evaluateDirectCompatibilityState(contract);
  const managedToolNameSet = new Set(state.managed_tool_names);
  const decisionCounters = createDecisionCounters();
  if (metricsCollector && typeof metricsCollector.setPolicyState === "function") {
    metricsCollector.setPolicyState(state);
  }

  function resolveFamilyKey(toolName) {
    if (
      !toolName ||
      !state.managed_tool_family_map ||
      typeof state.managed_tool_family_map !== "object"
    ) {
      return "";
    }
    return normalizeString(state.managed_tool_family_map[toolName]);
  }

  function evaluateDirectCall(toolName) {
    const normalizedToolName = normalizeString(toolName);
    if (!normalizedToolName || !managedToolNameSet.has(normalizedToolName)) {
      return Object.freeze({
        mode: DIRECT_COMPATIBILITY_MODE.ALLOW,
        reason: "unmanaged_tool",
        tool_name: normalizedToolName,
        family_key: resolveFamilyKey(normalizedToolName),
      });
    }
    if (state.active_mode === DIRECT_COMPATIBILITY_MODE.DENY) {
      return Object.freeze({
        mode: DIRECT_COMPATIBILITY_MODE.DENY,
        reason: "managed_tool_blocked_in_deny",
        tool_name: normalizedToolName,
        family_key: resolveFamilyKey(normalizedToolName),
      });
    }
    if (state.active_mode === DIRECT_COMPATIBILITY_MODE.WARN) {
      return Object.freeze({
        mode: DIRECT_COMPATIBILITY_MODE.WARN,
        reason: "managed_tool_warned_in_warn_mode",
        tool_name: normalizedToolName,
        family_key: resolveFamilyKey(normalizedToolName),
      });
    }
    return Object.freeze({
      mode: DIRECT_COMPATIBILITY_MODE.ALLOW,
      reason: "managed_tool_allowed_in_allow_mode",
      tool_name: normalizedToolName,
      family_key: resolveFamilyKey(normalizedToolName),
    });
  }

  function recordDecision(decisionInput) {
    const decision = decisionInput && typeof decisionInput === "object" ? decisionInput : {};
    const mode = normalizeString(decision.mode);
    const toolName = normalizeString(decision.tool_name);
    if (!toolName) {
      return;
    }
    if (mode === DIRECT_COMPATIBILITY_MODE.DENY) {
      decisionCounters.deny_total += 1;
    } else if (mode === DIRECT_COMPATIBILITY_MODE.WARN) {
      decisionCounters.warn_total += 1;
    } else {
      decisionCounters.allow_total += 1;
    }
    if (!decisionCounters.by_tool[toolName]) {
      decisionCounters.by_tool[toolName] = {
        allow: 0,
        warn: 0,
        deny: 0,
      };
    }
    if (mode === DIRECT_COMPATIBILITY_MODE.DENY) {
      decisionCounters.by_tool[toolName].deny += 1;
    } else if (mode === DIRECT_COMPATIBILITY_MODE.WARN) {
      decisionCounters.by_tool[toolName].warn += 1;
    } else {
      decisionCounters.by_tool[toolName].allow += 1;
    }
    if (
      metricsCollector &&
      typeof metricsCollector.recordDecision === "function"
    ) {
      metricsCollector.recordDecision(decision);
    }
  }

  function getDecisionMetricsSnapshot() {
    return Object.freeze({
      allow_total: decisionCounters.allow_total,
      warn_total: decisionCounters.warn_total,
      deny_total: decisionCounters.deny_total,
      by_tool: Object.freeze(
        Object.fromEntries(
          Object.entries(decisionCounters.by_tool).map(([toolName, counters]) => [
            toolName,
            Object.freeze({ ...counters }),
          ])
        )
      ),
    });
  }

  return Object.freeze({
    getState() {
      return state;
    },
    isManagedToolName(toolName) {
      return managedToolNameSet.has(normalizeString(toolName));
    },
    evaluateDirectCall,
    recordDecision,
    getDecisionMetricsSnapshot,
  });
}

module.exports = {
  DIRECT_COMPATIBILITY_MODE,
  createPlannerDirectCompatibilityRuntime,
  evaluateDirectCompatibilityState,
};
