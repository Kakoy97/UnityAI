"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeFailureContext,
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
