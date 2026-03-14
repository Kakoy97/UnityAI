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
      workflow_candidate_hit: true,
      workflow_candidate_confidence: "high",
      workflow_gating_action: "warn",
      workflow_template_applied: true,
      workflow_template_id: "script_create_compile_attach.v1",
      workflow_compile_wait_duration_ms: 42,
      collision_policy_used: "reuse",
      existing_candidates_count: 1,
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
    orchestration_meta: {
      workflow_candidate_hit: true,
      workflow_candidate_confidence: "medium",
      workflow_gating_action: "reject",
      recommended_workflow_template_id: "script_create_compile_attach.v1",
      workflow_recommendation_suggested: true,
      workflow_recommendation_source_rule_id:
        "workflow_misroute_recovery_script_candidate_v1",
      collision_policy_used: "fail",
      existing_candidates_count: 2,
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
    orchestration_meta: {
      workflow_candidate_hit: false,
      workflow_candidate_confidence: "none",
      workflow_gating_action: "allow",
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
      workflow_gating_action: "warn",
      workflow_template_applied: false,
      dispatch_mode: "single_block_direct",
    },
  });

  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.schema_version, "planner_entry_ux_metrics.v1");
  assert.equal(snapshot.totals.requests_total, 5);
  assert.equal(snapshot.totals.first_attempt_success_total, 1);
  assert.equal(snapshot.totals.first_attempt_failure_total, 4);
  assert.equal(snapshot.first_attempt_success.total, 1);
  assert.equal(snapshot.first_attempt_success.rate, 0.2);
  assert.equal(snapshot.normalized_alias_fields.total, 1);
  assert.equal(snapshot.auto_filled_fields.total, 3);
  assert.equal(snapshot.totals.transaction_auto_applied_total, 1);
  assert.equal(snapshot.totals.transaction_auto_blocked_total, 1);
  assert.equal(snapshot.totals.workflow_candidate_hit_total, 2);
  assert.equal(snapshot.totals.workflow_first_selected_total, 1);
  assert.equal(snapshot.totals.gating_warn_total, 2);
  assert.equal(snapshot.totals.gating_warn_success_total, 1);
  assert.equal(snapshot.totals.gating_warn_failure_total, 1);
  assert.equal(snapshot.totals.gating_reject_total, 1);
  assert.equal(snapshot.totals.misroute_recovery_trigger_total, 1);
  assert.equal(snapshot.totals.misroute_recovery_suggested_total, 1);
  assert.equal(snapshot.totals.script_workflow_applied_total, 1);
  assert.equal(snapshot.totals.script_workflow_success_total, 1);
  assert.equal(snapshot.totals.script_workflow_failure_total, 0);
  assert.equal(snapshot.totals.collision_policy_reported_total, 2);
  assert.equal(snapshot.transaction_auto_applied.total, 1);
  assert.equal(snapshot.transaction_auto_blocked.total, 1);
  assert.equal(snapshot.transaction_auto_blocked.by_reason.length, 1);
  assert.equal(
    snapshot.transaction_auto_blocked.by_reason[0].blocked_reason,
    "transaction_read_token_missing"
  );
  assert.equal(snapshot.transaction_auto_blocked.by_reason[0].count, 1);
  assert.equal(snapshot.workflow_candidate.hit_total, 2);
  assert.equal(snapshot.workflow_candidate.hit_rate, 0.4);
  assert.equal(snapshot.workflow_first_selected.total, 1);
  assert.equal(snapshot.workflow_first_selected.rate, 0.2);
  assert.equal(snapshot.workflow_gating_warn.total, 2);
  assert.equal(snapshot.workflow_gating_warn.success_total, 1);
  assert.equal(snapshot.workflow_gating_warn.failure_total, 1);
  assert.equal(snapshot.workflow_gating_warn.hit_rate, 0.4);
  assert.equal(snapshot.workflow_gating_warn.success_rate_after_warn, 0.5);
  assert.equal(snapshot.workflow_gating_reject.total, 1);
  assert.equal(snapshot.workflow_gating_reject.hit_rate, 0.2);
  assert.equal(snapshot.misroute_recovery.trigger_total, 1);
  assert.equal(snapshot.misroute_recovery.suggested_total, 1);
  assert.equal(snapshot.misroute_recovery.trigger_rate, 0.2);
  assert.equal(snapshot.misroute_recovery.suggestion_rate_on_trigger, 1);
  assert.equal(snapshot.failure_stage.before_dispatch_total, 3);
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
  assert.equal(snapshot.collision_policy.reported_total, 2);
  assert.equal(snapshot.collision_policy.hit_rate, 0.4);
  assert.equal(
    snapshot.collision_policy.by_policy.some(
      (item) => item.policy === "reuse" && item.count === 1
    ),
    true
  );
  assert.equal(
    snapshot.collision_policy.by_policy.some(
      (item) => item.policy === "fail" && item.count === 1
    ),
    true
  );
  assert.equal(snapshot.compile_wait_duration_ms.sample_count, 1);
  assert.equal(snapshot.compile_wait_duration_ms.p50, 42);
  assert.equal(snapshot.compile_wait_duration_ms.p95, 42);
  assert.equal(snapshot.compile_wait_duration_ms.max, 42);
  assert.equal(
    snapshot.by_error_code.some(
      (item) => item.error_code === "E_SCHEMA_INVALID" && item.count === 2
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
  assert.equal(snapshot.optional_metrics.schema_lookup_count_supported, false);
});

test("PlannerUxMetricsCollector aggregates ensure_target metrics", () => {
  const collector = new PlannerUxMetricsCollector({
    nowIso: () => "2026-03-10T00:00:00.000Z",
  });

  collector.recordAttempt({
    success: true,
    failure_stage: "none",
    orchestration_meta: {
      workflow_template_applied: true,
      ensure_target_invoked: true,
      ensure_target_created: true,
    },
  });
  collector.recordAttempt({
    success: true,
    failure_stage: "none",
    orchestration_meta: {
      workflow_template_applied: true,
      ensure_target_invoked: true,
      ensure_target_reused: true,
    },
  });
  collector.recordAttempt({
    success: false,
    failure_stage: "during_dispatch",
    error_code: "E_WORKFLOW_ENSURE_TARGET_AMBIGUOUS_REUSE",
    orchestration_meta: {
      workflow_template_applied: true,
      ensure_target_invoked: true,
      ensure_target_failed: true,
      ensure_target_ambiguous_reuse: true,
    },
  });

  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.totals.requests_total, 3);
  assert.equal(snapshot.totals.ensure_target_invoked_total, 3);
  assert.equal(snapshot.totals.ensure_target_created_total, 1);
  assert.equal(snapshot.totals.ensure_target_reused_total, 1);
  assert.equal(snapshot.totals.ensure_target_failed_total, 1);
  assert.equal(snapshot.totals.ensure_target_ambiguous_reuse_total, 1);
  assert.equal(snapshot.ensure_target.invoked_total, 3);
  assert.equal(snapshot.ensure_target.created_total, 1);
  assert.equal(snapshot.ensure_target.reused_total, 1);
  assert.equal(snapshot.ensure_target.failed_total, 1);
  assert.equal(snapshot.ensure_target.ambiguous_reuse_total, 1);
  assert.equal(snapshot.ensure_target.invoked_rate, 1);
  assert.equal(snapshot.ensure_target.created_rate_on_invoked, 0.333333);
  assert.equal(snapshot.ensure_target.reused_rate_on_invoked, 0.333333);
  assert.equal(snapshot.ensure_target.failed_rate_on_invoked, 0.333333);
  assert.equal(snapshot.ensure_target.ambiguous_reuse_rate_on_failed, 1);
});
