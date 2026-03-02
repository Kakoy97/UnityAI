"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUnityActionRequest,
  normalizeRuntime,
} = require("../../src/application/unityDispatcher/runtimeUtils");

function buildJob() {
  return {
    request_id: "req_runtime_utils_action_data",
    thread_id: "thread_runtime_utils_action_data",
    turn_id: "turn_runtime_utils_action_data",
    approval_mode: "auto",
    based_on_read_token: "tok_runtime_utils_action_data_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
  };
}

test("buildUnityActionRequest preserves action_data and emits matching action_data_json", () => {
  const actionData = {
    color: {
      r: 1,
      g: 0.5,
      b: 0.25,
      a: 1,
    },
    apply_to_children: true,
  };
  const request = buildUnityActionRequest(
    buildJob(),
    {
      type: "set_ui_image_color",
      target_anchor: {
        object_id: "go_image",
        path: "Scene/Canvas/Image",
      },
      action_data: actionData,
      action_data_json: "{\"stale\":true}",
    },
    () => "2026-02-28T00:00:00.000Z"
  );

  assert.deepEqual(request.payload.action.action_data, actionData);
  assert.equal(
    request.payload.action.action_data_json,
    JSON.stringify(actionData)
  );
  assert.deepEqual(
    JSON.parse(request.payload.action.action_data_json),
    actionData
  );
});

test("buildUnityActionRequest generates action_data_json from legacy action fields", () => {
  const componentAssembly =
    "UnityEngine.CanvasRenderer, UnityEngine.UIModule";
  const request = buildUnityActionRequest(
    buildJob(),
    {
      type: "add_component",
      target_anchor: {
        object_id: "go_button",
        path: "Scene/Canvas/Button",
      },
      component_assembly_qualified_name: componentAssembly,
    },
    () => "2026-02-28T00:00:00.000Z"
  );

  const action = request.payload.action;
  const parsed = JSON.parse(action.action_data_json);
  assert.equal(action.action_data.component_assembly_qualified_name, componentAssembly);
  assert.equal(parsed.component_assembly_qualified_name, componentAssembly);
  assert.deepEqual(action.action_data, parsed);
});

test("buildUnityActionRequest keeps warn-mode compatibility for legacy anchor fields", () => {
  const hits = [];
  const request = buildUnityActionRequest(
    buildJob(),
    {
      type: "add_component",
      target_object_id: "go_button",
      target_object_path: "Scene/Canvas/Button",
      component_assembly_qualified_name:
        "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
    },
    () => "2026-02-28T00:00:00.000Z",
    {
      legacyAnchorMode: "warn",
      onLegacyAnchorFallback(entry) {
        hits.push(entry);
      },
    }
  );

  assert.deepEqual(request.payload.action.target_anchor, {
    object_id: "go_button",
    path: "Scene/Canvas/Button",
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].anchor_kind, "target_anchor");
  assert.equal(hits[0].action_type, "add_component");
});

test("buildUnityActionRequest rejects legacy anchor fields in deny-mode", () => {
  assert.throws(
    () =>
      buildUnityActionRequest(
        buildJob(),
        {
          type: "add_component",
          target_object_id: "go_button",
          target_object_path: "Scene/Canvas/Button",
          component_assembly_qualified_name:
            "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
        },
        () => "2026-02-28T00:00:00.000Z",
        {
          legacyAnchorMode: "deny",
        }
      ),
    (error) =>
      error instanceof Error &&
      error.code === "E_ACTION_SCHEMA_INVALID" &&
      /legacy fields/i.test(error.message)
  );
});

test("buildUnityActionRequest bridges composite steps to internal action_data_json wire format", () => {
  const request = buildUnityActionRequest(
    buildJob(),
    {
      type: "composite_visual_action",
      target_anchor: {
        object_id: "go_canvas",
        path: "Scene/Canvas",
      },
      action_data: {
        schema_version: "r10.v1",
        transaction_id: "tx_runtime_utils_composite",
        steps: [
          {
            step_id: "s1_create_root",
            type: "create_gameobject",
            parent_anchor: {
              object_id: "go_canvas",
              path: "Scene/Canvas",
            },
            action_data: {
              name: "HealthBar",
            },
            bind_outputs: [
              {
                source: "created_object",
                alias: "hp_root",
              },
            ],
          },
        ],
      },
    },
    () => "2026-02-28T00:00:00.000Z"
  );

  const action = request.payload.action;
  const composite = JSON.parse(action.action_data_json);
  assert.equal(Array.isArray(composite.steps), true);
  assert.equal(composite.steps.length, 1);
  assert.equal(typeof composite.steps[0].action_data_json, "string");
  assert.deepEqual(
    JSON.parse(composite.steps[0].action_data_json),
    { name: "HealthBar" }
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(composite.steps[0], "action_data"),
    false
  );
});

test("normalizeRuntime ignores legacy task_allocation fallback", () => {
  const runtime = normalizeRuntime({
    task_allocation: {
      file_actions: [
        {
          type: "delete_file",
          path: "Assets/Scripts/AIGenerated/LegacyFallback.cs",
        },
      ],
      visual_layer_actions: [
        {
          type: "set_ui_image_color",
        },
      ],
    },
  });

  assert.deepEqual(runtime.file_actions, []);
  assert.deepEqual(runtime.visual_actions, []);
});
