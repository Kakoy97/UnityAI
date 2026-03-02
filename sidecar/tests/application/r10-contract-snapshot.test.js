"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  withMcpErrorFeedback,
} = require("../../src/application/mcpGateway/mcpErrorFeedback");
const { CapabilityStore } = require("../../src/application/capabilityStore");

test("R10-ARCH-03 error feedback payload contract snapshot remains stable", () => {
  const feedback = withMcpErrorFeedback({
    status: "failed",
    error_code: "E_ACTION_PAYLOAD_INVALID",
    message: "invalid action payload",
  });

  assert.deepEqual(Object.keys(feedback).sort(), [
    "error_code",
    "error_message",
    "message",
    "recoverable",
    "status",
    "suggestion",
  ]);
  assert.equal(typeof feedback.error_code, "string");
  assert.equal(typeof feedback.error_message, "string");
  assert.equal(typeof feedback.suggestion, "string");
  assert.equal(typeof feedback.recoverable, "boolean");
});

test("R10-ARCH-03 capability snapshot contract remains stable", () => {
  const store = new CapabilityStore({
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });

  store.markUnitySignal();
  store.reportCapabilities({
    capability_version: "sha256:r10_contract_v1",
    actions: [
      {
        type: "set_ui_image_color",
        description: "Set image color",
        anchor_policy: "target_required",
        action_data_schema: {
          type: "object",
          required: ["r", "g", "b", "a"],
        },
      },
    ],
  });

  const snapshot = store.getSnapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "action_count",
    "action_hints",
    "actions",
    "capability_updated_at",
    "capability_version",
    "connection_updated_at",
    "last_unity_signal_at",
    "token_budget",
    "unity_connection_state",
  ]);

  assert.equal(snapshot.unity_connection_state, "ready");
  assert.equal(snapshot.capability_version, "sha256:r10_contract_v1");
  assert.equal(snapshot.action_count, 1);
  assert.ok(Array.isArray(snapshot.action_hints));

  const actionSummary = snapshot.actions[0];
  assert.deepEqual(Object.keys(actionSummary).sort(), [
    "anchor_policy",
    "description",
    "type",
  ]);
  assert.equal(actionSummary.type, "set_ui_image_color");

  const schema = store.getActionSchema("set_ui_image_color");
  assert.equal(schema.ok, true);
  assert.deepEqual(Object.keys(schema).sort(), [
    "action",
    "action_type",
    "capability_updated_at",
    "capability_version",
    "etag",
    "not_modified",
    "ok",
    "schema_hint",
    "schema_hint_chars",
    "schema_hint_truncated",
    "token_budget",
    "unity_connection_state",
  ]);
  assert.deepEqual(Object.keys(schema.action).sort(), [
    "action_data_schema",
    "anchor_policy",
    "description",
    "type",
  ]);
});
