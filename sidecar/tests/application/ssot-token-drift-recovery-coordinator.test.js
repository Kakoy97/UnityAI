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
          strip_fields: [
            "read_token",
            "read_token_candidate",
            "read_token_candidate_legacy",
          ],
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

test("token drift recovery coordinator marks recoverable drift in shadow mode", () => {
  const coordinator = createTokenDriftRecoveryCoordinator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    shadowModeEnabled: true,
    nowIso: () => "2026-03-08T12:00:00.000Z",
  });

  const decision = coordinator.evaluateShadowDecision({
    tool_name: "modify_ui_layout",
    error_code: "E_SCENE_REVISION_DRIFT",
    stage: "before_write_validation",
    payload: {
      idempotency_key: "idem_shadow_1",
      based_on_read_token: "ssot_rt_demo",
    },
    request_id: "req_shadow_1",
    thread_id: "thread_shadow_1",
    turn_id: "turn_shadow_1",
  });

  assert.equal(decision.mode, "shadow");
  assert.equal(decision.recoverable, true);
  assert.equal(decision.blocked_reason, "");
  assert.equal(decision.shadow_only, true);
  assert.equal(decision.idempotency_key_present, true);
  assert.equal(typeof decision.request_fingerprint, "string");
  assert.equal(decision.request_fingerprint.startsWith("shadow_"), true);

  const snapshot = coordinator.getShadowMetricsSnapshot();
  assert.equal(snapshot.totals.events_total, 1);
  assert.equal(snapshot.totals.drift_error_total, 1);
  assert.equal(snapshot.totals.recoverable_total, 1);
  assert.equal(snapshot.totals.blocked_total, 0);
  assert.equal(snapshot.rates.trigger_rate, 1);
  assert.equal(snapshot.rates.recoverable_rate, 1);
});

test("token drift recovery coordinator records blocked reasons distribution", () => {
  const coordinator = createTokenDriftRecoveryCoordinator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    shadowModeEnabled: true,
    nowIso: () => "2026-03-08T12:00:00.000Z",
  });

  const noIdempotency = coordinator.evaluateShadowDecision({
    tool_name: "modify_ui_layout",
    error_code: "E_SCENE_REVISION_DRIFT",
    stage: "before_write_validation",
    payload: {
      based_on_read_token: "ssot_rt_demo",
    },
  });
  assert.equal(noIdempotency.recoverable, false);
  assert.equal(noIdempotency.blocked_reason, "idempotency_key_missing");

  const notSafeFamily = coordinator.evaluateShadowDecision({
    tool_name: "get_scene_roots",
    error_code: "E_SCENE_REVISION_DRIFT",
    stage: "during_dispatch",
    payload: {
      idempotency_key: "idem_shadow_read_1",
    },
  });
  assert.equal(notSafeFamily.recoverable, false);
  assert.equal(notSafeFamily.blocked_reason, "tool_family_not_safe");

  const notDrift = coordinator.evaluateShadowDecision({
    tool_name: "modify_ui_layout",
    error_code: "E_TARGET_NOT_FOUND",
    stage: "during_dispatch",
    payload: {
      idempotency_key: "idem_shadow_2",
    },
  });
  assert.equal(notDrift.recoverable, false);
  assert.equal(notDrift.blocked_reason, "error_code_not_drift");

  const snapshot = coordinator.getShadowMetricsSnapshot();
  assert.equal(snapshot.totals.events_total, 3);
  assert.equal(snapshot.totals.drift_error_total, 2);
  assert.equal(snapshot.totals.recoverable_total, 0);
  assert.equal(snapshot.totals.blocked_total, 3);
  assert.equal(snapshot.blocked_by_reason.idempotency_key_missing, 1);
  assert.equal(snapshot.blocked_by_reason.tool_family_not_safe, 1);
  assert.equal(snapshot.blocked_by_reason.error_code_not_drift, 1);
  assert.equal(snapshot.rates.recoverable_rate, 0);
});

