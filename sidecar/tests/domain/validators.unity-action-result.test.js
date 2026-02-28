"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateUnityActionResult } = require("../../src/domain/validators");

function buildBody(extraPayload) {
  return {
    event: "unity.action.result",
    request_id: "req_unity_action_result_1",
    thread_id: "t_default",
    turn_id: "turn_1",
    timestamp: new Date().toISOString(),
    payload: {
      action_type: "add_component",
      target_object_path: "Scene/Main Camera",
      target_object_id: "GlobalObjectId_V1-test",
      component_assembly_qualified_name:
        "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      success: false,
      error_code: "E_TARGET_ANCHOR_CONFLICT",
      error_message: "Target anchor conflict.",
      duration_ms: 0,
      ...(extraPayload && typeof extraPayload === "object" ? extraPayload : {}),
    },
  };
}

test("validateUnityActionResult accepts anchor-based payload without legacy payload.target", () => {
  const result = validateUnityActionResult(buildBody({ target: undefined }));
  assert.equal(result.ok, true);
});

test("validateUnityActionResult rejects non-create result when all target refs are missing", () => {
  const body = buildBody({
    target: "",
    target_object_path: "",
    target_object_id: "",
    object_id: "",
  });
  const result = validateUnityActionResult(body);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    result.message,
    "payload.target/target_object_path or payload.target_object_id/object_id is required"
  );
});
