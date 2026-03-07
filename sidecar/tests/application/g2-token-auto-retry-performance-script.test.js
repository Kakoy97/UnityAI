"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPerformanceReport,
} = require("../../scripts/evaluate-g2-token-auto-retry-performance");

test("g2 auto-retry performance script parseArgs supports overrides", () => {
  const options = parseArgs([
    "--input",
    "./tmp/g2-auto-retry-perf-input.json",
    "--output",
    "./tmp/g2-auto-retry-perf-output.json",
    "--max-latency-degradation-ratio",
    "0.08",
    "--max-throughput-drop-ratio",
    "0.04",
    "--max-recovery-duration-p95-ms",
    "2500",
    "--min-baseline-latency-ms",
    "5",
    "--min-baseline-throughput-rps",
    "10",
    "--ci",
  ]);

  assert.ok(
    options.inputPath.endsWith("tmp\\g2-auto-retry-perf-input.json") ||
      options.inputPath.endsWith("tmp/g2-auto-retry-perf-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\g2-auto-retry-perf-output.json") ||
      options.outputPath.endsWith("tmp/g2-auto-retry-perf-output.json")
  );
  assert.equal(options.maxLatencyDegradationRatio, 0.08);
  assert.equal(options.maxThroughputDropRatio, 0.04);
  assert.equal(options.maxRecoveryDurationP95Ms, 2500);
  assert.equal(options.minBaselineLatencyMs, 5);
  assert.equal(options.minBaselineThroughputRps, 10);
  assert.equal(options.ci, true);
});

test("g2 auto-retry performance script builds pass report", () => {
  const report = buildPerformanceReport({
    maxLatencyDegradationRatio: 0.1,
    maxThroughputDropRatio: 0.05,
    maxRecoveryDurationP95Ms: 3000,
    minBaselineLatencyMs: 1,
    minBaselineThroughputRps: 1,
    snapshot: {
      schema_version: "g2_token_auto_retry_performance_samples.v1",
      baseline: {
        request_p95_ms: 1000,
        request_avg_ms: 600,
        throughput_rps: 100,
      },
      candidate: {
        request_p95_ms: 1080,
        request_avg_ms: 660,
        throughput_rps: 96,
      },
      recovery: {
        attempt_total: 20,
        duration_ms: {
          p50: 500,
          p95: 1200,
        },
      },
    },
  });

  assert.equal(report.schema_version, "g2_token_auto_retry_performance_report.v1");
  assert.equal(report.regression.latency_degradation_ratio, 0.08);
  assert.equal(report.regression.throughput_drop_ratio, 0.04);
  assert.equal(report.recovery.duration_p95_ms, 1200);
  assert.equal(report.all_passed, true);
  assert.equal(report.fuse_recommendation.fuse_required, false);
});

test("g2 auto-retry performance script requests fuse when thresholds are exceeded", () => {
  const report = buildPerformanceReport({
    maxLatencyDegradationRatio: 0.1,
    maxThroughputDropRatio: 0.05,
    maxRecoveryDurationP95Ms: 3000,
    snapshot: {
      schema_version: "g2_token_auto_retry_performance_samples.v1",
      baseline: {
        request_p95_ms: 1000,
        request_avg_ms: 600,
        throughput_rps: 100,
      },
      candidate: {
        request_p95_ms: 1300,
        request_avg_ms: 770,
        throughput_rps: 90,
      },
      recovery: {
        attempt_total: 15,
        duration_ms: {
          p95: 4200,
        },
      },
    },
  });

  assert.equal(report.all_passed, false);
  assert.equal(report.fuse_recommendation.fuse_required, true);
  assert.equal(report.fuse_recommendation.mode_after_fuse, "guidance_only");
  assert.equal(
    report.fuse_recommendation.reason_codes.includes("latency_degradation_ratio"),
    true
  );
  assert.equal(
    report.fuse_recommendation.reason_codes.includes("throughput_drop_ratio"),
    true
  );
  assert.equal(
    report.fuse_recommendation.reason_codes.includes("recovery_duration_p95_ms"),
    true
  );
});
