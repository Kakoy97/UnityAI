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

function normalizeOptionalNonNegativeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
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

function computePercentileFromSortedValues(sortedValues, percentile) {
  const source = Array.isArray(sortedValues) ? sortedValues : [];
  if (source.length <= 0) {
    return 0;
  }
  const p = Number(percentile);
  if (!Number.isFinite(p) || p <= 0) {
    return source[0];
  }
  if (p >= 100) {
    return source[source.length - 1];
  }
  const rankIndex = Math.ceil((p / 100) * source.length) - 1;
  const safeIndex = Math.max(0, Math.min(source.length - 1, rankIndex));
  return source[safeIndex];
}

function createEmptyState() {
  return {
    totals: {
      requests_total: 0,
      first_attempt_success_total: 0,
      first_attempt_failure_total: 0,
      normalized_alias_fields_total: 0,
      auto_filled_fields_total: 0,
      transaction_auto_applied_total: 0,
      transaction_auto_blocked_total: 0,
      script_workflow_applied_total: 0,
      script_workflow_success_total: 0,
      script_workflow_failure_total: 0,
    },
    failure_stage: {
      before_dispatch_total: 0,
      during_dispatch_total: 0,
      unknown_total: 0,
    },
    transaction_auto_blocked_by_reason: {},
    script_workflow_by_template: {},
    script_workflow_compile_wait_duration_ms_values: [],
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

function normalizeOrchestrationMeta(rawMeta) {
  const meta =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta) ? rawMeta : {};
  const dispatchMode = normalizeString(meta.dispatch_mode);
  const workflowTemplateApplied =
    meta.workflow_template_applied === true || dispatchMode === "workflow_template";
  const workflowTemplateId = normalizeString(meta.workflow_template_id);
  const workflowCompileWaitDurationMs = normalizeOptionalNonNegativeInteger(
    meta.workflow_compile_wait_duration_ms
  );
  return {
    auto_transaction_applied: meta.auto_transaction_applied === true,
    blocked_reason: normalizeString(meta.blocked_reason),
    workflow_blocked_reason: normalizeString(meta.workflow_blocked_reason),
    dispatch_mode: dispatchMode,
    workflow_template_applied: workflowTemplateApplied,
    workflow_template_id: workflowTemplateId,
    workflow_compile_wait_duration_ms: workflowCompileWaitDurationMs,
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
    const orchestrationMeta = normalizeOrchestrationMeta(source.orchestration_meta);

    this.state.totals.requests_total += 1;
    this.state.totals.normalized_alias_fields_total +=
      normalizedMeta.alias_hits_total;
    this.state.totals.auto_filled_fields_total += normalizedMeta.auto_filled_total;
    if (orchestrationMeta.auto_transaction_applied) {
      this.state.totals.transaction_auto_applied_total += 1;
    }
    if (
      orchestrationMeta.blocked_reason &&
      !orchestrationMeta.workflow_blocked_reason
    ) {
      this.state.totals.transaction_auto_blocked_total += 1;
      this.state.transaction_auto_blocked_by_reason[
        orchestrationMeta.blocked_reason
      ] =
        (Number(
          this.state.transaction_auto_blocked_by_reason[
            orchestrationMeta.blocked_reason
          ]
        ) || 0) + 1;
    }
    if (orchestrationMeta.workflow_template_applied) {
      this.state.totals.script_workflow_applied_total += 1;
      if (success) {
        this.state.totals.script_workflow_success_total += 1;
      } else {
        this.state.totals.script_workflow_failure_total += 1;
      }
      if (orchestrationMeta.workflow_template_id) {
        this.state.script_workflow_by_template[
          orchestrationMeta.workflow_template_id
        ] =
          (Number(
            this.state.script_workflow_by_template[
              orchestrationMeta.workflow_template_id
            ]
          ) || 0) + 1;
      }
      if (
        Number.isFinite(orchestrationMeta.workflow_compile_wait_duration_ms) &&
        orchestrationMeta.workflow_compile_wait_duration_ms >= 0
      ) {
        this.state.script_workflow_compile_wait_duration_ms_values.push(
          orchestrationMeta.workflow_compile_wait_duration_ms
        );
      }
    }

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
      transaction_auto_applied_total: normalizeNonNegativeInteger(
        this.state.totals.transaction_auto_applied_total
      ),
      transaction_auto_blocked_total: normalizeNonNegativeInteger(
        this.state.totals.transaction_auto_blocked_total
      ),
      script_workflow_applied_total: normalizeNonNegativeInteger(
        this.state.totals.script_workflow_applied_total
      ),
      script_workflow_success_total: normalizeNonNegativeInteger(
        this.state.totals.script_workflow_success_total
      ),
      script_workflow_failure_total: normalizeNonNegativeInteger(
        this.state.totals.script_workflow_failure_total
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
    const transactionAutoBlockedByReason = Object.entries(
      this.state.transaction_auto_blocked_by_reason
    )
      .map(([blockedReason, count]) => ({
        blocked_reason: blockedReason,
        count: normalizeNonNegativeInteger(count),
      }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return String(a.blocked_reason).localeCompare(String(b.blocked_reason));
      });
    const scriptWorkflowByTemplate = Object.entries(
      this.state.script_workflow_by_template
    )
      .map(([workflowTemplateId, count]) => ({
        workflow_template_id: workflowTemplateId,
        count: normalizeNonNegativeInteger(count),
      }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return String(a.workflow_template_id).localeCompare(
          String(b.workflow_template_id)
        );
      });
    const workflowCompileWaitDurations = Array.isArray(
      this.state.script_workflow_compile_wait_duration_ms_values
    )
      ? this.state.script_workflow_compile_wait_duration_ms_values
          .map((value) => normalizeNonNegativeInteger(value))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .sort((a, b) => a - b)
      : [];
    const workflowCompileWaitDurationSummary = {
      sample_count: workflowCompileWaitDurations.length,
      p50: computePercentileFromSortedValues(workflowCompileWaitDurations, 50),
      p95: computePercentileFromSortedValues(workflowCompileWaitDurations, 95),
      max:
        workflowCompileWaitDurations.length > 0
          ? workflowCompileWaitDurations[workflowCompileWaitDurations.length - 1]
          : 0,
    };

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
      transaction_auto_applied: {
        total: totals.transaction_auto_applied_total,
      },
      transaction_auto_blocked: {
        total: totals.transaction_auto_blocked_total,
        by_reason: transactionAutoBlockedByReason,
      },
      script_workflow: {
        applied_total: totals.script_workflow_applied_total,
        success_total: totals.script_workflow_success_total,
        failure_total: totals.script_workflow_failure_total,
        by_template: scriptWorkflowByTemplate,
      },
      compile_wait_duration_ms: workflowCompileWaitDurationSummary,
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
