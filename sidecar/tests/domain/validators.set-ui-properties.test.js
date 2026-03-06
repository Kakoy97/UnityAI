"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateMcpSetUiProperties } = require("../../src/domain/validators");

const VALID_TOKEN = "tok_set_ui_properties_12345678901234567890";

function buildValidPayload(extra) {
  return {
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_canvas_hud",
      path: "Scene/Canvas/HUD",
    },
    operations: [
      {
        target_anchor: {
          object_id: "go_btn_start",
          path: "Scene/Canvas/HUD/StartButton",
        },
        rect_transform: {
          anchored_position: { x: 0, y: -120 },
          size_delta: { x: 280, y: 72 },
        },
        image: {
          color: { r: 0.2, g: 0.6, b: 1, a: 1 },
          raycast_target: true,
        },
        text: {
          content: "Start Game",
          font_size: 36,
        },
      },
    ],
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}

test.skip("set_ui_properties validator accepts valid payload", () => {
  const result = validateMcpSetUiProperties(
    buildValidPayload({
      atomic: true,
      dry_run: true,
    })
  );
  assert.equal(result.ok, true);
});

test.skip("set_ui_properties validator rejects action_data/action_data hardcut", () => {
  const topLevel = validateMcpSetUiProperties(
    buildValidPayload({
      action_data: "{\"x\":1}",
    })
  );
  assert.equal(topLevel.ok, false);
  assert.equal(topLevel.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");

  const nested = validateMcpSetUiProperties(
    buildValidPayload({
      operations: [
        {
          target_anchor: {
            object_id: "go_btn_start",
            path: "Scene/Canvas/HUD/StartButton",
          },
          action_data: "{\"x\":1}",
          text: {
            content: "Start",
          },
        },
      ],
    })
  );
  assert.equal(nested.ok, false);
  assert.equal(nested.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");

  const topLevelMarshaled = validateMcpSetUiProperties(
    buildValidPayload({
      action_data: "eyJ4IjoxfQ",
    })
  );
  assert.equal(topLevelMarshaled.ok, false);
  assert.equal(topLevelMarshaled.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");

  const nestedMarshaled = validateMcpSetUiProperties(
    buildValidPayload({
      operations: [
        {
          target_anchor: {
            object_id: "go_btn_start",
            path: "Scene/Canvas/HUD/StartButton",
          },
          action_data: "eyJ4IjoxfQ",
          text: {
            content: "Start",
          },
        },
      ],
    })
  );
  assert.equal(nestedMarshaled.ok, false);
  assert.equal(nestedMarshaled.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
});

test.skip("set_ui_properties validator rejects empty operation and invalid atomic", () => {
  const emptyOperation = validateMcpSetUiProperties(
    buildValidPayload({
      operations: [
        {
          target_anchor: {
            object_id: "go_btn_start",
            path: "Scene/Canvas/HUD/StartButton",
          },
        },
      ],
    })
  );
  assert.equal(emptyOperation.ok, false);
  assert.equal(emptyOperation.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    emptyOperation.message,
    "operations[0] must provide at least one writable property"
  );

  const invalidAtomic = validateMcpSetUiProperties(
    buildValidPayload({
      atomic: "yes",
    })
  );
  assert.equal(invalidAtomic.ok, false);
  assert.equal(invalidAtomic.errorCode, "E_SCHEMA_INVALID");
  assert.equal(invalidAtomic.message, "atomic must be a boolean when provided");
});

test.skip("set_ui_properties validator enforces full layout_element payload", () => {
  const result = validateMcpSetUiProperties(
    buildValidPayload({
      operations: [
        {
          target_anchor: {
            object_id: "go_btn_start",
            path: "Scene/Canvas/HUD/StartButton",
          },
          layout_element: {
            min_width: 100,
            min_height: 40,
            preferred_width: 120,
            preferred_height: 44,
            flexible_width: 0,
            // flexible_height intentionally missing
            ignore_layout: false,
          },
        },
      ],
    })
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    result.message,
    "operations[0].layout_element.flexible_height is required"
  );
});


