"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPerformanceReport,
} = require("../../scripts/evaluate-g2-token-auto-issue-performance");

test("g2 auto-issue performance script parseArgs supports overrides", () => {
  const options = parseArgs([
    "--output",
    "./tmp/g2-perf-output.json",
    "--iterations",
    "1200",
    "--warmup-iterations",
    "120",
    "--latency-threshold",
    "0.15",
    "--cpu-threshold",
    "0.25",
    "--heap-threshold",
    "0.3",
    "--event-loop-p95-threshold-ms",
    "25",
    "--ci",
  ]);
  assert.ok(
    options.outputPath.endsWith("tmp\\g2-perf-output.json") ||
      options.outputPath.endsWith("tmp/g2-perf-output.json")
  );
  assert.equal(options.iterations, 1200);
  assert.equal(options.warmupIterations, 120);
  assert.equal(options.latencyRegressionThreshold, 0.15);
  assert.equal(options.cpuRegressionThreshold, 0.25);
  assert.equal(options.heapRegressionThreshold, 0.3);
  assert.equal(options.eventLoopP95ThresholdMs, 25);
  assert.equal(options.ci, true);
});

test("g2 auto-issue performance script builds benchmark report", () => {
  const report = buildPerformanceReport({
    iterations: 120,
    warmupIterations: 20,
    latencyRegressionThreshold: 1,
    cpuRegressionThreshold: 1,
    heapRegressionThreshold: 2,
    eventLoopP95ThresholdMs: 100,
  });

  assert.equal(report.schema_version, "g2_token_auto_issue_performance_report.v1");
  assert.equal(report.benchmark.iterations, 120);
  assert.equal(report.benchmark.warmup_iterations, 20);
  assert.equal(
    report.benchmark.baseline.token_auto_issue_enabled,
    false
  );
  assert.equal(
    report.benchmark.candidate.token_auto_issue_enabled,
    true
  );
  assert.equal(
    Number.isFinite(Number(report.regression.latency_regression_ratio)),
    true
  );
  assert.equal(
    Number.isFinite(Number(report.regression.cpu_regression_ratio)),
    true
  );
  assert.equal(
    Number.isFinite(Number(report.regression.heap_regression_ratio)),
    true
  );
  assert.equal(Array.isArray(report.checks), true);
  assert.equal(report.checks.length, 4);
});
