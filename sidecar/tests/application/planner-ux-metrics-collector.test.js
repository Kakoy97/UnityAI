"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PlannerUxMetricsCollector,
} = require("../../src/application/blockRuntime/entry/PlannerUxMetricsCollector");

test("PlannerUxMetricsCollector aggregates required Phase1 metrics", () => {
  const collector = new PlannerUxMetricsCollector({
    nowIso: () => "2026-03-09T00:00:00.000Z",
  });

  collector.recordAttempt({
    success: true,
    failure_stage: "none",
    normalization_meta: {
      alias_hits: [{ canonical_field: "block_spec.block_type" }],
      auto_filled_fields: [
        { field: "block_spec.write_envelope.execution_mode" },
        { field: "block_spec.write_envelope.idempotency_key" },
      ],
    },
    orchestration_meta: {
      auto_transaction_applied: true,
      workflow_template_applied: true,
      workflow_template_id: "script_create_compile_attach.v1",
      workflow_compile_wait_duration_ms: 42,
    },
  });
  collector.recordAttempt({
    success: false,
    failure_stage: "before_dispatch",
    error_code: "E_SCHEMA_INVALID",
    normalization_meta: {
      alias_hits: [],
      auto_filled_fields: [],
    },
  });
  collector.recordAttempt({
    success: false,
    failure_stage: "during_dispatch",
    error_code: "E_PRECONDITION_FAILED",
    normalization_meta: {
      alias_hits: [],
      auto_filled_fields: [{ field: "block_spec.write_envelope.execution_mode" }],
    },
    orchestration_meta: {
      auto_transaction_applied: false,
      blocked_reason: "transaction_read_token_missing",
    },
  });
  collector.recordAttempt({
    success: false,
    failure_stage: "before_dispatch",
    error_code: "E_WORKFLOW_TEMPLATE_INVALID",
    normalization_meta: {
      alias_hits: [],
      auto_filled_fields: [],
    },
    orchestration_meta: {
      blocked_reason: "workflow_template_steps_missing",
      workflow_blocked_reason: "workflow_template_steps_missing",
      workflow_template_applied: false,
      dispatch_mode: "single_block_direct",
    },
  });

  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.schema_version, "planner_entry_ux_metrics.v1");
  assert.equal(snapshot.totals.requests_total, 4);
  assert.equal(snapshot.totals.first_attempt_success_total, 1);
  assert.equal(snapshot.totals.first_attempt_failure_total, 3);
  assert.equal(snapshot.first_attempt_success.total, 1);
  assert.equal(snapshot.first_attempt_success.rate, 0.25);
  assert.equal(snapshot.normalized_alias_fields.total, 1);
  assert.equal(snapshot.auto_filled_fields.total, 3);
  assert.equal(snapshot.totals.transaction_auto_applied_total, 1);
  assert.equal(snapshot.totals.transaction_auto_blocked_total, 1);
  assert.equal(snapshot.totals.script_workflow_applied_total, 1);
  assert.equal(snapshot.totals.script_workflow_success_total, 1);
  assert.equal(snapshot.totals.script_workflow_failure_total, 0);
  assert.equal(snapshot.transaction_auto_applied.total, 1);
  assert.equal(snapshot.transaction_auto_blocked.total, 1);
  assert.equal(snapshot.transaction_auto_blocked.by_reason.length, 1);
  assert.equal(
    snapshot.transaction_auto_blocked.by_reason[0].blocked_reason,
    "transaction_read_token_missing"
  );
  assert.equal(snapshot.transaction_auto_blocked.by_reason[0].count, 1);
  assert.equal(snapshot.failure_stage.before_dispatch_total, 2);
  assert.equal(snapshot.failure_stage.during_dispatch_total, 1);
  assert.equal(snapshot.failure_stage.unknown_total, 0);
  assert.equal(snapshot.script_workflow.applied_total, 1);
  assert.equal(snapshot.script_workflow.success_total, 1);
  assert.equal(snapshot.script_workflow.failure_total, 0);
  assert.equal(snapshot.script_workflow.by_template.length, 1);
  assert.equal(
    snapshot.script_workflow.by_template[0].workflow_template_id,
    "script_create_compile_attach.v1"
  );
  assert.equal(snapshot.script_workflow.by_template[0].count, 1);
  assert.equal(snapshot.compile_wait_duration_ms.sample_count, 1);
  assert.equal(snapshot.compile_wait_duration_ms.p50, 42);
  assert.equal(snapshot.compile_wait_duration_ms.p95, 42);
  assert.equal(snapshot.compile_wait_duration_ms.max, 42);
  assert.equal(
    snapshot.by_error_code.some(
      (item) => item.error_code === "E_SCHEMA_INVALID" && item.count === 1
    ),
    true
  );
  assert.equal(
    snapshot.by_error_code.some(
      (item) => item.error_code === "E_PRECONDITION_FAILED" && item.count === 1
    ),
    true
  );
  assert.equal(
    snapshot.by_error_code.some(
      (item) => item.error_code === "E_WORKFLOW_TEMPLATE_INVALID" && item.count === 1
    ),
    true
  );
  assert.equal(
    snapshot.optional_metrics.schema_lookup_count_supported,
    false
  );
});
