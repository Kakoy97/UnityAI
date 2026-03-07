"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildShadowAnalysisReport,
} = require("../../scripts/generate-g2-token-shadow-analysis-report");

test("g2 token shadow analysis script parseArgs supports overrides", () => {
  const options = parseArgs([
    "--input",
    "./tmp/shadow-input.json",
    "--output",
    "./tmp/shadow-output.json",
    "--top",
    "7",
    "--min-recoverable-rate",
    "0.75",
    "--max-blocked-rate",
    "0.2",
    "--max-blocked-total-for-safe",
    "3",
    "--ci",
  ]);
  assert.ok(
    options.inputPath.endsWith("tmp\\shadow-input.json") ||
      options.inputPath.endsWith("tmp/shadow-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\shadow-output.json") ||
      options.outputPath.endsWith("tmp/shadow-output.json")
  );
  assert.equal(options.topN, 7);
  assert.equal(options.minRecoverableRate, 0.75);
  assert.equal(options.maxBlockedRate, 0.2);
  assert.equal(options.maxBlockedTotalForSafe, 3);
  assert.equal(options.ci, true);
});

test("g2 token shadow analysis script builds convergence report", () => {
  const report = buildShadowAnalysisReport({
    inputPath: "./tmp/shadow-input.json",
    topN: 3,
    minRecoverableRate: 0.6,
    maxBlockedRate: 0.4,
    maxBlockedTotalForSafe: 5,
    snapshot: {
      schema_version: "token_drift_recovery_shadow_metrics.v1",
      totals: {
        events_total: 20,
        drift_error_total: 16,
        recoverable_total: 9,
        blocked_total: 11,
      },
      blocked_by_reason: {
        idempotency_key_missing: 4,
        tool_family_not_safe: 3,
        global_limit: 2,
        queue_limit: 2,
      },
      policy_limits: {
        snapshot_refresh_timeout_ms: 2000,
        retry_dispatch_timeout_ms: 5000,
        total_recovery_timeout_ms: 8000,
        max_global_recovery_tasks: 10,
        max_session_recovery_tasks: 1,
        max_tool_recovery_tasks: 1,
        max_recovery_queue_size: 10,
      },
      by_tool: [
        {
          tool_name: "modify_ui_layout",
          token_family: "write_requires_token",
          events_total: 10,
          drift_error_total: 10,
          recoverable_total: 7,
          blocked_total: 3,
          recoverable_rate: 0.7,
        },
        {
          tool_name: "execute_unity_transaction",
          token_family: "write_requires_token",
          events_total: 5,
          drift_error_total: 4,
          recoverable_total: 1,
          blocked_total: 4,
          recoverable_rate: 0.25,
        },
        {
          tool_name: "get_scene_roots",
          token_family: "read_issues_token",
          events_total: 5,
          drift_error_total: 2,
          recoverable_total: 1,
          blocked_total: 4,
          recoverable_rate: 0.5,
        },
      ],
    },
  });

  assert.equal(report.schema_version, "g2_token_shadow_analysis_report.v1");
  assert.equal(report.metrics.events_total, 20);
  assert.equal(report.metrics.drift_error_total, 16);
  assert.equal(report.metrics.blocked_total, 11);
  assert.equal(report.blocked_reasons_topn.length, 3);
  assert.equal(report.blocked_reasons_topn[0].reason, "idempotency_key_missing");
  assert.equal(report.high_risk_tools_topn.length, 3);
  assert.equal(
    report.high_risk_tools_topn[0].tool_name,
    "execute_unity_transaction"
  );
  assert.equal(
    report.convergence.proposed_auto_retry_safe_family_keep.includes(
      "write_requires_token"
    ),
    false
  );
  assert.equal(
    report.convergence.proposed_auto_retry_safe_family_drop.includes(
      "read_issues_token"
    ),
    true
  );
  assert.equal(Array.isArray(report.checks), true);
  assert.equal(report.checks.length, 5);
  assert.equal(report.all_passed, false);
});
