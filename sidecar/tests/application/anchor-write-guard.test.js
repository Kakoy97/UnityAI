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

test("R20-UX-GOV-05 apply_visual_actions failure carries request_id/field_path/anchor_snapshot", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_gov05_failure_observability_1");
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
  assert.equal(typeof outcome.body.request_id, "string");
  assert.equal(outcome.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(
    String(outcome.body.field_path || "").startsWith("actions[0].target_anchor"),
    true
  );
  assert.ok(outcome.body.anchor_snapshot);
  assert.equal(outcome.body.anchor_snapshot.write_anchor.object_id, "go_root");
  assert.equal(outcome.body.anchor_snapshot.write_anchor.path, "Scene/Root");
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
  assert.equal(outcome.body.error_message, "actions[0].target_anchor is required");
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

test("apply_visual_actions forwards set_serialized_property dry_run into Unity dispatch path", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_set_serialized_property_dryrun_1");
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
        type: "set_serialized_property",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        action_data: {
          dry_run: true,
          component_selector: {
            component_assembly_qualified_name:
              "UnityEngine.Transform, UnityEngine.CoreModule",
            component_index: 0,
          },
          patches: [
            {
              property_path: "m_LocalPosition",
              value_kind: "vector3",
              vector3_value: {
                x: 1,
                y: 2,
                z: 3,
              },
            },
          ],
        },
      },
    ],
  });

  assert.equal(outcome.statusCode, 202);
  assert.equal(typeof outcome.body.job_id, "string");
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 1);
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

test("R20-UX-C-02 apply_visual_actions dry_run rejects missing target_anchor object_id/path", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_c02_1");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_panel",
      path: "Scene/Canvas/Panel",
    },
    actions: [
      {
        type: "rename_object",
        target_anchor: {},
        action_data: {
          name: "Panel_Renamed",
        },
      },
    ],
    dry_run: true,
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.status, "rejected");
  assert.equal(outcome.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(
    outcome.body.error_message,
    "actions[0].target_anchor.object_id is required"
  );
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R20-UX-C-02 apply_visual_actions dry_run rejects missing parent_anchor object_id/path for create action", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_c02_create_1");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    actions: [
      {
        type: "create_gameobject",
        parent_anchor: {},
        action_data: {
          name: "StartButton",
          ui_type: "Button",
        },
      },
    ],
    dry_run: true,
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.status, "rejected");
  assert.equal(outcome.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(
    outcome.body.error_message,
    "actions[0].parent_anchor.object_id is required"
  );
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R20-UX-GOV-02 apply_visual_actions dry_run keeps create_object alias parity for missing parent_anchor rejection", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_gov02_create_alias_1");
  const token = issueReadToken(service);

  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    actions: [
      {
        type: "create_object",
        parent_anchor: {},
        action_data: {
          name: "StartButton",
          ui_type: "Button",
        },
      },
    ],
    dry_run: true,
  });

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.status, "rejected");
  assert.equal(outcome.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(
    outcome.body.error_message,
    "actions[0].parent_anchor.object_id is required"
  );
});

test("R20-UX-C-01 preflight_validate_write_payload reports blocking error for invalid target_anchor", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_c01_1");
  const token = issueReadToken(service);

  const outcome = service.preflightValidateWritePayloadForMcp({
    tool_name: "apply_visual_actions",
    payload: {
      based_on_read_token: token,
      write_anchor: {
        object_id: "go_panel",
        path: "Scene/Canvas/Panel",
      },
      actions: [
        {
          type: "rename_object",
          target_anchor: {},
          action_data: {
            name: "Panel_Renamed",
          },
        },
      ],
      dry_run: true,
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.preflight.valid, false);
  assert.equal(outcome.body.preflight.normalization_applied, false);
  assert.equal(
    outcome.body.preflight.blocking_errors[0].error_code,
    "E_ACTION_SCHEMA_INVALID"
  );
  assert.equal(
    outcome.body.preflight.blocking_errors[0].field_path,
    "actions[0].target_anchor.object_id"
  );
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R20-UX-C-01 preflight_validate_write_payload rejects create payload with invalid parent_anchor", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_c01_create_1");
  const token = issueReadToken(service);

  const outcome = service.preflightValidateWritePayloadForMcp({
    tool_name: "apply_visual_actions",
    payload: {
      based_on_read_token: token,
      write_anchor: {
        object_id: "go_canvas",
        path: "Scene/Canvas",
      },
      actions: [
        {
          type: "create_gameobject",
          parent_anchor: {},
          action_data: {
            name: "StartButton",
            ui_type: "Button",
          },
        },
      ],
      dry_run: true,
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.preflight.valid, false);
  assert.equal(outcome.body.preflight.normalization_applied, false);
  assert.equal(
    outcome.body.preflight.blocking_errors[0].error_code,
    "E_ACTION_SCHEMA_INVALID"
  );
  assert.equal(
    outcome.body.preflight.blocking_errors[0].field_path,
    "actions[0].parent_anchor.object_id"
  );
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R20-UX-GOV-11 preflight_validate_write_payload fail-fast when catalog_version mismatches capability_version", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_gov11_preflight_1");
  const token = issueReadToken(service);

  const outcome = service.preflightValidateWritePayloadForMcp({
    tool_name: "apply_visual_actions",
    payload: {
      based_on_read_token: token,
      catalog_version: "test_anchor_write_guard_v0",
      write_anchor: {
        object_id: "go_panel",
        path: "Scene/Canvas/Panel",
      },
      actions: [
        {
          type: "rename_object",
          target_anchor: {
            object_id: "go_panel",
            path: "Scene/Canvas/Panel",
          },
          action_data: {
            name: "Panel_Renamed",
          },
        },
      ],
      dry_run: true,
    },
  });

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.preflight.valid, false);
  assert.equal(
    outcome.body.preflight.blocking_errors[0].error_code,
    "E_CONTRACT_VERSION_MISMATCH"
  );
  assert.equal(
    outcome.body.preflight.blocking_errors[0].message.includes(
      "catalog_version does not match current capability_version"
    ),
    true
  );
  assert.equal(service.mcpGateway.jobStore.listJobs().length, 0);
  assert.equal(service.mcpGateway.jobQueue.size(), 0);
});

test("R20-UX-D-01 duplicate retry fuse blocks repeated same-payload failures in same thread", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_d01_1");
  const token = issueReadToken(service);
  const payload = {
    thread_id: "t_retry_fuse",
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
  };

  const first = service.applyVisualActionsForMcp(payload);
  const second = service.applyVisualActionsForMcp(payload);
  const third = service.applyVisualActionsForMcp(payload);

  assert.equal(first.statusCode, 400);
  assert.equal(first.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(second.statusCode, 400);
  assert.equal(second.body.error_code, "E_ACTION_SCHEMA_INVALID");
  assert.equal(third.statusCode, 429);
  assert.equal(third.body.error_code, "E_DUPLICATE_RETRY_BLOCKED");
  assert.equal(
    third.body.retry_fuse && third.body.retry_fuse.scope,
    "per_thread"
  );
  assert.equal(
    third.body.retry_fuse && third.body.retry_fuse.thread_id,
    "t_retry_fuse"
  );
});

test("R20-UX-D-01 duplicate retry fuse does not block identical payload across different thread_id", () => {
  const { service } = createService();
  markUnityReady(service);
  seedSelectionSnapshot(service, "scene_rev_r20_ux_d01_2");
  const token = issueReadToken(service);
  const basePayload = {
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
  };

  service.applyVisualActionsForMcp({
    ...basePayload,
    thread_id: "t_retry_fuse_a",
  });
  service.applyVisualActionsForMcp({
    ...basePayload,
    thread_id: "t_retry_fuse_a",
  });
  const crossThread = service.applyVisualActionsForMcp({
    ...basePayload,
    thread_id: "t_retry_fuse_b",
  });

  assert.equal(crossThread.statusCode, 400);
  assert.equal(crossThread.body.error_code, "E_ACTION_SCHEMA_INVALID");
});
