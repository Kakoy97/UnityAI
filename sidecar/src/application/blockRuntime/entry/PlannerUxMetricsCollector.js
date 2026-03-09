"use strict";

const PLANNER_UX_METRICS_SCHEMA_VERSION = "planner_entry_ux_metrics.v1";

let plannerUxMetricsCollectorSingleton = null;

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeNonNegativeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
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

function createEmptyState() {
  return {
    totals: {
      requests_total: 0,
      first_attempt_success_total: 0,
      first_attempt_failure_total: 0,
      normalized_alias_fields_total: 0,
      auto_filled_fields_total: 0,
    },
    failure_stage: {
      before_dispatch_total: 0,
      during_dispatch_total: 0,
      unknown_total: 0,
    },
    by_error_code: {},
  };
}

function normalizeFailureStage(stage) {
  const token = normalizeString(stage).toLowerCase();
  if (token === "before_dispatch") {
    return "before_dispatch";
  }
  if (token === "during_dispatch") {
    return "during_dispatch";
  }
  return "unknown";
}

function normalizeNormalizationMeta(rawMeta) {
  const meta =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? rawMeta : {};
  const aliasHits = Array.isArray(meta.alias_hits) ? meta.alias_hits.length : 0;
  const autoFilled = Array.isArray(meta.auto_filled_fields)
    ? meta.auto_filled_fields.length
    : 0;
  return {
    alias_hits_total: normalizeNonNegativeInteger(aliasHits),
    auto_filled_total: normalizeNonNegativeInteger(autoFilled),
  };
}

class PlannerUxMetricsCollector {
  constructor(options = {}) {
    const source = options && typeof options === "object" ? options : {};
    this.nowIso =
      typeof source.nowIso === "function"
        ? source.nowIso
        : () => new Date().toISOString();
    this.state = createEmptyState();
  }

  recordAttempt(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const success = source.success === true;
    const failureStage = normalizeFailureStage(source.failure_stage);
    const errorCode = normalizeString(source.error_code).toUpperCase();
    const normalizedMeta = normalizeNormalizationMeta(source.normalization_meta);

    this.state.totals.requests_total += 1;
    this.state.totals.normalized_alias_fields_total +=
      normalizedMeta.alias_hits_total;
    this.state.totals.auto_filled_fields_total += normalizedMeta.auto_filled_total;

    if (success) {
      this.state.totals.first_attempt_success_total += 1;
      return;
    }

    this.state.totals.first_attempt_failure_total += 1;
    if (failureStage === "before_dispatch") {
      this.state.failure_stage.before_dispatch_total += 1;
    } else if (failureStage === "during_dispatch") {
      this.state.failure_stage.during_dispatch_total += 1;
    } else {
      this.state.failure_stage.unknown_total += 1;
    }
    if (errorCode) {
      this.state.by_error_code[errorCode] =
        (Number(this.state.by_error_code[errorCode]) || 0) + 1;
    }
  }

  getSnapshot() {
    const totals = {
      requests_total: normalizeNonNegativeInteger(this.state.totals.requests_total),
      first_attempt_success_total: normalizeNonNegativeInteger(
        this.state.totals.first_attempt_success_total
      ),
      first_attempt_failure_total: normalizeNonNegativeInteger(
        this.state.totals.first_attempt_failure_total
      ),
      normalized_alias_fields_total: normalizeNonNegativeInteger(
        this.state.totals.normalized_alias_fields_total
      ),
      auto_filled_fields_total: normalizeNonNegativeInteger(
        this.state.totals.auto_filled_fields_total
      ),
    };
    const failureStage = {
      before_dispatch_total: normalizeNonNegativeInteger(
        this.state.failure_stage.before_dispatch_total
      ),
      during_dispatch_total: normalizeNonNegativeInteger(
        this.state.failure_stage.during_dispatch_total
      ),
      unknown_total: normalizeNonNegativeInteger(this.state.failure_stage.unknown_total),
    };

    const byErrorCode = Object.entries(this.state.by_error_code)
      .map(([errorCode, count]) => ({
        error_code: errorCode,
        count: normalizeNonNegativeInteger(count),
      }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return String(a.error_code).localeCompare(String(b.error_code));
      });

    return {
      schema_version: PLANNER_UX_METRICS_SCHEMA_VERSION,
      generated_at: this.nowIso(),
      totals,
      first_attempt_success: {
        total: totals.first_attempt_success_total,
        rate: safeRatio(
          totals.first_attempt_success_total,
          totals.requests_total
        ),
      },
      normalized_alias_fields: {
        total: totals.normalized_alias_fields_total,
      },
      auto_filled_fields: {
        total: totals.auto_filled_fields_total,
      },
      failure_stage: failureStage,
      by_error_code: byErrorCode,
      optional_metrics: {
        schema_lookup_count_supported: false,
      },
    };
  }

  resetForTests() {
    this.state = createEmptyState();
  }
}

function getPlannerUxMetricsCollectorSingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return new PlannerUxMetricsCollector(options);
  }
  if (!plannerUxMetricsCollectorSingleton) {
    plannerUxMetricsCollectorSingleton = new PlannerUxMetricsCollector();
  }
  return plannerUxMetricsCollectorSingleton;
}

function resetPlannerUxMetricsCollectorSingletonForTests() {
  plannerUxMetricsCollectorSingleton = null;
}

module.exports = {
  PLANNER_UX_METRICS_SCHEMA_VERSION,
  PlannerUxMetricsCollector,
  getPlannerUxMetricsCollectorSingleton,
  resetPlannerUxMetricsCollectorSingletonForTests,
};

