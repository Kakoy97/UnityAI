"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandValidator } = require("../adapters/commandValidator");

const validateHitTestUiAtViewportPoint = getCommandValidator(
  "hit_test_ui_at_viewport_point"
);

test("hit_test_ui_at_viewport_point validator accepts boundary viewport coords for runtime clamp", () => {
  const result = validateHitTestUiAtViewportPoint({
    view: "game",
    coord_space: "viewport_px",
    coord_origin: "bottom_left",
    x: 1920,
    y: 1080,
    resolution_width: 1920,
    resolution_height: 1080,
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
    resolution_width: 1280,
    resolution_height: 720,
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_viewport_point validator rejects invalid coord_space", () => {
  const result = validateHitTestUiAtViewportPoint({
    coord_space: "screen_px",
    x: 1,
    y: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SSOT_SCHEMA_INVALID");
});
