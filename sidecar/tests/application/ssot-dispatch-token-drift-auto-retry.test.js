"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dispatchSsotRequest,
} = require("../../src/application/ssotRuntime/dispatchSsotRequest");
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
          name: "get_scene_snapshot_for_write",
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

function createCoordinator(autoRetryEnabled) {
  return createTokenDriftRecoveryCoordinator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    shadowModeEnabled: true,
    autoRetryEnabled,
    nowIso: () => "2026-03-08T18:00:00.000Z",
  });
}

function createOrchestrator(options = {}) {
  const staleToken = options.staleToken || "ssot_rt_stale";
  const refreshToken = options.refreshToken || "ssot_rt_refreshed";
  return {
    validateBeforeDispatch(input = {}) {
      const payload =
        input.payload && typeof input.payload === "object" ? input.payload : {};
      if (
        input.toolName === "modify_ui_layout" &&
        payload.based_on_read_token === staleToken
      ) {
        return {
          ok: false,
          error_code: "E_SCENE_REVISION_DRIFT",
          message: "token drift",
          context: {
            stage: "before_write",
            scene_revision_changed: true,
          },
        };
      }
      return { ok: true };
    },
    finalizeDispatchResult(input = {}) {
      if (input.toolName === "get_scene_snapshot_for_write") {
        return {
          ok: true,
          data: {
            scene_revision: "ssot_rev_after_refresh",
            read_token_candidate: refreshToken,
          },
        };
      }
      return input.result;
    },
  };
}

function createEnqueueStub(sequence) {
  const calls = [];
  return {
    calls,
    enqueueAndWaitForUnityQuery: async (input = {}) => {
      calls.push(input);
      const queryPayload =
        input.payload && typeof input.payload === "object" ? input.payload : {};
      const index = calls.length - 1;
      const planned =
        Array.isArray(sequence) && sequence[index] ? sequence[index] : null;
      if (!planned) {
        throw new Error(`no planned response for call #${index + 1}`);
      }
      if (
        planned.expected_tool &&
        queryPayload.tool_name !== planned.expected_tool
      ) {
        throw new Error(
          `expected tool ${planned.expected_tool}, got ${queryPayload.tool_name}`
        );
      }
      return planned.result;
    },
  };
}

test("dispatch auto-retries drift once and succeeds with refreshed token", async () => {
  const coordinator = createCoordinator(true);
  const orchestrator = createOrchestrator({
    staleToken: "ssot_rt_stale",
    refreshToken: "ssot_rt_new_after_refresh",
  });
  const enqueue = createEnqueueStub([
    {
      expected_tool: "get_scene_snapshot_for_write",
      result: { ok: true, data: { scene_revision: "ssot_rev_refresh_1" } },
    },
    {
      expected_tool: "modify_ui_layout",
      result: { ok: true, data: { scene_revision: "ssot_rev_write_2" } },
    },
  ]);

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: enqueue.enqueueAndWaitForUnityQuery,
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: coordinator,
    tokenAutoRetryEnabled: true,
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: "ssot_rt_stale",
      idempotency_key: "idem_auto_retry_ok_1",
      target_object_id: "go_1",
      target_path: "Scene/Canvas/A",
      anchored_x: 0,
      anchored_y: 0,
      width: 100,
      height: 40,
    },
    requestId: "req_auto_retry_ok_1",
    threadId: "thread_auto_retry_ok_1",
    turnId: "turn_auto_retry_ok_1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.auto_retry_attempted, true);
  assert.equal(result.auto_retry_succeeded, true);
  assert.equal(result.recovery_source, "scene_snapshot_refresh");
  assert.equal(enqueue.calls.length, 2);
  const replayPayload = JSON.parse(enqueue.calls[1].payload.payload_json);
  assert.equal(
    replayPayload.based_on_read_token,
    "ssot_rt_new_after_refresh",
    "replay must use refreshed token"
  );
});

test("dispatch auto-retry failure returns initial + retry dual error context", async () => {
  const coordinator = createCoordinator(true);
  const orchestrator = createOrchestrator({
    staleToken: "ssot_rt_stale_2",
    refreshToken: "ssot_rt_new_after_refresh_2",
  });
  const enqueue = createEnqueueStub([
    {
      expected_tool: "get_scene_snapshot_for_write",
      result: { ok: true, data: { scene_revision: "ssot_rev_refresh_2" } },
    },
    {
      expected_tool: "modify_ui_layout",
      result: {
        ok: false,
        error_code: "E_TARGET_NOT_FOUND",
        error_message: "target missing",
      },
    },
  ]);

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: enqueue.enqueueAndWaitForUnityQuery,
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: coordinator,
    tokenAutoRetryEnabled: true,
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: "ssot_rt_stale_2",
      idempotency_key: "idem_auto_retry_fail_1",
      target_object_id: "go_2",
      target_path: "Scene/Canvas/B",
      anchored_x: 10,
      anchored_y: 10,
      width: 120,
      height: 44,
    },
    requestId: "req_auto_retry_fail_1",
  });

  assert.equal(result.ok, false);
  assert.equal(result.auto_retry_attempted, true);
  assert.equal(result.auto_retry_succeeded, false);
  assert.equal(result.initial_error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(result.retry_error_code, "E_TARGET_NOT_FOUND");
});

test("dispatch auto-retry never loops when replay still drifts", async () => {
  const coordinator = createCoordinator(true);
  const orchestrator = createOrchestrator({
    staleToken: "ssot_rt_stale_3",
    refreshToken: "ssot_rt_new_after_refresh_3",
  });
  const enqueue = createEnqueueStub([
    {
      expected_tool: "get_scene_snapshot_for_write",
      result: { ok: true, data: { scene_revision: "ssot_rev_refresh_3" } },
    },
    {
      expected_tool: "modify_ui_layout",
      result: {
        ok: false,
        error_code: "E_SCENE_REVISION_DRIFT",
        error_message: "still drift",
      },
    },
  ]);

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: enqueue.enqueueAndWaitForUnityQuery,
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: coordinator,
    tokenAutoRetryEnabled: true,
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: "ssot_rt_stale_3",
      idempotency_key: "idem_auto_retry_fail_2",
      target_object_id: "go_3",
      target_path: "Scene/Canvas/C",
      anchored_x: 20,
      anchored_y: 20,
      width: 130,
      height: 46,
    },
    requestId: "req_auto_retry_fail_2",
  });

  assert.equal(result.ok, false);
  assert.equal(result.auto_retry_attempted, true);
  assert.equal(result.auto_retry_succeeded, false);
  assert.equal(result.retry_error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(enqueue.calls.length, 2, "must only refresh + replay once");
});

test("dispatch blocks in-flight transaction nested drift from auto-replay", async () => {
  const coordinator = createCoordinator(true);
  const orchestrator = {
    validateBeforeDispatch() {
      return { ok: true };
    },
    finalizeDispatchResult(input = {}) {
      return input.result;
    },
  };
  const enqueue = createEnqueueStub([
    {
      expected_tool: "execute_unity_transaction",
      result: {
        ok: false,
        error_code: "E_TRANSACTION_STEP_FAILED",
        error_message: "transaction step failed",
        data: {
          nested_error_code: "E_SCENE_REVISION_DRIFT",
          failed_step_id: "step_5",
        },
      },
    },
  ]);

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: enqueue.enqueueAndWaitForUnityQuery,
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: coordinator,
    tokenAutoRetryEnabled: true,
    toolName: "execute_unity_transaction",
    payload: {
      based_on_read_token: "ssot_rt_current",
      idempotency_key: "idem_txn_no_replay_1",
      transaction_id: "txn_1",
      steps: [],
    },
    requestId: "req_txn_no_replay_1",
  });

  assert.equal(result.ok, false);
  assert.equal(result.auto_retry_attempted, false);
  assert.equal(result.auto_recovery_blocked_reason, "inflight_transaction_failure");
  assert.equal(enqueue.calls.length, 1);
});

test("dispatch reports auto_retry_disabled when execution flag is off", async () => {
  const coordinator = createCoordinator(false);
  const orchestrator = createOrchestrator({
    staleToken: "ssot_rt_stale_4",
    refreshToken: "ssot_rt_new_after_refresh_4",
  });
  const enqueue = createEnqueueStub([]);

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: enqueue.enqueueAndWaitForUnityQuery,
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: coordinator,
    tokenAutoRetryEnabled: false,
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: "ssot_rt_stale_4",
      idempotency_key: "idem_auto_retry_disabled_1",
      target_object_id: "go_4",
      target_path: "Scene/Canvas/D",
      anchored_x: 0,
      anchored_y: 0,
      width: 80,
      height: 30,
    },
    requestId: "req_auto_retry_disabled_1",
  });

  assert.equal(result.ok, false);
  assert.equal(result.auto_retry_attempted, false);
  assert.equal(result.auto_recovery_blocked_reason, "auto_retry_disabled");
  assert.equal(enqueue.calls.length, 0);
});
