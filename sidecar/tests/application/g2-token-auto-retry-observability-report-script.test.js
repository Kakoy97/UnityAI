"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildObservabilityReport,
} = require("../../scripts/generate-g2-token-auto-retry-observability-report");

test("g2 auto-retry observability script parseArgs supports overrides", () => {
  const options = parseArgs([
    "--input",
    "./tmp/g2-auto-retry-observability-input.json",
    "--output",
    "./tmp/g2-auto-retry-observability-output.json",
    "--min-success-rate",
    "0.9",
    "--max-fail-rate",
    "0.12",
    "--max-blocked-rate",
    "0.2",
    "--max-duration-p95-ms",
    "2500",
    "--max-misfire-total",
    "0",
    "--max-duplicate-replay-total",
    "0",
    "--top-blocked-reasons",
    "8",
    "--ci",
  ]);

  assert.ok(
    options.inputPath.endsWith("tmp\\g2-auto-retry-observability-input.json") ||
      options.inputPath.endsWith("tmp/g2-auto-retry-observability-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\g2-auto-retry-observability-output.json") ||
      options.outputPath.endsWith("tmp/g2-auto-retry-observability-output.json")
  );
  assert.equal(options.minSuccessRate, 0.9);
  assert.equal(options.maxFailRate, 0.12);
  assert.equal(options.maxBlockedRate, 0.2);
  assert.equal(options.maxDurationP95Ms, 2500);
  assert.equal(options.maxMisfireTotal, 0);
  assert.equal(options.maxDuplicateReplayTotal, 0);
  assert.equal(options.topBlockedReasons, 8);
  assert.equal(options.ci, true);
});

test("g2 auto-retry observability script builds pass report", () => {
  const report = buildObservabilityReport({
    inputPath: "./tmp/g2-auto-retry-observability-input.json",
    minSuccessRate: 0.85,
    maxFailRate: 0.2,
    maxBlockedRate: 0.35,
    maxDurationP95Ms: 3000,
    maxMisfireTotal: 0,
    maxDuplicateReplayTotal: 0,
    topBlockedReasons: 3,
    snapshot: {
      schema_version: "token_drift_recovery_execute_metrics.v1",
      auto_retry_enabled: true,
      totals: {
        attempt_total: 20,
        success_total: 18,
        fail_total: 2,
        blocked_total: 3,
      },
      rates: {
        success_rate: 0.9,
        fail_rate: 0.1,
      },
      blocked_by_reason: {
        global_limit: 1,
        queue_limit: 2,
        error_code_not_drift: 0,
        idempotency_conflict: 0,
      },
      fail_by_reason: {
        retry_dispatch_failed: 2,
      },
      triggered_by_tool: {
        modify_ui_layout: 15,
        set_component_properties: 5,
      },
      duration_ms: {
        p50: 400,
        p95: 1100,
      },
    },
  });

  assert.equal(report.schema_version, "g2_token_auto_retry_observability_report.v1");
  assert.equal(report.metrics.attempt_total, 20);
  assert.equal(report.metrics.success_rate, 0.9);
  assert.equal(report.metrics.blocked_rate, 0.130435);
  assert.equal(report.metrics.duration_p95_ms, 1100);
  assert.equal(report.all_passed, true);
  assert.equal(report.fallback_recommendation.fallback_required, false);
  assert.equal(Array.isArray(report.blocked_reasons_topn), true);
  assert.equal(report.blocked_reasons_topn.length, 2);
});

test("g2 auto-retry observability script marks fallback when checks fail", () => {
  const report = buildObservabilityReport({
    minSuccessRate: 0.9,
    maxFailRate: 0.1,
    maxBlockedRate: 0.2,
    maxDurationP95Ms: 900,
    maxMisfireTotal: 0,
    maxDuplicateReplayTotal: 0,
    snapshot: {
      schema_version: "token_drift_recovery_execute_metrics.v1",
      auto_retry_enabled: true,
      totals: {
        attempt_total: 10,
        success_total: 7,
        fail_total: 3,
        blocked_total: 5,
      },
      blocked_by_reason: {
        error_code_not_drift: 1,
        idempotency_conflict: 1,
      },
      duration_ms: {
        p95: 1200,
      },
    },
  });

  assert.equal(report.all_passed, false);
  assert.equal(report.fallback_recommendation.fallback_required, true);
  assert.equal(report.fallback_recommendation.fallback_mode, "guidance_only");
  assert.equal(
    report.fallback_recommendation.suggested_action,
    "disable_token_auto_retry_execute_and_keep_structured_guidance"
  );
  assert.equal(report.fallback_recommendation.reason_codes.includes("success_rate"), true);
  assert.equal(report.fallback_recommendation.reason_codes.includes("misfire_total"), true);
  assert.equal(
    report.fallback_recommendation.reason_codes.includes("duplicate_replay_total"),
    true
  );
});
