"use strict";

const VISIBILITY_PROFILE = Object.freeze({
  LEGACY_FULL: "legacy_full",
  PLANNER_FIRST: "planner_first",
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeNonNegativeNumber(value) {
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

function resolveRequestedProfile(contract) {
  const requested = normalizeString(contract && contract.requested_profile);
  if (
    requested === VISIBILITY_PROFILE.LEGACY_FULL ||
    requested === VISIBILITY_PROFILE.PLANNER_FIRST
  ) {
    return requested;
  }
  return VISIBILITY_PROFILE.LEGACY_FULL;
}

function resolveThresholds(contract) {
  const enableGate =
    contract && typeof contract.enable_gate === "object" ? contract.enable_gate : {};
  const rollbackTrigger =
    contract && typeof contract.rollback_trigger === "object"
      ? contract.rollback_trigger
      : {};
  return Object.freeze({
    enable_gate: Object.freeze({
      covered_family_ratio_min:
        normalizeNonNegativeNumber(enableGate.covered_family_ratio_min) ?? 0.8,
      planner_path_failure_rate_max:
        normalizeNonNegativeNumber(enableGate.planner_path_failure_rate_max) ?? 0.01,
      planner_path_p95_regression_max:
        normalizeNonNegativeNumber(enableGate.planner_path_p95_regression_max) ?? 0.1,
    }),
    rollback_trigger: Object.freeze({
      planner_path_failure_rate_1h_max:
        normalizeNonNegativeNumber(rollbackTrigger.planner_path_failure_rate_1h_max) ??
        0.02,
      planner_path_p95_regression_1h_max:
        normalizeNonNegativeNumber(rollbackTrigger.planner_path_p95_regression_1h_max) ??
        0.2,
    }),
  });
}

function resolveMetrics(contract) {
  const enableGateMetrics =
    contract &&
    contract.enable_gate &&
    typeof contract.enable_gate.metrics === "object"
      ? contract.enable_gate.metrics
      : {};
  const rollbackMetrics =
    contract &&
    contract.rollback_trigger &&
    typeof contract.rollback_trigger.metrics === "object"
      ? contract.rollback_trigger.metrics
      : {};
  return Object.freeze({
    enable_gate: Object.freeze({
      covered_family_ratio: normalizeNonNegativeNumber(
        enableGateMetrics.covered_family_ratio
      ),
      planner_path_failure_rate: normalizeNonNegativeNumber(
        enableGateMetrics.planner_path_failure_rate
      ),
      planner_path_p95_regression: normalizeNonNegativeNumber(
        enableGateMetrics.planner_path_p95_regression
      ),
    }),
    rollback_trigger: Object.freeze({
      planner_path_failure_rate_1h: normalizeNonNegativeNumber(
        rollbackMetrics.planner_path_failure_rate_1h
      ),
      planner_path_p95_regression_1h: normalizeNonNegativeNumber(
        rollbackMetrics.planner_path_p95_regression_1h
      ),
    }),
  });
}

function evaluateGateState(thresholds, metrics) {
  const reasons = [];
  const enableThresholds = thresholds.enable_gate;
  const enableMetrics = metrics.enable_gate;

  if (enableMetrics.covered_family_ratio === null) {
    reasons.push("missing_covered_family_ratio");
  } else if (enableMetrics.covered_family_ratio < enableThresholds.covered_family_ratio_min) {
    reasons.push("covered_family_ratio_below_min");
  }

  if (enableMetrics.planner_path_failure_rate === null) {
    reasons.push("missing_planner_path_failure_rate");
  } else if (
    enableMetrics.planner_path_failure_rate > enableThresholds.planner_path_failure_rate_max
  ) {
    reasons.push("planner_path_failure_rate_above_max");
  }

  if (enableMetrics.planner_path_p95_regression === null) {
    reasons.push("missing_planner_path_p95_regression");
  } else if (
    enableMetrics.planner_path_p95_regression >
    enableThresholds.planner_path_p95_regression_max
  ) {
    reasons.push("planner_path_p95_regression_above_max");
  }

  return Object.freeze({
    passed: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

function evaluateRollbackState(thresholds, metrics) {
  const reasons = [];
  const rollbackThresholds = thresholds.rollback_trigger;
  const rollbackMetrics = metrics.rollback_trigger;

  if (
    rollbackMetrics.planner_path_failure_rate_1h !== null &&
    rollbackMetrics.planner_path_failure_rate_1h >
      rollbackThresholds.planner_path_failure_rate_1h_max
  ) {
    reasons.push("planner_path_failure_rate_1h_above_rollback");
  }
  if (
    rollbackMetrics.planner_path_p95_regression_1h !== null &&
    rollbackMetrics.planner_path_p95_regression_1h >
      rollbackThresholds.planner_path_p95_regression_1h_max
  ) {
    reasons.push("planner_path_p95_regression_1h_above_rollback");
  }

  return Object.freeze({
    triggered: reasons.length > 0,
    reasons: Object.freeze(reasons),
  });
}

function evaluateProfileState(contract) {
  const requestedProfile = resolveRequestedProfile(contract);
  const thresholds = resolveThresholds(contract);
  const metrics = resolveMetrics(contract);
  const gate = evaluateGateState(thresholds, metrics);
  const rollback = evaluateRollbackState(thresholds, metrics);
  const managedToolNames = toUniqueStringArray(contract && contract.managed_tool_names);
  const coveredFamilyKeys = toUniqueStringArray(contract && contract.covered_family_keys);

  if (requestedProfile !== VISIBILITY_PROFILE.PLANNER_FIRST) {
    return Object.freeze({
      requested_profile: requestedProfile,
      active_profile: VISIBILITY_PROFILE.LEGACY_FULL,
      gate,
      rollback,
      managed_tool_names: managedToolNames,
      covered_family_keys: coveredFamilyKeys,
      reason: "requested_legacy_full",
    });
  }

  if (!gate.passed) {
    return Object.freeze({
      requested_profile: requestedProfile,
      active_profile: VISIBILITY_PROFILE.LEGACY_FULL,
      gate,
      rollback,
      managed_tool_names: managedToolNames,
      covered_family_keys: coveredFamilyKeys,
      reason: "enable_gate_not_satisfied",
    });
  }

  if (rollback.triggered) {
    return Object.freeze({
      requested_profile: requestedProfile,
      active_profile: VISIBILITY_PROFILE.LEGACY_FULL,
      gate,
      rollback,
      managed_tool_names: managedToolNames,
      covered_family_keys: coveredFamilyKeys,
      reason: "rollback_triggered",
    });
  }

  return Object.freeze({
    requested_profile: requestedProfile,
    active_profile: VISIBILITY_PROFILE.PLANNER_FIRST,
    gate,
    rollback,
    managed_tool_names: managedToolNames,
    covered_family_keys: coveredFamilyKeys,
    reason: "planner_first_enabled",
  });
}

function createPlannerVisibilityProfileRuntime(contract = {}) {
  const state = evaluateProfileState(contract);
  const managedToolNameSet = new Set(state.managed_tool_names);

  return Object.freeze({
    getState() {
      return state;
    },
    isManagedToolName(toolName) {
      return managedToolNameSet.has(normalizeString(toolName));
    },
    shouldHideToolFromList(toolName) {
      const normalized = normalizeString(toolName);
      if (!normalized) {
        return false;
      }
      return (
        state.active_profile === VISIBILITY_PROFILE.PLANNER_FIRST &&
        managedToolNameSet.has(normalized)
      );
    },
  });
}

module.exports = {
  VISIBILITY_PROFILE,
  createPlannerVisibilityProfileRuntime,
  evaluateProfileState,
};

