"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTokenPolicyRuntime,
} = require("../../src/application/ssotRuntime/tokenPolicyRuntime");
const {
  createTokenDriftRecoveryCoordinator,
} = require("../../src/application/ssotRuntime/tokenDriftRecoveryCoordinator");

function createTokenPolicyRuntimeForTests() {
  return createTokenPolicyRuntime({
    manifest: {
      version: 1,
      generated_at: "",
      source: {},
      contract: {
        issuance_authority: "l2_sidecar",
        token_families: [
          "read_issues_token",
          "write_requires_token",
          "local_static_no_token",
        ],
        success_continuation: ["read", "write"],
        drift_recovery: {
          enabled: true,
          error_code: "E_SCENE_REVISION_DRIFT",
          max_retry: 1,
          requires_idempotency: true,
          refresh_tool_name: "get_scene_snapshot_for_write",
        },
        redaction_policy: {
          strip_fields: ["read_token", "read_token_candidate"],
        },
        auto_retry_policy: {
          max_retry: 1,
          requires_idempotency_key: true,
          on_retry_failure: "return_both_errors",
        },
        auto_retry_safe_family: ["write_requires_token"],
      },
      tools: [
        {
          name: "modify_ui_layout",
          kind: "write",
          lifecycle: "stable",
          dispatch_mode: "ssot_query",
          token_family: "write_requires_token",
          scene_revision_capable: true,
          auto_retry_safe: true,
          requires_based_on_read_token: true,
          declares_based_on_read_token: true,
        },
        {
          name: "execute_unity_transaction",
          kind: "write",
          lifecycle: "stable",
          dispatch_mode: "ssot_query",
          token_family: "write_requires_token",
          scene_revision_capable: true,
          auto_retry_safe: true,
          requires_based_on_read_token: true,
          declares_based_on_read_token: true,
        },
        {
          name: "get_scene_roots",
          kind: "read",
          lifecycle: "stable",
          dispatch_mode: "ssot_query",
          token_family: "read_issues_token",
          scene_revision_capable: true,
          auto_retry_safe: false,
          requires_based_on_read_token: false,
          declares_based_on_read_token: false,
        },
      ],
    },
  });
}

test("G2-3.6 matrix: key blocking reasons are deterministic", () => {
  const coordinator = createTokenDriftRecoveryCoordinator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    shadowModeEnabled: true,
    totalRecoveryTimeoutMs: 8000,
    maxGlobalRecoveryTasks: 10,
    maxSessionRecoveryTasks: 1,
    maxToolRecoveryTasks: 1,
    maxRecoveryQueueSize: 10,
  });

  const scenarios = [
    {
      id: "recoverable_ok",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_ok_1" },
      },
      recoverable: true,
      blocked_reason: "",
    },
    {
      id: "missing_idempotency",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: {},
      },
      recoverable: false,
      blocked_reason: "idempotency_key_missing",
    },
    {
      id: "not_drift",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_TARGET_NOT_FOUND",
        payload: { idempotency_key: "idem_matrix_not_drift_1" },
      },
      recoverable: false,
      blocked_reason: "error_code_not_drift",
    },
    {
      id: "global_limit",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_global_1" },
        global_recovery_inflight: 10,
      },
      recoverable: false,
      blocked_reason: "global_limit",
    },
    {
      id: "session_busy",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_session_1" },
        session_recovery_inflight: 1,
      },
      recoverable: false,
      blocked_reason: "session_busy",
    },
    {
      id: "tool_busy",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_tool_1" },
        tool_recovery_inflight: 1,
      },
      recoverable: false,
      blocked_reason: "tool_busy",
    },
    {
      id: "queue_limit",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_queue_1" },
        recovery_queue_size: 10,
      },
      recoverable: false,
      blocked_reason: "queue_limit",
    },
    {
      id: "timeout",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_timeout_1" },
        recovery_elapsed_ms: 9001,
      },
      recoverable: false,
      blocked_reason: "recovery_timeout",
    },
    {
      id: "idempotency_conflict",
      input: {
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_conflict_1" },
        idempotency_conflict: true,
      },
      recoverable: false,
      blocked_reason: "idempotency_conflict",
    },
    {
      id: "unsafe_family",
      input: {
        tool_name: "get_scene_roots",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: "idem_matrix_read_1" },
      },
      recoverable: false,
      blocked_reason: "tool_family_not_safe",
    },
  ];

  for (const scenario of scenarios) {
    const decision = coordinator.evaluateShadowDecision(scenario.input);
    assert.equal(
      decision.recoverable,
      scenario.recoverable,
      `recoverable mismatch: ${scenario.id}`
    );
    assert.equal(
      decision.blocked_reason,
      scenario.blocked_reason,
      `blocked_reason mismatch: ${scenario.id}`
    );
  }
});

test("G2-3.6 matrix: blocking reason priority is global > session > tool > queue", () => {
  const coordinator = createTokenDriftRecoveryCoordinator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    shadowModeEnabled: true,
    maxGlobalRecoveryTasks: 10,
    maxSessionRecoveryTasks: 1,
    maxToolRecoveryTasks: 1,
    maxRecoveryQueueSize: 10,
  });

  const decision = coordinator.evaluateShadowDecision({
    tool_name: "modify_ui_layout",
    error_code: "E_SCENE_REVISION_DRIFT",
    payload: { idempotency_key: "idem_matrix_priority_1" },
    global_recovery_inflight: 10,
    session_recovery_inflight: 1,
    tool_recovery_inflight: 1,
    recovery_queue_size: 10,
  });
  assert.equal(decision.recoverable, false);
  assert.equal(decision.blocked_reason, "global_limit");
});

test("G2-3.6 matrix: pressure run keeps counters and rates coherent", () => {
  const coordinator = createTokenDriftRecoveryCoordinator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    shadowModeEnabled: true,
  });
  const total = 600;
  for (let i = 0; i < total; i += 1) {
    const mod = i % 6;
    if (mod === 0) {
      coordinator.evaluateShadowDecision({
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        stage: "before_write_validation",
        payload: { idempotency_key: `idem_pressure_${i}` },
      });
      continue;
    }
    if (mod === 1) {
      coordinator.evaluateShadowDecision({
        tool_name: "modify_ui_layout",
        error_code: "E_SCENE_REVISION_DRIFT",
        stage: "during_dispatch",
        payload: {},
      });
      continue;
    }
    if (mod === 2) {
      coordinator.evaluateShadowDecision({
        tool_name: "execute_unity_transaction",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: `idem_txn_${i}` },
        recovery_queue_size: 10,
      });
      continue;
    }
    if (mod === 3) {
      coordinator.evaluateShadowDecision({
        tool_name: "modify_ui_layout",
        error_code: "E_TARGET_NOT_FOUND",
        payload: { idempotency_key: `idem_not_drift_${i}` },
      });
      continue;
    }
    if (mod === 4) {
      coordinator.evaluateShadowDecision({
        tool_name: "get_scene_roots",
        error_code: "E_SCENE_REVISION_DRIFT",
        payload: { idempotency_key: `idem_read_${i}` },
      });
      continue;
    }
    coordinator.evaluateShadowDecision({
      tool_name: "modify_ui_layout",
      error_code: "E_SCENE_REVISION_DRIFT",
      payload: { idempotency_key: `idem_timeout_${i}` },
      recovery_elapsed_ms: 9000,
    });
  }

  const snapshot = coordinator.getShadowMetricsSnapshot();
  assert.equal(snapshot.totals.events_total, total);
  assert.equal(snapshot.totals.blocked_total > 0, true);
  assert.equal(snapshot.rates.trigger_rate > 0, true);
  assert.equal(snapshot.rates.recoverable_rate >= 0, true);
  assert.equal(Array.isArray(snapshot.by_tool), true);
  assert.equal(snapshot.by_tool.length >= 2, true);
  assert.equal(
    snapshot.blocked_by_reason.idempotency_key_missing > 0,
    true
  );
  assert.equal(snapshot.blocked_by_reason.queue_limit > 0, true);
  assert.equal(snapshot.blocked_by_reason.recovery_timeout > 0, true);
});

test("G2-3.6 matrix: request fingerprint remains deterministic for same payload", () => {
  const coordinator = createTokenDriftRecoveryCoordinator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    shadowModeEnabled: true,
  });
  const input = {
    tool_name: "modify_ui_layout",
    error_code: "E_SCENE_REVISION_DRIFT",
    payload: {
      idempotency_key: "idem_fingerprint_1",
      width: 100,
      height: 200,
    },
    request_id: "req_fp_1",
    thread_id: "thread_fp_1",
    turn_id: "turn_fp_1",
  };
  const a = coordinator.evaluateShadowDecision(input);
  const b = coordinator.evaluateShadowDecision(input);
  assert.equal(a.request_fingerprint, b.request_fingerprint);
  assert.equal(a.request_fingerprint.startsWith("shadow_"), true);
});

