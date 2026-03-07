"use strict";

const DEFAULT_ANOMALY_SAMPLE_LIMIT = 32;

let tokenLifecycleMetricsCollectorSingleton = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Number(fallback) || 0;
  }
  return n;
}

function safeRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function createEmptyByToolCounters() {
  return {
    events_total: 0,
    continuation_eligible_success_total: 0,
    continuation_issued_total: 0,
    redaction_candidates_total: 0,
    redaction_applied_total: 0,
    anomaly_total: 0,
  };
}

function createEmptyState() {
  return {
    events_total: 0,
    continuation_eligible_success_total: 0,
    continuation_issued_total: 0,
    continuation_skipped_missing_scene_revision_total: 0,
    continuation_skipped_ineligible_policy_total: 0,
    redaction_candidates_total: 0,
    redaction_applied_total: 0,
    anomaly_total: 0,
    finalize_duration_ms_total: 0,
    finalize_duration_samples: 0,
    by_tool: {},
    anomaly_samples: [],
  };
}

function normalizeToolName(value) {
  return normalizeString(value) || "unknown_tool";
}

function normalizeAnomalyCode(value) {
  return normalizeString(value) || "";
}

class TokenLifecycleMetricsCollector {
  constructor(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.anomalySampleLimit =
      Number.isFinite(Number(opts.anomalySampleLimit)) &&
      Number(opts.anomalySampleLimit) > 0
        ? Math.floor(Number(opts.anomalySampleLimit))
        : DEFAULT_ANOMALY_SAMPLE_LIMIT;
    this.state = createEmptyState();
  }

  recordFinalizeOutcome(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const toolName = normalizeToolName(source.tool_name);
    const anomalyCode = normalizeAnomalyCode(source.anomaly_code);

    this.state.events_total += 1;
    if (source.continuation_eligible_success === true) {
      this.state.continuation_eligible_success_total += 1;
    }
    if (source.continuation_issued === true) {
      this.state.continuation_issued_total += 1;
    }
    if (source.redaction_candidate === true) {
      this.state.redaction_candidates_total += 1;
    }
    if (source.redaction_applied === true) {
      this.state.redaction_applied_total += 1;
    }
    if (source.skipped_missing_scene_revision === true) {
      this.state.continuation_skipped_missing_scene_revision_total += 1;
    }
    if (source.skipped_ineligible_policy === true) {
      this.state.continuation_skipped_ineligible_policy_total += 1;
    }
    if (anomalyCode) {
      this.state.anomaly_total += 1;
      if (this.state.anomaly_samples.length < this.anomalySampleLimit) {
        this.state.anomaly_samples.push({
          observed_at: this.nowIso(),
          tool_name: toolName,
          anomaly_code: anomalyCode,
          decision_reason: normalizeString(source.decision_reason),
          token_family: normalizeString(source.token_family),
          result_ok: source.result_ok === true,
        });
      }
    }

    const durationMs = toNonNegativeNumber(source.finalize_duration_ms, -1);
    if (durationMs >= 0) {
      this.state.finalize_duration_ms_total += durationMs;
      this.state.finalize_duration_samples += 1;
    }

    if (!this.state.by_tool[toolName]) {
      this.state.by_tool[toolName] = createEmptyByToolCounters();
    }
    const byTool = this.state.by_tool[toolName];
    byTool.events_total += 1;
    if (source.continuation_eligible_success === true) {
      byTool.continuation_eligible_success_total += 1;
    }
    if (source.continuation_issued === true) {
      byTool.continuation_issued_total += 1;
    }
    if (source.redaction_candidate === true) {
      byTool.redaction_candidates_total += 1;
    }
    if (source.redaction_applied === true) {
      byTool.redaction_applied_total += 1;
    }
    if (anomalyCode) {
      byTool.anomaly_total += 1;
    }
  }

  getSnapshot() {
    const totals = {
      events_total: this.state.events_total,
      continuation_eligible_success_total:
        this.state.continuation_eligible_success_total,
      continuation_issued_total: this.state.continuation_issued_total,
      continuation_skipped_missing_scene_revision_total:
        this.state.continuation_skipped_missing_scene_revision_total,
      continuation_skipped_ineligible_policy_total:
        this.state.continuation_skipped_ineligible_policy_total,
      redaction_candidates_total: this.state.redaction_candidates_total,
      redaction_applied_total: this.state.redaction_applied_total,
      anomaly_total: this.state.anomaly_total,
      finalize_duration_avg_ms: safeRatio(
        this.state.finalize_duration_ms_total,
        this.state.finalize_duration_samples
      ),
      finalize_duration_samples: this.state.finalize_duration_samples,
    };
    const byTool = Object.entries(this.state.by_tool)
      .map(([toolName, value]) => ({
        tool_name: toolName,
        ...value,
        continuation_hit_rate: safeRatio(
          value.continuation_issued_total,
          value.continuation_eligible_success_total
        ),
        redaction_hit_rate: safeRatio(
          value.redaction_applied_total,
          value.redaction_candidates_total
        ),
      }))
      .sort((a, b) => {
        if (b.events_total !== a.events_total) {
          return b.events_total - a.events_total;
        }
        return String(a.tool_name).localeCompare(String(b.tool_name));
      });

    return {
      schema_version: "token_lifecycle_metrics.v1",
      generated_at: this.nowIso(),
      totals,
      continuation_hit_rate: safeRatio(
        totals.continuation_issued_total,
        totals.continuation_eligible_success_total
      ),
      redaction_hit_rate: safeRatio(
        totals.redaction_applied_total,
        totals.redaction_candidates_total
      ),
      by_tool: byTool,
      anomaly_samples: [...this.state.anomaly_samples],
    };
  }

  resetForTests() {
    this.state = createEmptyState();
  }
}

function getTokenLifecycleMetricsCollectorSingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return new TokenLifecycleMetricsCollector(options);
  }
  if (!tokenLifecycleMetricsCollectorSingleton) {
    tokenLifecycleMetricsCollectorSingleton = new TokenLifecycleMetricsCollector();
  }
  return tokenLifecycleMetricsCollectorSingleton;
}

function resetTokenLifecycleMetricsCollectorSingletonForTests() {
  tokenLifecycleMetricsCollectorSingleton = null;
}

module.exports = {
  TokenLifecycleMetricsCollector,
  getTokenLifecycleMetricsCollectorSingleton,
  resetTokenLifecycleMetricsCollectorSingletonForTests,
};
