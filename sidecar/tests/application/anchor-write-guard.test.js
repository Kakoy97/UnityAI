"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  ANCHOR_RETRY_SUGGESTION,
} = require("../../src/application/turnPolicies");

function createService() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
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
  return {
    turnStore,
    service,
  };
}

function markUnityReady(service) {
  service.reportUnityCapabilities({
    event: "unity.capabilities.report",
    request_id: "req_capability_anchor_write_guard",
    thread_id: "t_default",
    turn_id: "turn_capability_anchor_write_guard",
    timestamp: new Date().toISOString(),
    payload: {
      capability_version: "test_anchor_write_guard_v1",
      actions: [
        {
          type: "add_component",
          description: "Add component",
          anchor_policy: "target_required",
          action_data_schema: {
            type: "object",
          },
        },
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
      source: "anchor-write-guard-test",
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

test("apply_visual_actions returns unified anchor suggestion on schema failure and never queues job", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_anchor_1");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        component_assembly_qualified_name:
          "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(outcome.body.suggestion, ANCHOR_RETRY_SUGGESTION);
  assert.equal(outcome.body.recoverable, true);
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("apply_visual_actions enforces capability anchor_policy for known action types", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_anchor_policy_1");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "set_ui_image_color",
        parent_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          r: 1,
          g: 0,
          b: 0,
          a: 1,
        },
      },
    ],
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(outcome.body.suggestion, ANCHOR_RETRY_SUGGESTION);
  assert.equal(outcome.body.recoverable, true);
  assert.equal(
    String(outcome.body.error_message || "").includes("anchor_policy(target_required)"),
    true
  );
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("apply_visual_actions keeps unknown action submit-open when capability policy is missing", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_anchor_policy_2");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    dry_run: true,
    actions: [
      {
        type: "set_rect_transform",
        parent_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          anchored_position: {
            x: 20,
            y: 40,
          },
        },
      },
    ],
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.dry_run, true);
});

test("set_ui_properties dry_run plans mapped actions and never queues Unity job", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_set_ui_properties_1");
  const token = issueReadToken(service);

  const outcome = service.setUiPropertiesForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    operations: [
      {
        target_anchor: {
          object_id: "go_button",
          path: "Scene/Root/Canvas/Button",
        },
        rect_transform: {
          anchored_position: { x: 20, y: -40 },
          size_delta: { x: 240, y: 64 },
        },
        image: {
          color: { r: 1, g: 0.2, b: 0.2, a: 1 },
          raycast_target: true,
        },
        text: {
          content: "Play",
          font_size: 28,
        },
      },
    ],
    dry_run: true,
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.status, "planned");
  assert.equal(outcome.body.dry_run, true);
  assert.equal(outcome.body.planned_actions_count, 6);
  assert.deepEqual(outcome.body.mapped_actions, [
    "set_rect_anchored_position",
    "set_rect_size_delta",
    "set_ui_image_color",
    "set_ui_image_raycast_target",
    "set_ui_text_content",
    "set_ui_text_font_size",
  ]);
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});
