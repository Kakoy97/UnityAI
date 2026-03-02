"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  validateGetUiTree,
} = require("../../src/mcp/commands/get_ui_tree/validator");
const {
  validateHitTestUiAtViewportPoint,
} = require("../../src/mcp/commands/hit_test_ui_at_viewport_point/validator");
const {
  validateUiLayout,
} = require("../../src/mcp/commands/validate_ui_layout/validator");
const {
  validateSetUiProperties,
} = require("../../src/mcp/commands/set_ui_properties/validator");

const VALID_TOKEN = "tok_ui_v1_parity_12345678901234567890";

function getRequired(name) {
  const registry = getMcpCommandRegistry();
  const metadata = registry.getToolMetadataByName(name, {});
  assert.ok(metadata, `metadata missing: ${name}`);
  return Array.isArray(metadata.input_schema && metadata.input_schema.required)
    ? [...metadata.input_schema.required].sort()
    : [];
}

test("UI-V1 schema required snapshot aligns with validators", () => {
  assert.deepEqual(getRequired("get_ui_tree"), []);
  assert.deepEqual(getRequired("hit_test_ui_at_viewport_point"), ["x", "y"]);
  assert.deepEqual(getRequired("validate_ui_layout"), []);
  assert.deepEqual(getRequired("set_ui_properties"), [
    "based_on_read_token",
    "operations",
    "write_anchor",
  ]);
});

test("get_ui_tree validator parity: no required fields, rejects unknown keys", () => {
  const ok = validateGetUiTree({});
  assert.equal(ok.ok, true);

  const bad = validateGetUiTree({
    unknown_key: true,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "E_SCHEMA_INVALID");
});

test("hit_test_ui_at_viewport_point validator parity: required x/y and coord guards", () => {
  const missingX = validateHitTestUiAtViewportPoint({
    y: 1,
  });
  assert.equal(missingX.ok, false);
  assert.equal(missingX.errorCode, "E_SCHEMA_INVALID");
  assert.equal(missingX.message, "x is required");

  const missingY = validateHitTestUiAtViewportPoint({
    x: 1,
  });
  assert.equal(missingY.ok, false);
  assert.equal(missingY.errorCode, "E_SCHEMA_INVALID");
  assert.equal(missingY.message, "y is required");

  const ok = validateHitTestUiAtViewportPoint({
    x: 1920,
    y: 1080,
    coord_space: "viewport_px",
    resolution: { width: 1920, height: 1080 },
  });
  assert.equal(ok.ok, true);
});

test("validate_ui_layout validator parity: no required fields and fixed checks enum", () => {
  const ok = validateUiLayout({});
  assert.equal(ok.ok, true);

  const bad = validateUiLayout({
    checks: ["INVALID"],
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "E_SCHEMA_INVALID");
});

test("set_ui_properties validator parity: required fields, dry_run bool, hardcut action_data_json", () => {
  const missing = validateSetUiProperties({
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_canvas_hud",
      path: "Scene/Canvas/HUD",
    },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.errorCode, "E_SCHEMA_INVALID");

  const badDryRun = validateSetUiProperties({
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
        text: { content: "Play" },
      },
    ],
    dry_run: "true",
  });
  assert.equal(badDryRun.ok, false);
  assert.equal(badDryRun.errorCode, "E_SCHEMA_INVALID");

  const hardcut = validateSetUiProperties({
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
        text: { content: "Play" },
      },
    ],
    action_data_json: "{\"x\":1}",
  });
  assert.equal(hardcut.ok, false);
  assert.equal(hardcut.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");

  const ok = validateSetUiProperties({
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
          anchored_position: { x: 0, y: 0 },
        },
      },
    ],
    dry_run: true,
  });
  assert.equal(ok.ok, true);
});
