"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  withMcpErrorFeedback,
  getMcpErrorFeedbackMetricsSnapshot,
  resetMcpErrorFeedbackMetrics,
} = require("../../src/application/errorFeedback/mcpErrorFeedback");
const {
  ANCHOR_RETRY_SUGGESTION,
  OCC_STALE_SNAPSHOT_SUGGESTION,
  getErrorFeedbackContractSnapshot,
} = require("../../src/application/errorFeedback/errorFeedbackTemplateRegistry");

test.beforeEach(() => {
  resetMcpErrorFeedbackMetrics();
});

test("error feedback template registry is contract-backed", () => {
  const snapshot = getErrorFeedbackContractSnapshot();
  assert.equal(
    Array.isArray(snapshot.anchor_error_codes),
    true
  );
  assert.equal(
    snapshot.anchor_error_codes.includes("E_TARGET_ANCHOR_CONFLICT"),
    true
  );
  assert.equal(snapshot.template_count > 0, true);
});

test("anchor schema errors return unified suggestion and recoverable=true", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_ACTION_SCHEMA_INVALID",
    message: "actions[0].target_anchor is required",
  });

  assert.equal(outcome.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(outcome.recoverable, true);
  assert.equal(outcome.suggestion, ANCHOR_RETRY_SUGGESTION);
  assert.equal(outcome.status, "rejected");
});

test("anchor conflict errors return unified suggestion and recoverable=true", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_TARGET_ANCHOR_CONFLICT",
    message: "object_id and path resolve to different objects",
  });

  assert.equal(outcome.error_code, "E_TARGET_ANCHOR_CONFLICT");
  assert.equal(outcome.recoverable, true);
  assert.equal(outcome.suggestion, ANCHOR_RETRY_SUGGESTION);
  assert.equal(outcome.status, "rejected");
});

test("anchor conflict feedback exposes deterministic candidate diagnostics", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_TARGET_ANCHOR_CONFLICT",
    message: "target_path and target_object_id resolve to different objects",
    tool_name: "modify_ui_layout",
    data: {
      ambiguity_kind: "path_object_id_mismatch",
      resolved_candidates_count: 2,
      path_candidate_path: "Scene/Canvas/ImageContainerA",
      path_candidate_object_id: "GlobalObjectId_V1-2-aaa-0",
      object_id_candidate_path: "Scene/Canvas/ImageContainerB",
      object_id_candidate_object_id: "GlobalObjectId_V1-2-bbb-0",
    },
    context: {
      stage: "during_dispatch",
    },
  });

  assert.equal(outcome.error_code, "E_TARGET_ANCHOR_CONFLICT");
  assert.equal(outcome.suggested_action, "get_hierarchy_subtree");
  assert.equal(outcome.ambiguity_kind, "path_object_id_mismatch");
  assert.equal(outcome.resolved_candidates_count, 2);
  assert.equal(Array.isArray(outcome.fix_steps), true);
  assert.equal(outcome.fix_steps.length >= 3, true);
  assert.equal(outcome.fix_steps[0].tool, "get_hierarchy_subtree");
  assert.equal(outcome.fix_steps[2].tool, "modify_ui_layout");
  assert.equal(Array.isArray(outcome.anchor_conflict_candidates), true);
  assert.equal(outcome.anchor_conflict_candidates.length, 2);
  assert.equal(outcome.anchor_conflict_candidates[0].source, "path_anchor");
  assert.equal(
    outcome.anchor_conflict_candidates[1].source,
    "object_id_anchor"
  );
});

test("E_STALE_SNAPSHOT suggestion is fixed and exact", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_STALE_SNAPSHOT",
    message: "token outdated",
    suggestion: "custom stale suggestion should be ignored",
  });

  assert.equal(outcome.error_code, "E_STALE_SNAPSHOT");
  assert.equal(outcome.suggestion, OCC_STALE_SNAPSHOT_SUGGESTION);
  assert.equal(outcome.retry_policy.allow_auto_retry, true);
  assert.equal(outcome.retry_policy.max_attempts, 1);
  assert.equal(
    Array.isArray(outcome.retry_policy.required_sequence),
    true
  );
  assert.equal(
    outcome.retry_policy.required_sequence.includes("get_current_selection"),
    true
  );
});

test("R20-UX-D-02 non-stale schema errors are marked manual-fix (no blind auto-retry)", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_ACTION_SCHEMA_INVALID",
    message: "actions[0].target_anchor.object_id is required",
  });

  assert.equal(outcome.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(outcome.retry_policy.allow_auto_retry, false);
  assert.equal(outcome.retry_policy.max_attempts, 0);
  assert.equal(outcome.retry_policy.strategy, "manual_fix_required");
});

test("E_CAPTURE_MODE_DISABLED suggestion guides overlay-first diagnostics", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_CAPTURE_MODE_DISABLED",
    message: "capture mode disabled",
  });

  assert.equal(outcome.error_code, "E_CAPTURE_MODE_DISABLED");
  assert.equal(outcome.recoverable, true);
  assert.equal(
    outcome.suggestion.includes("get_ui_overlay_report"),
    true
  );
  assert.equal(outcome.suggestion.includes("render_output"), true);
});

test("auto-cancel errors use standardized feedback and hide stack payloads", () => {
  const codes = [
    "E_JOB_HEARTBEAT_TIMEOUT",
    "E_JOB_MAX_RUNTIME_EXCEEDED",
    "E_WAITING_FOR_UNITY_REBOOT_TIMEOUT",
  ];
  for (const code of codes) {
    const outcome = withMcpErrorFeedback({
      status: "cancelled",
      error_code: code,
      error_message: "Error: failure\nat stepA\nat stepB",
      suggestion: "custom suggestion should not leak",
      recoverable: false,
    });
    assert.equal(outcome.status, "cancelled");
    assert.equal(outcome.error_code, code);
    assert.equal(outcome.recoverable, true);
    assert.ok(typeof outcome.suggestion === "string" && outcome.suggestion.trim());
    assert.notEqual(outcome.suggestion, "custom suggestion should not leak");
    assert.equal(outcome.message, outcome.error_message);
    assert.equal(outcome.error_message.includes("\n"), false);
  }
});

test("unknown timeout errors use template-registry fallback (no legacy map override)", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_UNKNOWN_TIMEOUT",
    error_message: "request timeout while calling unity bridge",
  });

  assert.equal(outcome.error_code, "E_UNKNOWN_TIMEOUT");
  assert.equal(outcome.recoverable, false);
  assert.equal(
    String(outcome.suggestion || "").toLowerCase().includes("timeout"),
    true
  );
});

test("error message sanitizer strips multiline stack frames and absolute paths", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_INTERNAL",
    error_message:
      "System.Exception: failed at C:\\repo\\project\\Assets\\Editor\\A.cs:10\n at Codex.Editor.Run() in C:\\repo\\project\\Assets\\Editor\\A.cs:line 10",
  });

  assert.equal(outcome.error_message.includes("\n"), false);
  assert.equal(outcome.error_message.includes("C:\\repo\\project"), false);
  assert.equal(outcome.error_message.includes("<path>"), true);
});

test("error feedback metrics expose normalization and per-code counters", () => {
  withMcpErrorFeedback({
    error_code: "E_STALE_SNAPSHOT",
    error_message: "token stale",
  });
  withMcpErrorFeedback({
    error_code: "E_INTERNAL",
    error_message: "Error\nat line 1",
  });

  const metrics = getMcpErrorFeedbackMetricsSnapshot();
  assert.equal(metrics.error_feedback_normalized_total, 2);
  assert.ok(metrics.error_stack_sanitized_total >= 1);
  assert.equal(metrics.error_feedback_by_code.E_STALE_SNAPSHOT, 1);
  assert.equal(metrics.error_feedback_by_code.E_INTERNAL, 1);
});

test("R20-UX-GOV-04 async conflict feedback enforces polling to terminal", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_JOB_CONFLICT",
    message: "Another Unity job is already running",
  });

  assert.equal(outcome.error_code, "E_JOB_CONFLICT");
  assert.equal(outcome.recoverable, true);
  assert.equal(
    String(outcome.suggestion || "").includes("get_unity_task_status"),
    true
  );
  assert.equal(
    String(outcome.suggestion || "").includes("succeeded/failed/cancelled"),
    true
  );
});

test("structured guidance includes actionable fields for scene revision drift", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_SCENE_REVISION_DRIFT",
    message: "scene revision drift",
    tool_name: "execute_unity_transaction",
    context: {
      stage: "after_write",
      previous_operation: "create_object",
      scene_revision_changed: true,
    },
  });

  assert.equal(outcome.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(outcome.suggested_action, "get_scene_snapshot_for_write");
  assert.equal(outcome.suggested_tool, "get_scene_snapshot_for_write");
  assert.equal(
    String(outcome.fix_hint || "").includes("Refresh read token"),
    true
  );
  assert.equal(
    String(outcome.contextual_hint || "").includes("Write advanced scene revision"),
    true
  );
  assert.equal(outcome.context_missing, false);
  assert.deepEqual(outcome.missing_fields, []);
});

test("structured guidance downgrades when required context is missing", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_SCENE_REVISION_DRIFT",
    message: "scene revision drift",
    context: {
      stage: "after_write",
    },
  });

  assert.equal(outcome.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(outcome.suggested_action, "get_scene_snapshot_for_write");
  assert.equal(outcome.context_missing, true);
  assert.equal(
    Array.isArray(outcome.missing_fields) &&
      outcome.missing_fields.includes("scene_revision_changed"),
    true
  );
  assert.equal(String(outcome.warning || "").length > 0, true);
});

test("transaction ref path invalid exposes contract-guided fix action", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_TRANSACTION_REF_PATH_INVALID",
    message: "transaction alias path is not allowed",
  });

  assert.equal(outcome.error_code, "E_TRANSACTION_REF_PATH_INVALID");
  assert.equal(outcome.suggested_action, "get_write_contract_bundle");
  assert.equal(outcome.suggested_tool, "get_write_contract_bundle");
  assert.equal(
    String(outcome.fix_hint || "").includes("alias.field"),
    true
  );
});
