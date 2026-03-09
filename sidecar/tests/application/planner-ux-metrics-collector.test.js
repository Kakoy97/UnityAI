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
  });

  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.schema_version, "planner_entry_ux_metrics.v1");
  assert.equal(snapshot.totals.requests_total, 3);
  assert.equal(snapshot.totals.first_attempt_success_total, 1);
  assert.equal(snapshot.totals.first_attempt_failure_total, 2);
  assert.equal(snapshot.first_attempt_success.total, 1);
  assert.equal(snapshot.first_attempt_success.rate, 0.333333);
  assert.equal(snapshot.normalized_alias_fields.total, 1);
  assert.equal(snapshot.auto_filled_fields.total, 3);
  assert.equal(snapshot.failure_stage.before_dispatch_total, 1);
  assert.equal(snapshot.failure_stage.during_dispatch_total, 1);
  assert.equal(snapshot.failure_stage.unknown_total, 0);
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
    snapshot.optional_metrics.schema_lookup_count_supported,
    false
  );
});
