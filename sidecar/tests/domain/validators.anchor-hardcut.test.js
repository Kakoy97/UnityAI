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
  assert.equal(result.message, "actions[0] has unexpected field: target_anchor");
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

