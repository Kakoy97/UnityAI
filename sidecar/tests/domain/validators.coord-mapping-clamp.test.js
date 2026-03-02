"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateHitTestUiAtViewportPoint,
} = require("../../src/mcp/commands/hit_test_ui_at_viewport_point/validator");

test("hit_test_ui_at_viewport_point validator accepts boundary viewport coords for runtime clamp", () => {
  const result = validateHitTestUiAtViewportPoint({
    view: "game",
    coord_space: "viewport_px",
    coord_origin: "bottom_left",
    x: 1920,
    y: 1080,
    resolution: {
      width: 1920,
      height: 1080,
    },
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_viewport_point validator accepts top_left origin with finite coords", () => {
  const result = validateHitTestUiAtViewportPoint({
    view: "game",
    coord_space: "viewport_px",
    coord_origin: "top_left",
    x: 0,
    y: 0,
    resolution: {
      width: 1280,
      height: 720,
    },
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_viewport_point validator rejects negative viewport coords", () => {
  const result = validateHitTestUiAtViewportPoint({
    coord_space: "viewport_px",
    x: -1,
    y: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
});
