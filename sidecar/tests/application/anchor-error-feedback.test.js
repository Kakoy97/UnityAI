"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  withMcpErrorFeedback,
  getMcpErrorFeedbackMetricsSnapshot,
  resetMcpErrorFeedbackMetrics,
} = require("../../src/application/mcpGateway/mcpErrorFeedback");
const {
  ANCHOR_RETRY_SUGGESTION,
  OCC_STALE_SNAPSHOT_SUGGESTION,
} = require("../../src/application/turnPolicies");

test.beforeEach(() => {
  resetMcpErrorFeedbackMetrics();
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

test("E_STALE_SNAPSHOT suggestion is fixed and exact", () => {
  const outcome = withMcpErrorFeedback({
    error_code: "E_STALE_SNAPSHOT",
    message: "token outdated",
    suggestion: "custom stale suggestion should be ignored",
  });

  assert.equal(outcome.error_code, "E_STALE_SNAPSHOT");
  assert.equal(outcome.suggestion, OCC_STALE_SNAPSHOT_SUGGESTION);
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
