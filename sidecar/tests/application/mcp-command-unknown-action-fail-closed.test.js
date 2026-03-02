"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");

function createService() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => new Date().toISOString(),
    enableMcpAdapter: true,
    enableMcpEyes: true,
    fileActionExecutor: {
      execute(actions) {
        return {
          ok: true,
          changes: Array.isArray(actions) ? actions : [],
        };
      },
    },
  });
}

function markUnityReady(service) {
  service.reportUnityCapabilities({
    event: "unity.capabilities.report",
    request_id: "req_capability_unknown_action_fail_closed",
    thread_id: "t_default",
    turn_id: "turn_capability_unknown_action_fail_closed",
    timestamp: new Date().toISOString(),
    payload: {
      capability_version: "test_unknown_action_fail_closed_v1",
      actions: [
        {
          type: "set_ui_image_color",
          description: "Set image color",
          anchor_policy: "target_required",
          action_data_schema: {
            type: "object",
          },
        },
      ],
    },
  });
}

function seedSelectionSnapshot(service, sceneRevision) {
  service.recordLatestSelectionContext(
    {
      scene_revision: sceneRevision,
      selection: {
        mode: "selection",
        object_id: "go_root",
        target_object_path: "Scene/Root",
      },
      selection_tree: {
        max_depth: 2,
        truncated_node_count: 0,
        truncated_reason: "",
        root: {
          name: "Root",
          object_id: "go_root",
          path: "Scene/Root",
          depth: 0,
          active: true,
          prefab_path: "",
          components: [
            {
              short_name: "Transform",
              assembly_qualified_name:
                "UnityEngine.Transform, UnityEngine.CoreModule",
            },
          ],
          children: [],
          children_truncated_count: 0,
        },
      },
    },
    {
      source: "unknown-action-fail-closed-test",
      requestId: "req_seed",
      threadId: "thread_seed",
      turnId: "turn_seed",
    }
  );
}

function issueReadToken(service) {
  const outcome = service.getCurrentSelectionForMcp();
  assert.equal(outcome.statusCode, 200);
  assert.ok(outcome.body && outcome.body.read_token);
  return outcome.body.read_token.token;
}

test("unknown action stays submit-open but fails closed with E_ACTION_HANDLER_NOT_FOUND when Unity handler is missing", () => {
  const service = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_unknown_action_fail_closed");
  const token = issueReadToken(service);

  const submit = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "set_rect_transform",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          anchored_position: { x: 12, y: 24 },
          size_delta: { x: 320, y: 80 },
        },
      },
    ],
  });

  assert.equal(submit.statusCode, 202);
  assert.ok(typeof submit.body.job_id === "string" && submit.body.job_id.length > 0);
  const jobId = submit.body.job_id;

  const pending = service.getUnityTaskStatus(jobId);
  assert.equal(pending.statusCode, 200);
  assert.ok(typeof pending.body.request_id === "string" && pending.body.request_id.length > 0);

  const failed = service.reportUnityActionResult({
    event: "unity.action.result",
    request_id: pending.body.request_id,
    thread_id: "t_default",
    turn_id: "turn_unknown_action_fail_closed",
    timestamp: new Date().toISOString(),
    payload: {
      action_type: "set_rect_transform",
      success: false,
      error_message: "No handler registered for action_type set_rect_transform",
    },
  });

  assert.equal(failed.statusCode, 500);
  assert.equal(failed.body.error_code, "E_ACTION_HANDLER_NOT_FOUND");
  assert.equal(failed.body.recoverable, true);

  const terminal = service.getUnityTaskStatus(jobId);
  assert.equal(terminal.statusCode, 200);
  assert.equal(terminal.body.status, "failed");
  assert.equal(terminal.body.error_code, "E_ACTION_HANDLER_NOT_FOUND");
  assert.equal(terminal.body.recoverable, true);
});

