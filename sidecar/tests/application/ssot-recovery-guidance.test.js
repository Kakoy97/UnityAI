"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeFailureContext,
  projectFailureDataFromContext,
} = require("../../src/application/errorFeedback/failureContextNormalizer");
const {
  planRecoveryAction,
} = require("../../src/application/errorFeedback/recoveryPlanner");
const {
  withMcpErrorFeedback,
} = require("../../src/application/errorFeedback/mcpErrorFeedback");

test("failure context marks stale snapshot and requires refresh when TTL exceeded", () => {
  const issuedAt = "2026-03-07T10:00:00.000Z";
  const nowMs = Date.parse("2026-03-07T10:10:00.000Z");
  const normalized = normalizeFailureContext({
    errorCode: "E_TRANSACTION_STEP_FAILED",
    context: {
      stage: "during_transaction",
      failed_step_id: "step_add_layout",
      failed_tool_name: "add_component",
      failed_error_code: "E_COMPONENT_TYPE_INVALID",
      failed_error_message: "invalid component type",
      nested_error_code: "E_COMPONENT_TYPE_INVALID",
      nested_error_message: "invalid component type",
      error_context_issued_at: issuedAt,
    },
    globalContracts: {
      error_context_contract: {
        transaction_failure: {
          required_fields: [
            "failed_step_id",
            "failed_tool_name",
            "failed_error_code",
            "failed_error_message",
            "nested_error_code",
            "nested_error_message",
          ],
        },
      },
      recovery_action_contract: {
        context_validity: {
          ttl_seconds: 60,
        },
      },
    },
    nowMs,
  });

  assert.equal(normalized.context_stale, true);
  assert.equal(normalized.requires_context_refresh, true);
  assert.equal(normalized.context_missing, false);
});

test("recovery planner rejects dependency cycle with fail-fast plan error", () => {
  const plan = planRecoveryAction({
    errorCode: "E_SCENE_REVISION_DRIFT",
    toolName: "execute_unity_transaction",
    toolRecord: {
      common_error_fixes: {
        E_SCENE_REVISION_DRIFT: {
          suggested_action: "get_scene_snapshot_for_write",
          fix_steps: [
            {
              step: 1,
              step_id: "fix_a",
              tool: "get_scene_snapshot_for_write",
              depends_on: ["fix_b"],
            },
            {
              step: 2,
              step_id: "fix_b",
              tool: "get_scene_snapshot_for_write",
              depends_on: ["fix_a"],
            },
          ],
        },
      },
    },
    catalog: {
      byName: new Map([
        [
          "get_scene_snapshot_for_write",
          { name: "get_scene_snapshot_for_write", kind: "read" },
        ],
      ]),
      tools: [],
    },
    globalContracts: {
      recovery_action_contract: {
        dependency_validation: {
          check_cycles: true,
          max_depth: 10,
          on_cycle_detected: "fail_fast",
        },
      },
    },
    failureContext: {
      stage: "after_write",
      scene_revision_changed: true,
    },
  });

  assert.equal(plan.plan_error_code, "E_RECOVERY_PLAN_CYCLE");
  assert.equal(Array.isArray(plan.fix_steps), true);
  assert.equal(plan.fix_steps.length, 0);
});

test("recovery planner rejects fix_steps depends_on unknown step id", () => {
  const plan = planRecoveryAction({
    errorCode: "E_SCENE_REVISION_DRIFT",
    toolName: "execute_unity_transaction",
    toolRecord: {
      common_error_fixes: {
        E_SCENE_REVISION_DRIFT: {
          suggested_action: "get_scene_snapshot_for_write",
          fix_steps: [
            {
              step: 1,
              step_id: "refresh_token",
              tool: "get_scene_snapshot_for_write",
              depends_on: ["non_existing_step"],
            },
          ],
        },
      },
    },
    catalog: {
      byName: new Map([
        [
          "get_scene_snapshot_for_write",
          { name: "get_scene_snapshot_for_write", kind: "read" },
        ],
      ]),
      tools: [],
    },
    globalContracts: {
      recovery_action_contract: {
        dependency_validation: {
          check_cycles: true,
          max_depth: 10,
          on_cycle_detected: "fail_fast",
        },
      },
    },
    failureContext: {
      stage: "after_write",
      scene_revision_changed: true,
    },
  });

  assert.equal(plan.plan_error_code, "E_RECOVERY_PLAN_CYCLE");
  assert.equal(
    String(plan.plan_error_message || "").includes("unknown step_id"),
    true
  );
  assert.equal(plan.fix_steps.length, 0);
});

test("mcp error feedback exposes structured recovery fields for transaction errors", () => {
  const feedback = withMcpErrorFeedback({
    error_code: "E_TRANSACTION_REF_PATH_INVALID",
    message: "transaction alias field is not allowed",
    tool_name: "execute_unity_transaction",
    context: {
      stage: "during_transaction",
    },
  });

  assert.equal(feedback.error_code, "E_TRANSACTION_REF_PATH_INVALID");
  assert.equal(feedback.suggested_action, "get_write_contract_bundle");
  assert.equal(feedback.execution_order, "sequential");
  assert.equal(feedback.failure_handling, "stop_on_first_failure");
  assert.equal(feedback.fallback_strategy, "return_manual_instructions");
  assert.equal(Array.isArray(feedback.fix_steps), true);
  assert.equal(feedback.fix_steps.length > 0, true);
});

test("recovery planner routes E_TRANSACTION_STEP_FAILED by nested_error_code", () => {
  const plan = planRecoveryAction({
    errorCode: "E_TRANSACTION_STEP_FAILED",
    toolName: "execute_unity_transaction",
    toolRecord: {
      common_error_fixes: {
        E_TRANSACTION_STEP_FAILED: {
          suggested_action: "get_write_contract_bundle",
          fix_hint: "inspect nested error",
          fix_steps: [
            {
              step: 1,
              tool: "get_write_contract_bundle",
            },
          ],
          nested_error_routes: {
            E_TARGET_ANCHOR_CONFLICT: {
              suggested_action: "get_hierarchy_subtree",
              fix_hint: "refresh target anchors",
              fix_steps: [
                {
                  step: 1,
                  tool: "get_hierarchy_subtree",
                },
                {
                  step: 2,
                  tool: "execute_unity_transaction",
                },
              ],
            },
          },
        },
      },
    },
    catalog: {
      byName: new Map([
        ["get_write_contract_bundle", { name: "get_write_contract_bundle", kind: "read" }],
        ["get_hierarchy_subtree", { name: "get_hierarchy_subtree", kind: "read" }],
        ["execute_unity_transaction", { name: "execute_unity_transaction", kind: "write" }],
      ]),
      tools: [],
    },
    globalContracts: {
      recovery_action_contract: {
        dependency_validation: {
          check_cycles: true,
          max_depth: 10,
          on_cycle_detected: "fail_fast",
        },
      },
    },
    failureContext: {
      stage: "during_transaction",
      nested_error_code: "E_TARGET_ANCHOR_CONFLICT",
    },
  });

  assert.equal(plan.suggested_action, "get_hierarchy_subtree");
  assert.equal(plan.routed_error_code, "E_TARGET_ANCHOR_CONFLICT");
  assert.equal(plan.routed_source, "tool_nested_error_route");
  assert.equal(plan.fix_steps.length, 2);
  assert.equal(plan.fix_steps[0].tool, "get_hierarchy_subtree");
});

test("recovery planner baseline for anchor conflict returns deterministic rebind steps", () => {
  const plan = planRecoveryAction({
    errorCode: "E_TARGET_ANCHOR_CONFLICT",
    toolName: "modify_ui_layout",
    toolRecord: {
      name: "modify_ui_layout",
      kind: "write",
      common_error_fixes: {},
    },
    catalog: {
      byName: new Map([
        ["get_hierarchy_subtree", { name: "get_hierarchy_subtree", kind: "read" }],
        ["modify_ui_layout", { name: "modify_ui_layout", kind: "write" }],
      ]),
      tools: [],
    },
    globalContracts: {
      recovery_action_contract: {
        dependency_validation: {
          check_cycles: true,
          max_depth: 10,
          on_cycle_detected: "fail_fast",
        },
      },
    },
    failureContext: {
      stage: "during_dispatch",
      ambiguity_kind: "path_object_id_mismatch",
      path_candidate_path: "Scene/Canvas/A",
      path_candidate_object_id: "GlobalObjectId_V1-2-a-0",
      object_id_candidate_path: "Scene/Canvas/B",
      object_id_candidate_object_id: "GlobalObjectId_V1-2-b-0",
    },
  });

  assert.equal(plan.suggested_action, "get_hierarchy_subtree");
  assert.equal(Array.isArray(plan.fix_steps), true);
  assert.equal(plan.fix_steps.length >= 3, true);
  assert.equal(plan.fix_steps[0].step_id, "inspect_path_anchor_candidate");
  assert.equal(plan.fix_steps[0].tool, "get_hierarchy_subtree");
  assert.equal(Array.isArray(plan.fix_steps[0].context_bindings), true);
  assert.equal(
    plan.fix_steps[0].context_bindings.includes("path_candidate_object_id"),
    true
  );
  assert.equal(plan.fix_steps[2].step_id, "retry_with_matched_anchor");
  assert.equal(plan.fix_steps[2].tool, "modify_ui_layout");
});

test("mcp error feedback includes routed nested recovery metadata", () => {
  const feedback = withMcpErrorFeedback({
    error_code: "E_TRANSACTION_STEP_FAILED",
    message: "transaction step failed: add_layout",
    tool_name: "execute_unity_transaction",
    data: {
      nested_error_code: "E_TRANSACTION_REF_PATH_INVALID",
      nested_error_message: "transaction alias field is not allowed",
      failed_step_id: "add_layout",
      failed_tool_name: "add_component",
    },
    context: {
      stage: "during_transaction",
    },
  });

  assert.equal(feedback.error_code, "E_TRANSACTION_STEP_FAILED");
  assert.equal(feedback.suggested_action, "get_write_contract_bundle");
  assert.equal(feedback.routed_error_code, "E_TRANSACTION_REF_PATH_INVALID");
  assert.equal(typeof feedback.routed_source, "string");
  assert.equal(feedback.failed_step_id, "add_layout");
  assert.equal(feedback.nested_error_code, "E_TRANSACTION_REF_PATH_INVALID");
});

test("failure context hydrates nested_context_json and canonicalizes nested error code", () => {
  const normalized = normalizeFailureContext({
    errorCode: "E_TRANSACTION_STEP_FAILED",
    data: {
      nested_context_json: JSON.stringify({
        error_code: "E_OBJECT_NOT_FOUND",
        error_message: "object not found",
        path_candidate_path: "Scene/Canvas/ContainerA",
        path_candidate_object_id: "GlobalObjectId_V1-2-a-0",
      }),
    },
    context: {
      stage: "during_transaction",
    },
    globalContracts: {
      recovery_action_contract: {
        context_validity: {
          ttl_seconds: 300,
        },
      },
    },
    nowMs: Date.parse("2026-03-07T10:05:00.000Z"),
  });

  assert.equal(normalized.context.failed_error_code, "E_TARGET_NOT_FOUND");
  assert.equal(normalized.context.nested_error_code, "E_TARGET_NOT_FOUND");
  assert.equal(normalized.context.path_candidate_path, "Scene/Canvas/ContainerA");
  assert.equal(
    normalized.context.path_candidate_object_id,
    "GlobalObjectId_V1-2-a-0"
  );
  assert.equal(
    typeof normalized.context.l3_context.nested_context,
    "object"
  );
});

test("failure context normalizes planner orchestration trace fields from planner_execute_mcp failure data", () => {
  const normalized = normalizeFailureContext({
    errorCode: "E_BLOCK_EXECUTION_FAILED",
    data: {
      planner_orchestration: {
        failure_stage: "during_dispatch",
        execution_shape: "transaction",
        execution_shape_reason: "transaction_candidate_confirmed",
        auto_transaction_applied: false,
        blocked_reason: "transaction_read_token_missing",
        dispatch_mode: "single_block_direct",
        source_shape_reason: "transaction_candidate_confirmed",
        transaction_id: "plan_recovery_trace",
        step_count: 2,
      },
    },
    context: {
      previous_operation: "execute_planner_entry_for_mcp",
    },
    globalContracts: {
      recovery_action_contract: {
        context_validity: {
          ttl_seconds: 300,
        },
      },
    },
  });

  assert.equal(normalized.context.stage, "during_dispatch");
  assert.equal(normalized.context.planner_failure_stage, "during_dispatch");
  assert.equal(normalized.context.planner_execution_shape, "transaction");
  assert.equal(
    normalized.context.planner_execution_shape_reason,
    "transaction_candidate_confirmed"
  );
  assert.equal(normalized.context.planner_auto_transaction_applied, false);
  assert.equal(
    normalized.context.planner_blocked_reason,
    "transaction_read_token_missing"
  );
  assert.equal(normalized.context.planner_dispatch_mode, "single_block_direct");
  assert.equal(normalized.context.planner_transaction_id, "plan_recovery_trace");
  assert.equal(normalized.context.planner_step_count, 2);

  const projected = projectFailureDataFromContext(normalized.context);
  assert.equal(projected.planner_failure_stage, "during_dispatch");
  assert.equal(projected.planner_blocked_reason, "transaction_read_token_missing");
});

test("mcp error feedback surfaces planner orchestration trace fields for direct debugging", () => {
  const feedback = withMcpErrorFeedback({
    error_code: "E_BLOCK_EXECUTION_FAILED",
    message: "planner dispatch failed",
    tool_name: "planner_execute_mcp",
    data: {
      planner_orchestration: {
        failure_stage: "during_dispatch",
        execution_shape: "transaction",
        execution_shape_reason: "transaction_candidate_confirmed",
        auto_transaction_applied: false,
        blocked_reason: "transaction_read_token_missing",
        dispatch_mode: "single_block_direct",
        transaction_id: "plan_feedback_trace",
        step_count: 2,
      },
    },
    context: {
      stage: "during_dispatch",
    },
  });

  assert.equal(feedback.planner_failure_stage, "during_dispatch");
  assert.equal(feedback.planner_execution_shape, "transaction");
  assert.equal(
    feedback.planner_execution_shape_reason,
    "transaction_candidate_confirmed"
  );
  assert.equal(feedback.planner_auto_transaction_applied, false);
  assert.equal(feedback.planner_blocked_reason, "transaction_read_token_missing");
  assert.equal(feedback.planner_dispatch_mode, "single_block_direct");
  assert.equal(feedback.planner_transaction_id, "plan_feedback_trace");
  assert.equal(feedback.planner_step_count, 2);
});

test("recovery planner resolves numeric depends_on indexes to step_id", () => {
  const plan = planRecoveryAction({
    errorCode: "E_TARGET_ANCHOR_CONFLICT",
    toolName: "execute_unity_transaction",
    toolRecord: {
      common_error_fixes: {
        E_TARGET_ANCHOR_CONFLICT: {
          suggested_action: "get_hierarchy_subtree",
          fix_steps: [
            {
              step: 1,
              step_id: "inspect_anchor_a",
              tool: "get_hierarchy_subtree",
            },
            {
              step: 2,
              step_id: "inspect_anchor_b",
              tool: "get_hierarchy_subtree",
              depends_on: [1],
            },
          ],
        },
      },
    },
    catalog: {
      byName: new Map([
        ["get_hierarchy_subtree", { name: "get_hierarchy_subtree", kind: "read" }],
        ["execute_unity_transaction", { name: "execute_unity_transaction", kind: "write" }],
      ]),
      tools: [],
    },
    globalContracts: {
      recovery_action_contract: {
        dependency_validation: {
          check_cycles: true,
          max_depth: 10,
          on_cycle_detected: "fail_fast",
        },
      },
    },
    failureContext: {
      stage: "during_transaction",
    },
  });

  assert.equal(plan.plan_error_code, "");
  assert.equal(plan.fix_steps.length, 2);
  assert.deepEqual(plan.fix_steps[1].depends_on, ["inspect_anchor_a"]);
});

test("misroute guidance differs for same error code when scene signal candidate is present vs absent", () => {
  const withSceneSignal = withMcpErrorFeedback({
    error_code: "E_SCHEMA_INVALID",
    error_message: "input must contain exactly one of file_actions or visual_layer_actions",
    tool_name: "planner_execute_mcp",
    data: {
      planner_orchestration: {
        workflow_candidate_hit: true,
        workflow_candidate_confidence: "high",
        workflow_candidate_rule_id: "script_create_compile_attach_candidate_v1",
        workflow_gating_action: "warn",
        workflow_gating_rule_id: "workflow_gating_warn_script_candidate_v1",
        recommended_workflow_template_id: "script_create_compile_attach.v1",
      },
    },
    context: {
      stage: "during_dispatch",
    },
  });
  const withoutSceneSignal = withMcpErrorFeedback({
    error_code: "E_SCHEMA_INVALID",
    error_message: "input must contain exactly one of file_actions or visual_layer_actions",
    tool_name: "planner_execute_mcp",
    data: {
      planner_orchestration: {
        workflow_candidate_hit: false,
        workflow_candidate_confidence: "none",
        workflow_gating_action: "allow",
      },
    },
    context: {
      stage: "during_dispatch",
    },
  });

  assert.equal(withSceneSignal.error_code, "E_SCHEMA_INVALID");
  assert.equal(typeof withSceneSignal.workflow_recommendation, "object");
  assert.equal(
    withSceneSignal.workflow_recommendation.workflow_template_id,
    "script_create_compile_attach_with_ensure_target.v1"
  );
  assert.equal(withoutSceneSignal.error_code, "E_SCHEMA_INVALID");
  assert.equal(
    Object.prototype.hasOwnProperty.call(withoutSceneSignal, "workflow_recommendation"),
    false
  );
});

test("workflow resolved_target conflict returns deterministic contract-first guidance", () => {
  const feedback = withMcpErrorFeedback({
    error_code: "E_WORKFLOW_RESOLVED_TARGET_CONFLICT",
    error_message:
      "input.visual_layer_actions[0] target_path conflicts with resolved_target_path",
    tool_name: "planner_execute_mcp",
    context: {
      stage: "during_dispatch",
    },
  });

  assert.equal(feedback.error_code, "E_WORKFLOW_RESOLVED_TARGET_CONFLICT");
  assert.equal(feedback.recoverable, true);
  assert.equal(feedback.suggested_action, "get_write_contract_bundle");
  assert.equal(feedback.suggested_tool, "get_write_contract_bundle");
  assert.equal(
    String(feedback.fix_hint || "").includes(
      "Align attach target with workflow_orchestration.resolved_target"
    ),
    true
  );
});
