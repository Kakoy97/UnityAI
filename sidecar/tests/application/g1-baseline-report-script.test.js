"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  classifyErrorCategory,
  buildG1BaselineReport,
} = require("../../scripts/generate-g1-baseline-report");

test("g1 baseline script parseArgs supports overrides", () => {
  const options = parseArgs([
    "--input",
    "./tmp/g1-input.json",
    "--output",
    "./tmp/g1-output.json",
    "--min-samples",
    "8",
    "--min-combos",
    "2",
    "--min-error-codes",
    "4",
    "--required-types",
    "simple,medium,complex,error,boundary",
    "--git-commit",
    "abc123",
    "--timestamp",
    "2026-03-07T12:00:00.000Z",
    "--recovery-success-threshold",
    "0.85",
    "--recovery-latency-threshold-ms",
    "900",
  ]);

  assert.ok(
    options.inputPath.endsWith("tmp\\g1-input.json") ||
      options.inputPath.endsWith("tmp/g1-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\g1-output.json") ||
      options.outputPath.endsWith("tmp/g1-output.json")
  );
  assert.equal(options.minSamplesPerScenario, 8);
  assert.equal(options.minToolCombinations, 2);
  assert.equal(options.minErrorCodeVariety, 4);
  assert.deepEqual(options.requiredScenarioTypes, [
    "simple",
    "medium",
    "complex",
    "error",
    "boundary",
  ]);
  assert.equal(options.gitCommit, "abc123");
  assert.equal(options.timestamp, "2026-03-07T12:00:00.000Z");
  assert.equal(options.recoverySuccessAlertThreshold, 0.85);
  assert.equal(options.recoveryLatencyAlertThresholdMs, 900);
});

test("g1 baseline script classifies error categories with unknown fallback", () => {
  assert.equal(classifyErrorCategory("E_SCENE_REVISION_DRIFT"), "token");
  assert.equal(classifyErrorCategory("E_PROPERTY_NOT_FOUND"), "parameter");
  assert.equal(classifyErrorCategory("E_TARGET_NOT_FOUND"), "execution");
  assert.equal(classifyErrorCategory("E_PRECONDITION_FAILED"), "guard");
  assert.equal(classifyErrorCategory("E_CUSTOM_UNKNOWN_CODE"), "unknown");
});

test("g1 baseline script builds metrics, priority, and representativeness summary", () => {
  const report = buildG1BaselineReport({
    inputPath: "./tmp/g1-input.json",
    gitCommit: "commit-001",
    timestamp: "2026-03-07T01:00:00.000Z",
    minSamplesPerScenario: 1,
    minToolCombinations: 3,
    minErrorCodeVariety: 3,
    recoverySuccessAlertThreshold: 0.8,
    recoveryLatencyAlertThresholdMs: 500,
    snapshot: {
      schema_version: "g1_baseline_sample_runs.v1",
      samples: [
        {
          scenario_name: "single_object_modify",
          scenario_type: "simple",
          sample_id: "s1",
          seed: "seed-1",
          first_write_success: true,
          blind_retry_count: 0,
          tool_calls: [
            {
              tool_name: "get_write_contract_bundle",
              kind: "query",
              status: "ok",
              latency_ms: 90,
            },
            {
              tool_name: "set_component_properties",
              kind: "write",
              status: "ok",
              latency_ms: 110,
            },
          ],
          errors: [],
        },
        {
          scenario_name: "batch_ui_create",
          scenario_type: "medium",
          sample_id: "m1",
          seed: "seed-2",
          first_write_success: false,
          blind_retry_count: 1,
          tool_calls: [
            {
              tool_name: "get_scene_snapshot_for_write",
              kind: "query",
              status: "ok",
              latency_ms: 40,
            },
            {
              tool_name: "execute_unity_transaction",
              kind: "write",
              status: "error",
              error_code: "E_SCENE_REVISION_DRIFT",
              latency_ms: 180,
              error_feedback_bytes: 1400,
              suggested_action_executed: true,
              recovery_attempted: true,
              recovery_success: true,
              recovery_latency_ms: 320,
            },
            {
              tool_name: "get_write_contract_bundle",
              kind: "query",
              status: "ok",
              latency_ms: 130,
            },
          ],
          errors: [
            {
              error_code: "E_SCENE_REVISION_DRIFT",
              tool_name: "execute_unity_transaction",
            },
          ],
        },
        {
          scenario_name: "transaction_create_save",
          scenario_type: "complex",
          sample_id: "c1",
          seed: "seed-3",
          first_write_success: true,
          blind_retry_count: 0,
          tool_calls: [
            {
              tool_name: "execute_unity_transaction",
              kind: "write",
              status: "ok",
              latency_ms: 220,
            },
            {
              tool_name: "save_scene",
              kind: "save",
              status: "error",
              error_code: "E_PRECONDITION_FAILED",
              latency_ms: 80,
              error_feedback_bytes: 512,
              suggested_action_executed: true,
              recovery_attempted: true,
              recovery_success: false,
              recovery_latency_ms: 900,
            },
            {
              tool_name: "get_write_contract_bundle",
              kind: "query",
              status: "ok",
              latency_ms: 100,
            },
          ],
          errors: [
            {
              error_code: "E_PRECONDITION_FAILED",
              tool_name: "save_scene",
            },
          ],
        },
        {
          scenario_name: "fault_injection",
          scenario_type: "error",
          sample_id: "e1",
          seed: "seed-4",
          first_write_success: false,
          blind_retry_count: 1,
          tool_calls: [
            {
              tool_name: "set_serialized_property",
              kind: "write",
              status: "error",
              error_code: "E_PROPERTY_NOT_FOUND",
              latency_ms: 75,
              error_feedback_bytes: 2200,
              suggested_action_executed: true,
              recovery_attempted: true,
              recovery_success: false,
              recovery_latency_ms: 1600,
            },
          ],
          errors: [
            {
              error_code: "E_PROPERTY_NOT_FOUND",
              tool_name: "set_serialized_property",
            },
          ],
        },
        {
          scenario_name: "large_batch_boundary",
          scenario_type: "boundary",
          sample_id: "b1",
          seed: "seed-5",
          first_write_success: true,
          blind_retry_count: 0,
          tool_calls: [
            {
              tool_name: "get_hierarchy_subtree",
              kind: "query",
              status: "ok",
              latency_ms: 60,
            },
            {
              tool_name: "execute_unity_transaction",
              kind: "write",
              status: "ok",
              latency_ms: 260,
            },
          ],
          errors: [
            {
              error_code: "E_BRAND_NEW_UNKNOWN",
              tool_name: "execute_unity_transaction",
            },
          ],
        },
      ],
    },
  });

  assert.equal(report.schema_version, "g1_baseline_metrics_report.v1");
  assert.equal(report.source.git_commit, "commit-001");
  assert.equal(report.source.sample_total, 5);

  assert.equal(report.metrics.first_submit_success_rate, 0.6);
  assert.equal(report.metrics.avg_query_calls_per_sample, 1);
  assert.equal(report.metrics.get_write_contract_bundle_p95_latency_ms, 127);
  assert.equal(report.metrics.structured_error_response_p95_bytes, 2120);
  assert.ok(report.metrics.blind_retry_rate > 0);

  assert.equal(report.representativeness.all_passed, true);
  assert.equal(report.representativeness.unique_tool_combinations, 5);
  assert.equal(report.representativeness.unique_error_codes, 4);

  assert.equal(report.failure_categories.counts.token, 1);
  assert.equal(report.failure_categories.counts.parameter, 1);
  assert.equal(report.failure_categories.counts.guard, 1);
  assert.equal(report.failure_categories.counts.unknown, 1);
  assert.deepEqual(report.failure_categories.unknown_codes, [
    "E_BRAND_NEW_UNKNOWN",
  ]);

  assert.equal(report.recovery_observability.error_events_total, 3);
  assert.equal(report.recovery_observability.suggested_action_executed_total, 3);
  assert.equal(report.recovery_observability.recovery_attempts_total, 3);
  assert.equal(report.recovery_observability.recovery_success_total, 1);
  assert.equal(report.recovery_observability.recovery_failure_total, 2);
  assert.equal(report.recovery_observability.recovery_success_rate, 0.333333);
  assert.equal(report.recovery_observability.recovery_latency_p95_ms, 1530);
  assert.equal(report.recovery_observability.recovery_latency_avg_ms, 940);
  assert.equal(
    report.observability_alerts.some(
      (item) => item.code === "RECOVERY_SUCCESS_RATE_LOW"
    ),
    true
  );
  assert.equal(
    report.observability_alerts.some(
      (item) => item.code === "RECOVERY_LATENCY_P95_HIGH"
    ),
    true
  );

  assert.ok(report.tool_priority.tools.length >= 4);
  assert.ok(Array.isArray(report.tool_priority.p0_tools));
  assert.ok(report.tool_priority.p0_tools.includes("execute_unity_transaction"));
});
