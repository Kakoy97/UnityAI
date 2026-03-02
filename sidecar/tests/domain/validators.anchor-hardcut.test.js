"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateMcpSubmitUnityTask,
  validateMcpApplyVisualActions,
} = require("../../src/domain/validators");

const VALID_TOKEN = "tok_anchor_123456789012345678901234";

function buildValidSubmitBody(extra) {
  return {
    thread_id: "thread_anchor",
    idempotency_key: "idem_anchor_submit",
    user_intent: "anchor hardcut test",
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    file_actions: [
      {
        type: "delete_file",
        path: "Assets/Scripts/AIGenerated/T.cs",
      },
    ],
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}

function buildValidApplyVisualBody(extra) {
  return {
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        component_assembly_qualified_name:
          "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}

test("submit_unity_task rejects legacy task_allocation field", () => {
  const result = validateMcpSubmitUnityTask(
    buildValidSubmitBody({
      task_allocation: {
        reasoning_and_plan: "legacy",
      },
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(result.message, "body has unexpected field: task_allocation");
  assert.equal(result.statusCode, 400);
});

test("submit_unity_task accepts unknown visual action type with valid anchor + action_data", () => {
  const result = validateMcpSubmitUnityTask(
    buildValidSubmitBody({
      file_actions: undefined,
      visual_layer_actions: [
        {
          type: "set_rect_transform",
          target_anchor: {
            object_id: "go_panel",
            path: "Scene/Canvas/Panel",
          },
          action_data: {
            anchored_position: { x: 0, y: 16 },
            size_delta: { x: 320, y: 80 },
          },
        },
      ],
    })
  );

  assert.equal(result.ok, true);
});

test("apply_visual_actions rejects missing write_anchor", () => {
  const body = buildValidApplyVisualBody();
  delete body.write_anchor;
  const result = validateMcpApplyVisualActions(body);

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(result.message, "write_anchor is required");
  assert.equal(result.statusCode, 400);
});

test("apply_visual_actions rejects mutation without target_anchor", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "add_component",
          component_assembly_qualified_name:
            "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
        },
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(result.message, "actions[0].target_anchor is required");
  assert.equal(result.statusCode, 400);
});

test("apply_visual_actions rejects create without parent_anchor", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "create_gameobject",
          name: "Child",
        },
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(result.message, "actions[0].parent_anchor is required");
  assert.equal(result.statusCode, 400);
});

test("apply_visual_actions rejects union mismatch: create_gameobject with target_anchor", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "create_gameobject",
          name: "Child",
          target_anchor: {
            object_id: "go_root",
            path: "Scene/Root",
          },
        },
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(result.message, "actions[0].parent_anchor is required");
  assert.equal(result.statusCode, 400);
});

test("apply_visual_actions accepts valid mutation/create anchor unions", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "add_component",
          target_anchor: {
            object_id: "go_root",
            path: "Scene/Root",
          },
          component_assembly_qualified_name:
            "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
        },
        {
          type: "create_gameobject",
          name: "Child",
          parent_anchor: {
            object_id: "go_root",
            path: "Scene/Root",
          },
        },
      ],
    })
  );

  assert.equal(result.ok, true);
});

test("apply_visual_actions accepts unknown action type when anchor and action_data are valid", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "set_ui_image_color",
          target_anchor: {
            object_id: "go_img",
            path: "Scene/Canvas/Image",
          },
          action_data: {
            r: 1,
            g: 0,
            b: 0,
            a: 1,
          },
        },
      ],
    })
  );

  assert.equal(result.ok, true);
});

test("apply_visual_actions enforces target_required when known action anchor_policy is provided", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "set_ui_image_color",
          parent_anchor: {
            object_id: "go_canvas",
            path: "Scene/Canvas",
          },
          action_data: {
            r: 1,
            g: 0,
            b: 0,
            a: 1,
          },
        },
      ],
    }),
    {
      actionAnchorPolicyByType: {
        set_ui_image_color: "target_required",
      },
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(
    result.message,
    "actions[0].target_anchor is required by anchor_policy(target_required)"
  );
  assert.equal(result.statusCode, 400);
});

test("apply_visual_actions keeps unknown action submit-open when policy map has no hit", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "set_rect_transform",
          parent_anchor: {
            object_id: "go_panel",
            path: "Scene/Canvas/Panel",
          },
          action_data: {
            anchored_position: { x: 10, y: 20 },
          },
        },
      ],
    }),
    {
      actionAnchorPolicyByType: {
        set_ui_image_color: "target_required",
      },
    }
  );

  assert.equal(result.ok, true);
});

test("apply_visual_actions rejects unknown action without any action anchor", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "set_ui_image_color",
          action_data: {
            r: 1,
            g: 0,
            b: 0,
            a: 1,
          },
        },
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(
    result.message,
    "actions[0].target_anchor or actions[0].parent_anchor is required"
  );
  assert.equal(result.statusCode, 400);
});

test("apply_visual_actions rejects non-object action_data", () => {
  const result = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "set_ui_image_color",
          target_anchor: {
            object_id: "go_img",
            path: "Scene/Canvas/Image",
          },
          action_data: "invalid",
        },
      ],
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(result.message, "actions[0].action_data must be an object when provided");
  assert.equal(result.statusCode, 400);
});

test("submit/apply visual hardcut remains consistent for unknown action without anchors", () => {
  const submitResult = validateMcpSubmitUnityTask(
    buildValidSubmitBody({
      file_actions: undefined,
      visual_layer_actions: [
        {
          type: "set_rect_transform",
          action_data: {
            anchored_position: { x: 0, y: 0 },
          },
        },
      ],
    })
  );
  const applyResult = validateMcpApplyVisualActions(
    buildValidApplyVisualBody({
      actions: [
        {
          type: "set_rect_transform",
          action_data: {
            anchored_position: { x: 0, y: 0 },
          },
        },
      ],
    })
  );

  assert.equal(submitResult.ok, false);
  assert.equal(applyResult.ok, false);
  assert.equal(submitResult.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(applyResult.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(submitResult.statusCode, 400);
  assert.equal(applyResult.statusCode, 400);
  assert.equal(
    /target_anchor.*parent_anchor is required/.test(String(submitResult.message || "")),
    true
  );
  assert.equal(
    /target_anchor.*parent_anchor is required/.test(String(applyResult.message || "")),
    true
  );
});
