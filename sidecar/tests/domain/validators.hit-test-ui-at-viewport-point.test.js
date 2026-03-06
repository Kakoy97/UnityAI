"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandValidator } = require("../adapters/commandValidator");

const validateHitTestUiAtViewportPoint = getCommandValidator(
  "hit_test_ui_at_viewport_point"
);

test("hit_test_ui_at_viewport_point validator accepts viewport payload", () => {
  const result = validateHitTestUiAtViewportPoint({
    view: "game",
    coord_space: "viewport_px",
    coord_origin: "bottom_left",
    x: 960,
    y: 540,
    resolution_width: 1920,
    resolution_height: 1080,
    scope_root_path: "Scene/Canvas/HUD",
    max_results: 8,
    include_non_interactable: false,
    timeout_ms: 3000,
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_viewport_point validator accepts normalized boundary points", () => {
  const result = validateHitTestUiAtViewportPoint({
    coord_space: "normalized",
    x: 1,
    y: 0,
    resolution_width: 1080,
    resolution_height: 1920,
  });
  assert.equal(result.ok, true);
});

test("hit_test_ui_at_viewport_point validator rejects invalid mapping fields", () => {
  const badCoordSpace = validateHitTestUiAtViewportPoint({
    coord_space: "screen_px",
    x: 1,
    y: 1,
  });
  assert.equal(badCoordSpace.ok, false);
  assert.equal(badCoordSpace.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badCoordSpace.message || ""), /coord_space/i);

  const badResolution = validateHitTestUiAtViewportPoint({
    x: 12,
    y: 24,
    resolution_width: 0,
    resolution_height: 720,
  });
  assert.equal(badResolution.ok, false);
  assert.equal(badResolution.errorCode, "E_SSOT_SCHEMA_INVALID");
  assert.match(String(badResolution.message || ""), /resolution_width/i);
});
