"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildG2TokenBaselineReport,
} = require("../../scripts/generate-g2-token-baseline-report");

test("g2 token baseline script parseArgs supports overrides", () => {
  const options = parseArgs([
    "--input",
    "./tmp/g2-input.json",
    "--output",
    "./tmp/g2-output.json",
    "--min-samples",
    "8",
    "--min-combos",
    "2",
    "--min-error-codes",
    "3",
    "--min-drift-events",
    "2",
    "--min-manual-refresh-events",
    "2",
    "--required-types",
    "simple,medium,complex,error,boundary",
    "--git-commit",
    "def456",
    "--timestamp",
    "2026-03-08T12:00:00.000Z",
    "--drift-alert-threshold",
    "0.2",
    "--manual-refresh-alert-threshold",
    "0.6",
    "--auto-retry-success-threshold",
    "0.9",
    "--write-chain-alert-threshold",
    "10",
  ]);

  assert.ok(
    options.inputPath.endsWith("tmp\\g2-input.json") ||
      options.inputPath.endsWith("tmp/g2-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\g2-output.json") ||
      options.outputPath.endsWith("tmp/g2-output.json")
  );
  assert.equal(options.minSamplesPerScenario, 8);
  assert.equal(options.minToolCombinations, 2);
  assert.equal(options.minErrorCodeVariety, 3);
  assert.equal(options.minDriftEvents, 2);
  assert.equal(options.minManualRefreshEvents, 2);
  assert.deepEqual(options.requiredScenarioTypes, [
    "simple",
    "medium",
    "complex",
    "error",
    "boundary",
  ]);
  assert.equal(options.gitCommit, "def456");
  assert.equal(options.timestamp, "2026-03-08T12:00:00.000Z");
  assert.equal(options.driftIncidenceAlertThreshold, 0.2);
  assert.equal(options.manualRefreshRatioAlertThreshold, 0.6);
  assert.equal(options.autoRetrySuccessAlertThreshold, 0.9);
  assert.equal(options.writeChainAvgCallsAlertThreshold, 10);
});

test("g2 token baseline script builds token-focused baseline metrics", () => {
  const report = buildG2TokenBaselineReport({
    inputPath: "./tmp/g2-input.json",
    gitCommit: "g2-commit-001",
    timestamp: "2026-03-08T01:00:00.000Z",
    minSamplesPerScenario: 1,
    minToolCombinations: 3,
    minErrorCodeVariety: 3,
    minDriftEvents: 1,
    minManualRefreshEvents: 1,
    snapshot: {
      schema_version: "g2_token_baseline_sample_runs.v1",
      samples: [
        {
          scenario_name: "single_object_modify",
          scenario_type: "simple",
          sample_id: "s1",
          tool_calls: [
            {
              tool_name: "get_write_contract_bundle",
              kind: "query",
              status: "ok",
              latency_ms: 80,
            },
            {
              tool_name: "set_component_properties",
              kind: "write",
              status: "ok",
              latency_ms: 95,
            },
          ],
          errors: [],
        },
        {
          scenario_name: "batch_ui_create",
          scenario_type: "medium",
          sample_id: "m1",
          tool_calls: [
            {
              tool_name: "execute_unity_transaction",
              kind: "write",
              status: "error",
              error_code: "E_SCENE_REVISION_DRIFT",
              latency_ms: 210,
            },
            {
              tool_name: "get_scene_snapshot_for_write",
              kind: "query",
              status: "ok",
              latency_ms: 52,
              manual_refresh_after_drift: true,
            },
            {
              tool_name: "execute_unity_transaction",
              kind: "write",
              status: "ok",
              latency_ms: 208,
              auto_retry_attempted: true,
              auto_retry_success: true,
              auto_retry_duration_ms: 230,
            },
          ],
          errors: [
            {
              tool_name: "execute_unity_transaction",
              error_code: "E_SCENE_REVISION_DRIFT",
            },
          ],
        },
        {
          scenario_name: "transaction_create_save",
          scenario_type: "complex",
          sample_id: "c1",
          tool_calls: [
            {
              tool_name: "get_scene_snapshot_for_write",
              kind: "query",
              status: "ok",
              latency_ms: 45,
            },
            {
              tool_name: "execute_unity_transaction",
              kind: "write",
              status: "error",
              error_code: "E_SCENE_REVISION_DRIFT",
              latency_ms: 180,
              auto_retry_attempted: true,
              auto_retry_success: false,
              auto_retry_duration_ms: 400,
            },
            {
              tool_name: "get_scene_snapshot_for_write",
              kind: "query",
              status: "ok",
              latency_ms: 48,
              manual_refresh_after_drift: true,
            },
            {
              tool_name: "save_scene",
              kind: "save",
              status: "ok",
              latency_ms: 72,
              token_candidate_issued: true,
            },
          ],
          errors: [
            {
              tool_name: "execute_unity_transaction",
              error_code: "E_SCENE_REVISION_DRIFT",
            },
          ],
        },
        {
          scenario_name: "fault_injection",
          scenario_type: "error",
          sample_id: "e1",
          tool_calls: [
            {
              tool_name: "set_serialized_property",
              kind: "write",
              status: "error",
              error_code: "E_PROPERTY_NOT_FOUND",
              latency_ms: 90,
            },
            {
              tool_name: "get_serialized_property_tree",
              kind: "query",
              status: "ok",
              latency_ms: 130,
            },
            {
              tool_name: "set_serialized_property",
              kind: "write",
              status: "ok",
              latency_ms: 96,
            },
          ],
          errors: [
            {
              tool_name: "set_serialized_property",
              error_code: "E_PROPERTY_NOT_FOUND",
            },
          ],
        },
        {
          scenario_name: "large_batch_boundary",
          scenario_type: "boundary",
          sample_id: "b1",
          tool_calls: [
            {
              tool_name: "get_hierarchy_subtree",
              kind: "query",
              status: "ok",
              latency_ms: 61,
            },
            {
              tool_name: "execute_unity_transaction",
              kind: "write",
              status: "ok",
              latency_ms: 240,
            },
            {
              tool_name: "save_scene",
              kind: "save",
              status: "error",
              error_code: "E_PRECONDITION_FAILED",
              latency_ms: 82,
            },
          ],
          errors: [
            {
              tool_name: "save_scene",
              error_code: "E_PRECONDITION_FAILED",
            },
          ],
        },
      ],
    },
  });

  assert.equal(report.schema_version, "g2_token_baseline_metrics_report.v1");
  assert.equal(report.source.git_commit, "g2-commit-001");
  assert.equal(report.source.sample_total, 5);

  assert.equal(report.metrics.totals.samples_total, 5);
  assert.equal(report.metrics.totals.total_tool_calls, 15);
  assert.equal(report.metrics.totals.query_calls_total, 6);
  assert.equal(report.metrics.totals.write_calls_total, 9);
  assert.equal(report.metrics.totals.drift_events_total, 2);
  assert.equal(report.metrics.totals.manual_refresh_after_drift_total, 2);
  assert.equal(report.metrics.totals.auto_retry_attempted_total, 2);
  assert.equal(report.metrics.totals.auto_retry_success_total, 1);
  assert.equal(report.metrics.totals.auto_retry_failure_total, 1);
  assert.equal(report.metrics.totals.token_candidate_issued_total, 1);

  assert.equal(report.metrics.drift_incidence_rate_per_write_call, 0.222222);
  assert.equal(report.metrics.manual_refresh_after_drift_ratio, 1);
  assert.equal(report.metrics.write_chain_avg_call_count, 3);
  assert.equal(report.metrics.avg_snapshot_calls_per_write_flow_sample, 0.6);
  assert.equal(report.metrics.auto_retry_success_rate, 0.5);
  assert.equal(report.metrics.auto_retry_attempted_rate_per_drift_event, 1);
  assert.equal(report.metrics.token_candidate_issue_rate_per_write_call, 0.111111);
  assert.equal(report.metrics.auto_retry_latency_p95_ms, 391.5);

  assert.equal(report.representativeness.all_passed, true);
  assert.equal(report.representativeness.unique_tool_combinations, 5);

  assert.equal(report.error_code_distribution.total_unique_error_codes, 3);
  assert.equal(report.drift_hotspots.total_drift_events, 2);
  assert.equal(report.drift_hotspots.rows[0].tool_name, "execute_unity_transaction");
  assert.equal(report.drift_hotspots.rows[0].drift_count, 2);

  assert.equal(
    report.observability_alerts.some(
      (item) => item.code === "DRIFT_INCIDENCE_HIGH"
    ),
    true
  );
  assert.equal(
    report.observability_alerts.some(
      (item) => item.code === "MANUAL_REFRESH_AFTER_DRIFT_HIGH"
    ),
    true
  );
  assert.equal(
    report.observability_alerts.some(
      (item) => item.code === "AUTO_RETRY_SUCCESS_RATE_LOW"
    ),
    true
  );
});
