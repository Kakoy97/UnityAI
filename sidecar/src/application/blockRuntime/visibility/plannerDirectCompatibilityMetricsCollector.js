"use strict";

let plannerDirectCompatibilityMetricsCollectorSingleton = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createEmptyState() {
  return {
    policy_state: {
      requested_mode: "allow",
      active_mode: "allow",
      reason: "uninitialized",
      deny_gate: {
        passed: false,
        reasons: ["uninitialized"],
      },
      rollback: {
        triggered: false,
        reasons: [],
      },
      thresholds: null,
      metrics: null,
      data_source: null,
      managed_tool_names: [],
      managed_tool_family_map: {},
    },
    totals: {
      decisions_total: 0,
      allow_total: 0,
      warn_total: 0,
      deny_total: 0,
    },
    by_tool: {},
    by_family: {},
  };
}

class PlannerDirectCompatibilityMetricsCollector {
  constructor(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.state = createEmptyState();
  }

  setPolicyState(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const managedToolFamilyMap =
      source.managed_tool_family_map &&
      typeof source.managed_tool_family_map === "object"
        ? { ...source.managed_tool_family_map }
        : {};
    const managedToolNames = Array.isArray(source.managed_tool_names)
      ? source.managed_tool_names
          .map((item) => normalizeString(item))
          .filter((item) => !!item)
      : [];
    this.state.policy_state = {
      requested_mode: normalizeString(source.requested_mode) || "allow",
      active_mode: normalizeString(source.active_mode) || "allow",
      reason: normalizeString(source.reason) || "unspecified",
      deny_gate:
        source.deny_gate && typeof source.deny_gate === "object"
          ? {
              passed: source.deny_gate.passed === true,
              reasons: Array.isArray(source.deny_gate.reasons)
                ? source.deny_gate.reasons
                    .map((item) => normalizeString(item))
                    .filter((item) => !!item)
                : [],
            }
          : { passed: false, reasons: [] },
      rollback:
        source.rollback && typeof source.rollback === "object"
          ? {
              triggered: source.rollback.triggered === true,
              reasons: Array.isArray(source.rollback.reasons)
                ? source.rollback.reasons
                    .map((item) => normalizeString(item))
                    .filter((item) => !!item)
                : [],
            }
          : { triggered: false, reasons: [] },
      thresholds:
        source.thresholds && typeof source.thresholds === "object"
          ? { ...source.thresholds }
          : null,
      metrics:
        source.metrics && typeof source.metrics === "object"
          ? { ...source.metrics }
          : null,
      data_source:
        source.data_source && typeof source.data_source === "object"
          ? { ...source.data_source }
          : null,
      managed_tool_names: managedToolNames,
      managed_tool_family_map: managedToolFamilyMap,
    };
  }

  recordDecision(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const mode = normalizeString(source.mode) || "allow";
    const toolName = normalizeString(source.tool_name) || "unknown_tool";
    const familyKey = normalizeString(source.family_key) || "unmanaged";

    this.state.totals.decisions_total += 1;
    if (mode === "deny") {
      this.state.totals.deny_total += 1;
    } else if (mode === "warn") {
      this.state.totals.warn_total += 1;
    } else {
      this.state.totals.allow_total += 1;
    }

    if (!this.state.by_tool[toolName]) {
      this.state.by_tool[toolName] = {
        decisions_total: 0,
        allow_total: 0,
        warn_total: 0,
        deny_total: 0,
      };
    }
    const toolCounters = this.state.by_tool[toolName];
    toolCounters.decisions_total += 1;
    if (mode === "deny") {
      toolCounters.deny_total += 1;
    } else if (mode === "warn") {
      toolCounters.warn_total += 1;
    } else {
      toolCounters.allow_total += 1;
    }

    if (!this.state.by_family[familyKey]) {
      this.state.by_family[familyKey] = {
        decisions_total: 0,
        allow_total: 0,
        warn_total: 0,
        deny_total: 0,
      };
    }
    const familyCounters = this.state.by_family[familyKey];
    familyCounters.decisions_total += 1;
    if (mode === "deny") {
      familyCounters.deny_total += 1;
    } else if (mode === "warn") {
      familyCounters.warn_total += 1;
    } else {
      familyCounters.allow_total += 1;
    }
  }

  getSnapshot() {
    return {
      schema_version: "planner_direct_compatibility_metrics.v1",
      generated_at: this.nowIso(),
      policy_state: {
        ...this.state.policy_state,
        deny_gate: { ...this.state.policy_state.deny_gate },
        rollback: { ...this.state.policy_state.rollback },
        managed_tool_names: [...this.state.policy_state.managed_tool_names],
        managed_tool_family_map: { ...this.state.policy_state.managed_tool_family_map },
      },
      totals: { ...this.state.totals },
      by_tool: Object.entries(this.state.by_tool)
        .map(([toolName, counters]) => ({
          tool_name: toolName,
          ...counters,
        }))
        .sort((a, b) => {
          if (b.decisions_total !== a.decisions_total) {
            return b.decisions_total - a.decisions_total;
          }
          return String(a.tool_name).localeCompare(String(b.tool_name));
        }),
      by_family: Object.entries(this.state.by_family)
        .map(([familyKey, counters]) => ({
          family_key: familyKey,
          ...counters,
        }))
        .sort((a, b) => {
          if (b.decisions_total !== a.decisions_total) {
            return b.decisions_total - a.decisions_total;
          }
          return String(a.family_key).localeCompare(String(b.family_key));
        }),
    };
  }

  resetForTests() {
    this.state = createEmptyState();
  }
}

function getPlannerDirectCompatibilityMetricsCollectorSingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return new PlannerDirectCompatibilityMetricsCollector(options);
  }
  if (!plannerDirectCompatibilityMetricsCollectorSingleton) {
    plannerDirectCompatibilityMetricsCollectorSingleton =
      new PlannerDirectCompatibilityMetricsCollector();
  }
  return plannerDirectCompatibilityMetricsCollectorSingleton;
}

function resetPlannerDirectCompatibilityMetricsCollectorSingletonForTests() {
  plannerDirectCompatibilityMetricsCollectorSingleton = null;
}

module.exports = {
  PlannerDirectCompatibilityMetricsCollector,
  getPlannerDirectCompatibilityMetricsCollectorSingleton,
  resetPlannerDirectCompatibilityMetricsCollectorSingletonForTests,
};
