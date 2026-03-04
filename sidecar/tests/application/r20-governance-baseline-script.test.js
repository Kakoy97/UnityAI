"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  summarizeGovernanceSnapshot,
  buildGovernanceBaselineReport,
} = require("../../scripts/generate-r20-ux-governance-baseline");

test("r20 governance baseline script parseArgs supports before/after/output", () => {
  const options = parseArgs([
    "--before",
    "./tmp/before.json",
    "--after",
    "./tmp/after.json",
    "--output",
    "./tmp/report.json",
  ]);
  assert.ok(
    options.beforePath.endsWith("tmp\\before.json") ||
      options.beforePath.endsWith("tmp/before.json")
  );
  assert.ok(
    options.afterPath.endsWith("tmp\\after.json") ||
      options.afterPath.endsWith("tmp/after.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\report.json") ||
      options.outputPath.endsWith("tmp/report.json")
  );
});

test("r20 governance baseline script summarizes metrics snapshot", () => {
  const summary = summarizeGovernanceSnapshot(
    {
      status_query_calls: 8,
      lock_release_total: 4,
      auto_cancel_total: 2,
      auto_cancel_max_runtime_total: 1,
      r20_protocol_governance: {
        counters: {
          write_tool_calls_total: 10,
          retry_fuse_blocked_total: 2,
          retry_fuse_failure_recorded_total: 3,
          retry_fuse_success_recorded_total: 7,
          preflight_calls_total: 6,
          preflight_valid_total: 4,
          preflight_invalid_total: 2,
          preflight_blocking_error_total: 2,
          dry_run_alias_calls_total: 1,
        },
      },
      v1_polish_metrics: {
        counters: {
          read_token_checks_total: 20,
          read_token_expiry_total: 2,
        },
      },
    },
    "before.json"
  );

  assert.equal(summary.retry.retry_fuse_blocked_total, 2);
  assert.equal(summary.convergence.avg_status_queries_per_terminal_job, 2);
  assert.equal(summary.timeout.max_runtime_timeout_rate, 0.5);
  assert.equal(summary.token.read_token_expiry_rate, 0.1);
  assert.equal(summary.preflight.preflight_invalid_rate, 0.333333);
});

test("r20 governance baseline script builds before/after comparison report", () => {
  const report = buildGovernanceBaselineReport({
    beforePath: "./tmp/before.json",
    afterPath: "./tmp/after.json",
    beforeSnapshot: {
      status_query_calls: 12,
      lock_release_total: 4,
      auto_cancel_total: 4,
      auto_cancel_max_runtime_total: 2,
      r20_protocol_governance: {
        counters: {
          write_tool_calls_total: 10,
          retry_fuse_blocked_total: 4,
          preflight_calls_total: 5,
          preflight_invalid_total: 3,
          dry_run_alias_calls_total: 5,
        },
      },
      v1_polish_metrics: {
        counters: {
          read_token_checks_total: 40,
          read_token_expiry_total: 8,
        },
      },
    },
    afterSnapshot: {
      status_query_calls: 8,
      lock_release_total: 4,
      auto_cancel_total: 3,
      auto_cancel_max_runtime_total: 1,
      r20_protocol_governance: {
        counters: {
          write_tool_calls_total: 12,
          retry_fuse_blocked_total: 1,
          preflight_calls_total: 10,
          preflight_invalid_total: 2,
          dry_run_alias_calls_total: 1,
        },
      },
      v1_polish_metrics: {
        counters: {
          read_token_checks_total: 40,
          read_token_expiry_total: 2,
        },
      },
    },
  });

  assert.equal(report.schema_version, "r20_ux_governance_baseline_report.v1");
  assert.ok(report.before);
  assert.ok(report.after);
  assert.ok(report.comparison);
  assert.equal(report.comparison.retry_fuse_blocked_total.before, 4);
  assert.equal(report.comparison.retry_fuse_blocked_total.after, 1);
  assert.equal(report.comparison.retry_fuse_blocked_total.delta, -3);
});
