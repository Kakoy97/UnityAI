"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dispatchSsotRequest,
} = require("../../src/application/ssotRuntime/dispatchSsotRequest");

function createShadowRecorder() {
  const calls = [];
  return {
    calls,
    coordinator: {
      evaluateShadowDecision(input) {
        calls.push(input);
        return {
          mode: "shadow",
          recoverable: false,
        };
      },
    },
  };
}

test("dispatchSsotRequest records shadow decision when pre-dispatch drift validation fails", async () => {
  const recorder = createShadowRecorder();
  const orchestrator = {
    validateBeforeDispatch() {
      return {
        ok: false,
        error_code: "E_SCENE_REVISION_DRIFT",
        message: "Token scene_revision does not match current scene revision.",
      };
    },
    finalizeDispatchResult() {
      throw new Error("finalizeDispatchResult should not run when validation fails");
    },
  };

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: async () => ({
      ok: true,
      data: {},
    }),
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: recorder.coordinator,
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: "ssot_rt_stale",
      idempotency_key: "idem_shadow_pre_1",
    },
    requestId: "req_shadow_pre_1",
    threadId: "thread_shadow_pre_1",
    turnId: "turn_shadow_pre_1",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].tool_name, "modify_ui_layout");
  assert.equal(recorder.calls[0].error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(recorder.calls[0].stage, "before_write_validation");
});

test("dispatchSsotRequest records shadow decision when unity dispatch returns drift error", async () => {
  const recorder = createShadowRecorder();
  const orchestrator = {
    validateBeforeDispatch() {
      return { ok: true };
    },
    finalizeDispatchResult(input = {}) {
      return input.result;
    },
  };

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: async () => ({
      ok: false,
      error_code: "E_SCENE_REVISION_DRIFT",
      error_message: "scene revision drift",
    }),
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: recorder.coordinator,
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: "ssot_rt_stale_2",
      idempotency_key: "idem_shadow_post_1",
    },
    requestId: "req_shadow_post_1",
    threadId: "thread_shadow_post_1",
    turnId: "turn_shadow_post_1",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].tool_name, "modify_ui_layout");
  assert.equal(recorder.calls[0].error_code, "E_SCENE_REVISION_DRIFT");
  assert.equal(recorder.calls[0].stage, "during_dispatch");
});

test("dispatchSsotRequest does not record shadow decision for successful dispatch", async () => {
  const recorder = createShadowRecorder();
  const orchestrator = {
    validateBeforeDispatch() {
      return { ok: true };
    },
    finalizeDispatchResult(input = {}) {
      return input.result;
    },
  };

  const result = await dispatchSsotRequest({
    enqueueAndWaitForUnityQuery: async () => ({
      ok: true,
      data: {
        scene_revision: "ssot_rev_ok_shadow",
      },
    }),
    tokenLifecycleOrchestrator: orchestrator,
    tokenDriftRecoveryCoordinator: recorder.coordinator,
    toolName: "get_scene_roots",
    payload: {},
    requestId: "req_shadow_ok_1",
  });

  assert.equal(result.ok, true);
  assert.equal(recorder.calls.length, 0);
});

