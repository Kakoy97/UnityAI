"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateMcpSubmitUnityTask,
  validateMcpApplyScriptActions,
  validateMcpApplyVisualActions,
} = require("../../src/domain/validators");

test("submit_unity_task rejects missing based_on_read_token", () => {
  const result = validateMcpSubmitUnityTask({
    thread_id: "thread_1",
    idempotency_key: "idem_1",
    user_intent: "update script",
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(result.message, "based_on_read_token is required");
  assert.equal(result.statusCode, 400);
});

test("apply_script_actions rejects missing based_on_read_token", () => {
  const result = validateMcpApplyScriptActions({
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "create_file",
        path: "Assets/Scripts/AIGenerated/Test.cs",
        content: "class X {}",
        overwrite_if_exists: true,
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(result.message, "based_on_read_token is required");
  assert.equal(result.statusCode, 400);
});

test("apply_visual_actions rejects missing based_on_read_token", () => {
  const result = validateMcpApplyVisualActions({
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "add_component",
        target_anchor: {
          object_id: "go_btn",
          path: "Scene/Canvas/Button",
        },
        component_assembly_qualified_name:
          "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(result.message, "based_on_read_token is required");
  assert.equal(result.statusCode, 400);
});
