"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { UnityDispatcher } = require("../../src/application/unityDispatcher/unityDispatcher");

function buildJob() {
  const action = {
    type: "add_component",
    target_object_path: "Scene/Root",
    target_object_id: "go_root",
    component_assembly_qualified_name:
      "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
  };
  return {
    request_id: "req_dispatcher_reboot_wait",
    thread_id: "thread_dispatcher_reboot_wait",
    turn_id: "turn_dispatcher_reboot_wait",
    approval_mode: "auto",
    based_on_read_token: "tok_dispatcher_reboot_wait_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    runtime: {
      file_actions: [],
      visual_actions: [action],
      file_actions_applied: true,
      files_changed: [],
      next_visual_index: 0,
      phase: "accepted",
      compile_success: true,
      last_compile_request: null,
      last_action_request: null,
      last_compile_result: null,
      last_action_result: null,
      last_action_error: null,
      reboot_wait_started_at: 0,
    },
    task_allocation: {
      file_actions: [],
      visual_layer_actions: [action],
    },
  };
}

test("dispatcher stamps reboot_wait_started_at and clears it on runtime recovery", () => {
  const dispatcher = new UnityDispatcher({
    nowIso: () => "2026-02-26T08:00:00.000Z",
  });
  const job = buildJob();
  const started = dispatcher.start(job);
  assert.equal(started.kind, "waiting_action");

  const jobInAction = {
    ...job,
    runtime: started.runtime,
  };
  const suspendedAt = "2026-02-26T08:00:05.000Z";
  const suspended = dispatcher.handleActionResult(jobInAction, {
    event: "unity.action.result",
    request_id: job.request_id,
    thread_id: job.thread_id,
    turn_id: job.turn_id,
    timestamp: suspendedAt,
    payload: {
      action_type: "add_component",
      target_object_path: "Scene/Root",
      target_object_id: "go_root",
      component_assembly_qualified_name:
        "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      success: false,
      error_code: "WAITING_FOR_UNITY_REBOOT",
      error_message: "Domain reload in progress",
      duration_ms: 12,
    },
  });
  assert.equal(suspended.kind, "suspended");
  assert.equal(suspended.runtime.phase, "waiting_for_unity_reboot");
  assert.equal(suspended.runtime.reboot_wait_started_at, Date.parse(suspendedAt));

  const recovered = dispatcher.handleRuntimePing({
    ...jobInAction,
    runtime: suspended.runtime,
  });
  assert.equal(recovered.kind, "waiting_action");
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.runtime.phase, "action_pending");
  assert.equal(recovered.runtime.reboot_wait_started_at, 0);
});
